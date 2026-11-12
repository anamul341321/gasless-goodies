// GoodDollar batch claim worker (parallel mode, multi-network).
//
// Supports both Celo Mainnet and XDC Mainnet. Each gd_claim_jobs row carries a
// `network` column; queue rows inherit the network from their parent job.
//
// Strategy:
//   - Pick up to BATCH_SIZE pending wallets from gd_claim_queue, joined with
//     their job so we know which network each wallet belongs to.
//   - Mark them all 'claiming' atomically.
//   - For each wallet, build a provider + UBIScheme + Identity contract using
//     the per-network config.
//   - Read checkEntitlement() before sending a tx; entitlement 0 is marked as
//     already_claimed so native gas is not spent on wallets already claimed
//     today.
//   - Fire eligible UBIScheme.claim() calls in parallel.
//   - For each sent tx, await the receipt to record success/failure.
//   - Classify failures:
//       * insufficient gas       -> status 'failed_gas'  (key kept for user)
//       * not whitelisted / KYC  -> status 'failed_kyc'  (key kept for user)
//       * already claimed/no UBI -> status 'already_claimed' (key kept)
//       * anything else          -> status 'failed'      (key kept for user)
//   - DOES NOT auto-request gas from any faucet — that responsibility is
//     handled separately (or not at all).
//
//   Gas: node-estimated gasLimit + current legacy gasPrice, so wallets only
//   need the real CELO amount the claim needs.

import { Wallet, JsonRpcProvider, Contract, formatEther } from "npm:ethers@6.13.4";
import { GD_NETWORKS, type GDNetwork, resolveNetwork } from "../_shared/gdNetworks.ts";
import { CLAIM_EVIDENCE_ABI, receivedGd, verifyPriorClaim } from "../_shared/claimEvidence.ts";
import { readClaimQueue, summarizeClaimQueue } from "../_shared/manualClaimAggregate.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const UBI_ABI = [
  ...CLAIM_EVIDENCE_ABI,
  "function claim() returns (uint256)",
  "function checkEntitlement(address member) view returns (uint256)",
  "function checkEntitlement() view returns (uint256)",
];
const IDENTITY_ABI = ["function isWhitelisted(address account) view returns (bool)"];

const WORKER_TRIGGER_URL = `${SUPABASE_URL}/functions/v1/gd-claim-worker`;

const BATCH_SIZE = 40;              // wallets fetched per refill
const CONCURRENCY = 40;             // independent claim lanes (no wave barrier)
const READ_TIMEOUT_MS = 10_000;     // hard cap for every RPC read
const SEND_TIMEOUT_MS = 15_000;     // hard cap for broadcasting a claim
const RECEIPT_TIMEOUT_MS = 25_000;  // first receipt wait
const WORKER_TIME_BUDGET_MS = 120_000;
const PICK_STOP_MS = 55_000;        // stop taking new wallets this long before the budget ends
const AGGREGATE_EVERY_MS = 4_000;   // keep the visible job counters fresh
const STALE_CLAIMING_MINUTES = 3;

function sbHeaders(extra: Record<string, string> = {}) {
  return {
    "Content-Type": "application/json",
    apikey: SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    ...extra,
  };
}

// Rotate over several RPC endpoints: a single public node (XDC especially)
// regularly answers 500/520/503, which used to fail whole claims.
const providerPools: Partial<Record<GDNetwork, JsonRpcProvider[]>> = {};
let rpcCursor = 0;
function providerFor(net: GDNetwork): JsonRpcProvider {
  let pool = providerPools[net];
  if (!pool) {
    const cfg = GD_NETWORKS[net];
    const urls = cfg.rpcs && cfg.rpcs.length > 0 ? cfg.rpcs : [cfg.rpc];
    pool = urls.map((u) => new JsonRpcProvider(u, cfg.chainId, { staticNetwork: true, batchMaxCount: 1 }));
    providerPools[net] = pool;
  }
  return pool[rpcCursor++ % pool.length];
}

