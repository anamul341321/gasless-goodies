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

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const UBI_ABI = [
  "function claim() returns (uint256)",
  "function checkEntitlement(address member) view returns (uint256)",
  "function checkEntitlement() view returns (uint256)",
];
const IDENTITY_ABI = ["function isWhitelisted(address account) view returns (bool)"];

const WORKER_TRIGGER_URL = `${SUPABASE_URL}/functions/v1/gd-claim-worker`;

const BATCH_SIZE = 40;              // wallets per parallel wave
const RECEIPT_TIMEOUT_MS = 45_000;  // wait at most 45s for each receipt
const WORKER_TIME_BUDGET_MS = 110_000;
const STALE_CLAIMING_MINUTES = 3;

function sbHeaders(extra: Record<string, string> = {}) {
  return {
    "Content-Type": "application/json",
    apikey: SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    ...extra,
  };
}

// Cache one provider per network across invocations
const providers: Partial<Record<GDNetwork, JsonRpcProvider>> = {};
function providerFor(net: GDNetwork): JsonRpcProvider {
  const existing = providers[net];
  if (existing) return existing;
  const cfg = GD_NETWORKS[net];
  const p = new JsonRpcProvider(cfg.rpc, cfg.chainId);
  providers[net] = p;
  return p;
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

async function claimOne(row: QueueRow): Promise<{
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

    // Run independent pre-flight reads in parallel to cut RPC roundtrips
    const [whitelistedRes, entitlement, feeDataRes, estimatedGasRes, balanceRes] = await Promise.allSettled([
      identity.isWhitelisted(addr),
      readEntitlement(ubi, addr),
      provider.getFeeData(),
      (ubi as any).claim.estimateGas(),
      provider.getBalance(addr),
    ]);

    if (whitelistedRes.status === "fulfilled" && whitelistedRes.value === false) {
      return { status: "failed_kyc", error: "not whitelisted — transaction skipped" };
    }

    if (entitlement.status === "fulfilled") {
      const ent = entitlement.value;
      if (typeof ent.amount === "bigint" && ent.amount === 0n) {
        return { status: "already_claimed", error: "already claimed today / no entitlement — transaction skipped" };
      }
      if (ent.error) {
        const cls = classifyError(ent.error);
        const msg = (ent.error?.shortMessage || ent.error?.reason || ent.error?.message || "entitlement check failed").slice(0, 240);
        if (cls === "gas") return { status: "failed_gas", error: msg };
        if (cls === "kyc") return { status: "failed_kyc", error: msg };
      }
    }

    let tx;
    try {
      if (estimatedGasRes.status === "rejected") throw estimatedGasRes.reason;
      if (feeDataRes.status === "rejected") throw feeDataRes.reason;
      const feeData = feeDataRes.value;
      const estimatedGas = BigInt(estimatedGasRes.value);
      const gasUnitPrice = feeData.gasPrice ?? feeData.maxFeePerGas;
      if (gasUnitPrice && balanceRes.status === "fulfilled") {
        const balance = balanceRes.value;
        const required = estimatedGas * gasUnitPrice;
        if (balance < required) {
          return {
            status: "failed_gas",
            error: `insufficient ${cfg.label === "XDC" ? "XDC" : "CELO"} for gas: has ${formatGasNeed(balance)}, needs about ${formatGasNeed(required)}`,
          };
        }
      }

      tx = await (ubi as any).claim({
        gasLimit: (estimatedGas * 120n) / 100n,
        ...(feeData.gasPrice ? { gasPrice: feeData.gasPrice } : {}),
      });
    } catch (e: any) {
      const cls = classifyError(e);
      const msg = (e?.shortMessage || e?.reason || e?.message || "claim revert").slice(0, 240);
      if (cls === "gas") return { status: "failed_gas", error: msg };
      if (cls === "kyc") return { status: "failed_kyc", error: msg };
      if (cls === "already") return { status: "already_claimed", error: msg };
      return { status: "failed", error: msg };
    }
    try {
      const receipt = await tx.wait(1, RECEIPT_TIMEOUT_MS);
      if (receipt && receipt.status === 1) {
        const logs = (receipt.logs || []) as any[];
        const touchedWallet = logs.some((l) => {
          const topics: string[] = l.topics || [];
          return topics.some((t) => typeof t === "string" && t.toLowerCase().endsWith(addr.slice(2)));
        });
        if (touchedWallet) {
          return { status: "success", txHash: tx.hash };
        }
        return { status: "already_claimed", txHash: tx.hash, error: "claim no-op (already claimed today or not entitled)" };
      }
      return { status: "failed", txHash: tx.hash, error: "tx reverted" };
    } catch (e: any) {
      return { status: "failed", txHash: tx?.hash, error: (e?.message || String(e)).slice(0, 240) };
    }
  } catch (e: any) {
    const cls = classifyError(e);
    const msg = (e?.message || String(e)).slice(0, 240);
    if (cls === "gas") return { status: "failed_gas", error: msg };
    if (cls === "kyc") return { status: "failed_kyc", error: msg };
    if (cls === "already") return { status: "already_claimed", error: msg };
    return { status: "failed", error: msg };
  }
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

async function refreshJobAggregate(jobId: string) {
  const aggRes = await fetch(
    `${SUPABASE_URL}/rest/v1/gd_claim_queue?job_id=eq.${jobId}&select=status&limit=5000`,
    { headers: sbHeaders() }
  );
  if (!aggRes.ok) return;
  const all = await aggRes.json();
  let done = 0, failed = 0, needsGas = 0, activeRemaining = 0;
  for (const r of all || []) {
    if (r.status === "success") done++;
    else if (r.status === "failed_gas") { failed++; needsGas++; }
    else if (r.status === "already_claimed") failed++;
    else if (r.status === "failed_kyc" || r.status === "failed") failed++;
    if (r.status === "pending" || r.status === "claiming") activeRemaining++;
  }
  const allDone = activeRemaining === 0 && (all?.length ?? 0) > 0;

  await fetch(`${SUPABASE_URL}/rest/v1/gd_claim_jobs?id=eq.${jobId}`, {
    method: "PATCH",
    headers: sbHeaders({ Prefer: "return=minimal" }),
    body: JSON.stringify({
      done, failed, needs_gas: needsGas,
      status: allDone ? "completed" : "running",
      finished_at: allDone ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    }),
  });
}

async function processWave(rows: QueueRow[]) {
  const settled = await Promise.all(rows.map(async (r) => {
    const res = await claimOne(r);
    await finalize(r, res);
    return r.job_id;
  }));
  const jobIds = [...new Set(settled)];
  for (const jid of jobIds) await refreshJobAggregate(jid);
}

async function processLoop(): Promise<{ processed: number; remaining: boolean }> {
  const startedAt = Date.now();
  let processed = 0;

  while (Date.now() - startedAt < WORKER_TIME_BUDGET_MS) {
    if (Date.now() - startedAt > WORKER_TIME_BUDGET_MS - RECEIPT_TIMEOUT_MS - 10_000) break;
    const batch = await pickPendingBatch();
    if (batch.length === 0) break;
    await processWave(batch);
    processed += batch.length;
  }

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