/** Network-node hiccups (not wallet problems) that are safe to retry on another node. */
export function isTransientRpcError(msg?: string | null): boolean {
  const m = (msg || "").toLowerCase();
  return /server response (5\d\d|429)|bad gateway|service unavailable|internal server error|timeout|timed out|missing response|network error|econnreset|socket hang up|failed to detect network|could not coalesce/.test(m);
}

type QueueRow = {
  id: string;
  job_id: string;
  wallet_address: string;
  private_key: string;
  attempts: number;
  network: GDNetwork;
};

function classifyError(err: any): "gas" | "kyc" | "already" | "other" {
  const raw = (err?.message || err?.shortMessage || err?.reason || String(err) || "").toLowerCase();
  if (
    raw.includes("no entitlement") ||
    raw.includes("already claimed") ||
    raw.includes("alreadyclaim") ||
    raw.includes("claim no-op")
  ) return "already";
  if (
    raw.includes("insufficient funds") ||
    raw.includes("insufficient balance") ||
    raw.includes("gas required exceeds") ||
    err?.code === "INSUFFICIENT_FUNDS"
  ) return "gas";
  if (
    raw.includes("not whitelisted") ||
    raw.includes("whitelist") ||
    raw.includes("identity") ||
    raw.includes("not verified")
  ) return "kyc";
  return "other";
}

async function readEntitlement(ubi: Contract, address: string): Promise<{ amount?: bigint; error?: any }> {
  try {
    const value = await (ubi as any)["checkEntitlement(address)"].staticCall(address);
    return { amount: BigInt(value) };
  } catch (firstError) {
    try {
      const value = await (ubi as any)["checkEntitlement()"].staticCall();
      return { amount: BigInt(value) };
    } catch {
      return { error: firstError };
    }
  }
}

/** Never let one hanging node stall a wallet (and the whole worker). */
export function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let t: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    p,
    new Promise<never>((_, rej) => { t = setTimeout(() => rej(new Error(`${label} timeout`)), ms); }),
  ]).finally(() => clearTimeout(t));
}

function formatGasNeed(wei: bigint): string {
  return Number(formatEther(wei)).toFixed(6).replace(/0+$/, "").replace(/\.$/, "");
}

async function pickPendingBatch(): Promise<QueueRow[]> {
  const staleCutoff = new Date(Date.now() - STALE_CLAIMING_MINUTES * 60_000).toISOString();
  await fetch(
    `${SUPABASE_URL}/rest/v1/gd_claim_queue?status=eq.claiming&updated_at=lt.${encodeURIComponent(staleCutoff)}`,
    {
      method: "PATCH",
      headers: sbHeaders({ Prefer: "return=minimal" }),
      body: JSON.stringify({
        status: "pending",
        updated_at: new Date().toISOString(),
      }),
    }
  ).catch((e) => console.warn("stale claiming reset failed", e));

  // Embed parent job to get network in a single call
  const findRes = await fetch(
    `${SUPABASE_URL}/rest/v1/gd_claim_queue?status=eq.pending&select=id,job_id,wallet_address,private_key,attempts,gd_claim_jobs(network)&order=created_at.asc&limit=${BATCH_SIZE}`,
    { headers: sbHeaders() }
  );
  if (!findRes.ok) return [];
  const rows = await findRes.json();
  if (!Array.isArray(rows) || rows.length === 0) return [];

  const ids = rows.map((r: any) => r.id);
  const claimRes = await fetch(
    `${SUPABASE_URL}/rest/v1/gd_claim_queue?id=in.(${ids.join(",")})&status=eq.pending`,
    {
      method: "PATCH",
      headers: sbHeaders({ Prefer: "return=representation" }),
      body: JSON.stringify({
        status: "claiming",
        updated_at: new Date().toISOString(),
      }),
    }
  );
  if (!claimRes.ok) return [];
  const claimed = await claimRes.json();
  if (!Array.isArray(claimed)) return [];
  const claimedIds = new Set(claimed.map((c: any) => c.id));
  const winners = rows
    .filter((r: any) => claimedIds.has(r.id))
    .map((r: any) => ({
      id: r.id,
      job_id: r.job_id,
      wallet_address: r.wallet_address,
      private_key: r.private_key,
      attempts: r.attempts,
      network: resolveNetwork(r.gd_claim_jobs?.network).id,
    })) as QueueRow[];

  // Mark involved jobs as 'running'
  const jobIds = [...new Set(winners.map((r) => r.job_id))];
  for (const jid of jobIds) {
    fetch(`${SUPABASE_URL}/rest/v1/gd_claim_jobs?id=eq.${jid}&status=eq.pending`, {
      method: "PATCH",
      headers: sbHeaders({ Prefer: "return=minimal" }),
      body: JSON.stringify({ status: "running", updated_at: new Date().toISOString() }),
    }).catch(() => {});
  }

  return winners;
}

async function claimOnce(row: QueueRow, deadline: number): Promise<{
  status: "success" | "failed_gas" | "failed_kyc" | "already_claimed" | "failed";
  txHash?: string;
  error?: string;
}> {
  try {
    const cfg = GD_NETWORKS[row.network];
    const provider = providerFor(row.network);
    const signer = new Wallet(row.private_key, provider);
    const ubi = new Contract(cfg.ubiSchemeAddress, UBI_ABI, signer);
    const identity = new Contract(cfg.identityAddress, IDENTITY_ABI, provider);
    const addr = (await signer.getAddress()).toLowerCase();

    // Phase 1: cheap eligibility reads only. Already-claimed / not-whitelisted
    // wallets bail out here without paying for fee/estimate/balance roundtrips.
    const [whitelistedRes, entitlement] = await Promise.allSettled([
      withTimeout(identity.isWhitelisted(addr), READ_TIMEOUT_MS, "whitelist read"),
      withTimeout(readEntitlement(ubi, addr), READ_TIMEOUT_MS, "entitlement read"),
    ]);

    if (whitelistedRes.status === "fulfilled" && whitelistedRes.value === false) {
      return { status: "failed_kyc", error: "not whitelisted — transaction skipped" };
    }

    if (entitlement.status === "fulfilled") {
      const ent = entitlement.value;
      // Entitlement 0 means nothing to claim this period (already claimed or no
      // UBI) — skip fast, no extra verification roundtrips, no gas spent.
      if (typeof ent.amount === "bigint" && ent.amount === 0n) {
        return { status: "already_claimed", error: "Already claimed in current on-chain period" };
      }
      if (ent.error) {
        const cls = classifyError(ent.error);
        const msg = (ent.error?.shortMessage || ent.error?.reason || ent.error?.message || "entitlement check failed").slice(0, 240);
        if (cls === "gas") return { status: "failed_gas", error: msg };
        if (cls === "kyc") return { status: "failed_kyc", error: msg };
      }
    }

    // Phase 2: only wallets with something to claim pay for these reads.
    const [feeDataRes, estimatedGasRes, balanceRes] = await Promise.allSettled([
      withTimeout(provider.getFeeData(), READ_TIMEOUT_MS, "fee read"),
      withTimeout((ubi as any).claim.estimateGas(), READ_TIMEOUT_MS, "gas estimate"),
      withTimeout(provider.getBalance(addr), READ_TIMEOUT_MS, "balance read"),
    ]);

    let tx;
    try {
      if (estimatedGasRes.status === "rejected") throw estimatedGasRes.reason;
      if (feeDataRes.status === "rejected") throw feeDataRes.reason;
      const feeData = feeDataRes.value;
      const estimatedGas = BigInt(estimatedGasRes.value);
      const gasUnitPrice = feeData.gasPrice ?? feeData.maxFeePerGas;
      let gasLimit = (estimatedGas * 120n) / 100n;
      if (gasUnitPrice && balanceRes.status === "fulfilled") {
        const balance = balanceRes.value;
        // Tight wallets: fall back to a 5% margin when the 20% one doesn't fit.
        if (balance < gasLimit * gasUnitPrice) gasLimit = (estimatedGas * 105n) / 100n;
        const required = gasLimit * gasUnitPrice;
        if (balance < required) {
          return {
            status: "failed_gas",
            error: `insufficient ${cfg.label === "XDC" ? "XDC" : cfg.label === "Fuse" ? "FUSE" : "CELO"} for gas: has ${formatGasNeed(balance)}, needs about ${formatGasNeed(required)}`,
          };
        }
      }

      tx = await withTimeout((ubi as any).claim({
        gasLimit,
        ...(feeData.gasPrice ? { gasPrice: feeData.gasPrice } : {}),
      }), SEND_TIMEOUT_MS, "claim send");
    } catch (e: any) {
      const cls = classifyError(e);
      const msg = (e?.shortMessage || e?.reason || e?.message || "claim revert").slice(0, 240);
      if (cls === "gas") return { status: "failed_gas", error: msg };
      if (cls === "kyc") return { status: "failed_kyc", error: msg };
      if (cls === "already" && await verifyPriorClaim(ubi, provider, addr)) return { status: "already_claimed", error: "Verified claim in current on-chain period" };
      return { status: "failed", error: msg };
    }
    const classifyReceipt = (receipt: any) => {
      if (receipt && receipt.status === 1) {
        const touchedWallet = receivedGd(receipt.logs || [], addr, cfg.gdTokenAddress);
        if (touchedWallet) return { status: "success" as const, txHash: tx.hash };
        return { status: "failed" as const, txHash: tx.hash, error: "Claim unconfirmed: no verified G$ transfer received" };
      }
      return { status: "failed" as const, txHash: tx.hash, error: "tx reverted" };
    };

    try {
      const firstWait = Math.max(5_000, Math.min(RECEIPT_TIMEOUT_MS, deadline - Date.now() - 8_000));
      const receipt = await tx.wait(1, firstWait);
      return classifyReceipt(receipt);
    } catch (e: any) {
      // Receipt poll timed out — but tx was sent. Poll receipt directly a few more times.
      const isTimeout = (e?.code === "TIMEOUT") || /timeout/i.test(e?.message || "");
      if (isTimeout && tx?.hash) {
        while (Date.now() + 4_000 < deadline) {
          await new Promise((r) => setTimeout(r, 3000));
          try {
            const r = await withTimeout(providerFor(row.network).getTransactionReceipt(tx.hash), READ_TIMEOUT_MS, "receipt read");
            if (r) return classifyReceipt(r);
          } catch {}
        }
        // Still no receipt — leave as pending so a later worker run can re-check
        return { status: "failed", txHash: tx.hash, error: "receipt pending — tx may have succeeded, check explorer" };
      }
      return { status: "failed", txHash: tx?.hash, error: (e?.message || String(e)).slice(0, 240) };
    }
  } catch (e: any) {
    const cls = classifyError(e);
    const msg = (e?.message || String(e)).slice(0, 240);
    if (cls === "gas") return { status: "failed_gas", error: msg };
    if (cls === "kyc") return { status: "failed_kyc", error: msg };
    return { status: "failed", error: msg };
  }
}

// Retry on a different node when the failure is a node hiccup. A retry after a
// broadcast is safe: the contract refuses a second claim in the same period and
// the prior claim is then verified on-chain.
async function claimOne(row: QueueRow, deadline: number): Promise<Awaited<ReturnType<typeof claimOnce>>> {
  let res = await claimOnce(row, deadline);
  for (
    let i = 0;
    i < 3 && res.status === "failed" && isTransientRpcError(res.error) && Date.now() + 45_000 < deadline;
    i++
  ) {
    await new Promise((r) => setTimeout(r, 1000 * (i + 1)));
    res = await claimOnce(row, deadline);
  }
  return res;
}

async function finalize(row: QueueRow, result: Awaited<ReturnType<typeof claimOne>>) {
  const patch: Record<string, any> = {
    tx_hash: result.txHash || null,
    error_message: result.status === "success" ? null : (result.error || "unknown").slice(0, 240),
    processed_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    status: result.status,
    attempts: row.attempts + 1,
  };
  if (result.status === "success") patch.private_key = null;

  await fetch(`${SUPABASE_URL}/rest/v1/gd_claim_queue?id=eq.${row.id}`, {
    method: "PATCH",
    headers: sbHeaders({ Prefer: "return=minimal" }),
    body: JSON.stringify(patch),
  });
}

async function triggerGasRequest(jobId: string, network: GDNetwork): Promise<string | null> {
  // Pull wallets that failed for gas reasons (status set to failed_gas earlier)
  const rows = await readClaimQueue<{ wallet_address: string }>(
    `${SUPABASE_URL}/rest/v1/gd_claim_queue?job_id=eq.${jobId}&status=eq.failed_gas&select=wallet_address`,
    sbHeaders(),
  );
  if (rows.length === 0) return null;

  const parentRes = await fetch(`${SUPABASE_URL}/rest/v1/gd_claim_jobs?id=eq.${jobId}&select=owner_user_id`, { headers: sbHeaders() });
  const parents = parentRes.ok ? await parentRes.json() : [];
  const ownerUserId = parents[0]?.owner_user_id ?? null;

  const jobIns = await fetch(`${SUPABASE_URL}/rest/v1/gas_load_jobs`, {
    method: "POST",
    headers: sbHeaders({ Prefer: "return=representation" }),
    body: JSON.stringify({
      owner_user_id: ownerUserId,
      total: rows.length,
      delay_ms: 3000,
      status: "pending",
      network,
      batch_name: `gd-claim-${jobId.slice(0, 8)}`,
    }),
  });
  if (!jobIns.ok) return null;
  const created = await jobIns.json();
  const gasJobId = Array.isArray(created) ? created[0]?.id : created?.id;
  if (!gasJobId) return null;

  const queueRows = rows.map((r: any) => ({
    job_id: gasJobId,
    wallet_address: r.wallet_address,
    status: "pending",
  }));
  const BATCH = 500;
  for (let i = 0; i < queueRows.length; i += BATCH) {
    await fetch(`${SUPABASE_URL}/rest/v1/gas_load_queue`, {
      method: "POST",
      headers: sbHeaders({ Prefer: "return=minimal" }),
      body: JSON.stringify(queueRows.slice(i, i + BATCH)),
    });
  }

  // Kick the gas worker so it doesn't wait for the next cron tick
  fetch(`${SUPABASE_URL}/functions/v1/gas-loader-worker`, {
    method: "POST",
    headers: sbHeaders(),
    body: JSON.stringify({ trigger: "gd-claim", job_id: gasJobId }),
  }).catch(() => {});

  return gasJobId;
}

async function refreshJobAggregate(jobId: string) {
  const all = await readClaimQueue<{ status: string }>(
    `${SUPABASE_URL}/rest/v1/gd_claim_queue?job_id=eq.${jobId}&select=status`,
    sbHeaders(),
  );
  const { done, failed, needsGas, allDone } = summarizeClaimQueue(all);

  // Read current job state to decide gas-recovery flow
  let gasPhase = "none";
  let network: GDNetwork = "celo";
  try {
    const jr = await fetch(
      `${SUPABASE_URL}/rest/v1/gd_claim_jobs?id=eq.${jobId}&select=gas_phase,network`,
      { headers: sbHeaders() }
    );
    if (jr.ok) {
      const arr = await jr.json();
      if (Array.isArray(arr) && arr[0]) {
        gasPhase = arr[0].gas_phase || "none";
        network = resolveNetwork(arr[0].network).id;
      }
    }
  } catch {}

  // First-pass complete with gas-failures → kick off gas recovery
  if (allDone && gasPhase === "none" && needsGas > 0) {
    const gasJobId = await triggerGasRequest(jobId, network);
    if (gasJobId) {
      await fetch(`${SUPABASE_URL}/rest/v1/gd_claim_jobs?id=eq.${jobId}`, {
        method: "PATCH",
        headers: sbHeaders({ Prefer: "return=minimal" }),
        body: JSON.stringify({
          done, failed, needs_gas: needsGas,
          status: "running",
          gas_phase: "requesting",
          gas_job_id: gasJobId,
          gas_requested_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }),
      });
      return;
    }
  }

  // Retry pass complete → mark fully done
  const finalize = allDone && (gasPhase === "retrying" || gasPhase === "none" || gasPhase === "retried");
  const patch: Record<string, any> = {
    done, failed, needs_gas: needsGas,
    status: finalize ? "completed" : (allDone ? "running" : "running"),
    updated_at: new Date().toISOString(),
  };
  if (finalize) {
    patch.finished_at = new Date().toISOString();
    if (gasPhase === "retrying") {
      patch.gas_phase = "retried";
      patch.retried_at = new Date().toISOString();
    }
  } else {
    patch.finished_at = null;
  }

  await fetch(`${SUPABASE_URL}/rest/v1/gd_claim_jobs?id=eq.${jobId}`, {
    method: "PATCH",
    headers: sbHeaders({ Prefer: "return=minimal" }),
    body: JSON.stringify(patch),
  });
}

// Independent lanes: each wallet is finalized the moment it finishes, so one
// slow wallet never holds back the rest, and counters refresh every few seconds.
async function processLoop(): Promise<{ processed: number; remaining: boolean }> {
  const startedAt = Date.now();
  const deadline = startedAt + WORKER_TIME_BUDGET_MS;
  const pickUntil = deadline - PICK_STOP_MS;
  let processed = 0;
  let buffer: QueueRow[] = [];
  let exhausted = false;
  let refill: Promise<void> | null = null;
  const touched = new Set<string>();
  let lastAggregate = 0;
  let aggregating: Promise<void> | null = null;

  const flushAggregates = async (force = false) => {
    if (aggregating) { if (!force) return; await aggregating; }
    if (!force && Date.now() - lastAggregate < AGGREGATE_EVERY_MS) return;
    if (touched.size === 0) return;
    lastAggregate = Date.now();
    const ids = [...touched];
    touched.clear();
    aggregating = (async () => {
      for (const jid of ids) {
        try { await refreshJobAggregate(jid); } catch (e) { touched.add(jid); console.warn("aggregate failed", e); }
      }
    })();
    try { await aggregating; } finally { aggregating = null; }
  };

  const next = async (): Promise<QueueRow | null> => {
    while (true) {
      if (Date.now() > pickUntil) return null;
      const row = buffer.shift();
      if (row) return row;
      if (exhausted) return null;
      if (!refill) {
        refill = (async () => {
          const rows = await pickPendingBatch();
          if (rows.length === 0) exhausted = true;
          buffer.push(...rows);
        })().finally(() => { refill = null; });
      }
      await refill;
    }
  };

  const lane = async () => {
    while (true) {
      const row = await next();
      if (!row) return;
      const res = await claimOne(row, deadline);
      await finalize(row, res);
      processed++;
      touched.add(row.job_id);
      flushAggregates().catch(() => {});
    }
  };

  await Promise.all(Array.from({ length: CONCURRENCY }, () => lane()));

  // Unstarted wallets picked into the buffer go back to the line immediately.
  if (buffer.length > 0) {
    const ids = buffer.map((r) => r.id);
    await fetch(`${SUPABASE_URL}/rest/v1/gd_claim_queue?id=in.(${ids.join(",")})&status=eq.claiming`, {
      method: "PATCH",
      headers: sbHeaders({ Prefer: "return=minimal" }),
      body: JSON.stringify({ status: "pending", updated_at: new Date().toISOString() }),
    }).catch(() => {});
    buffer = [];
  }
  await flushAggregates(true);

  const remCheck = await fetch(
    `${SUPABASE_URL}/rest/v1/gd_claim_queue?or=(status.eq.pending,status.eq.claiming)&select=id&limit=1`,
    { headers: sbHeaders() }
  );
  let remaining = false;
  if (remCheck.ok) {
    const r = await remCheck.json();
    remaining = Array.isArray(r) && r.length > 0;
  }
  return { processed, remaining };
}

let inFlight = false;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  if (inFlight) {
    return new Response(JSON.stringify({ ok: true, skipped: "already running" }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  inFlight = true;
  try {
    const result = await processLoop();
    if (result.remaining) {
      fetch(WORKER_TRIGGER_URL, {
        method: "POST",
        headers: sbHeaders(),
        body: JSON.stringify({ trigger: "continue" }),
      }).catch(() => {});
    }
    return new Response(JSON.stringify({ ok: true, ...result }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    console.error("gd-claim-worker error", e?.message || e);
    return new Response(JSON.stringify({ ok: false, error: e?.message || String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } finally {
    inFlight = false;
  }
});
