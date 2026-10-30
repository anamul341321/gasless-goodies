// Daily claim worker. Multi-network (Celo + XDC). Drives a single run
// through 4 phases:
//   1) claiming        — try claim() on every wallet (slow, parallel waves)
//   2) gas_requesting  — for failed_gas wallets, queue free-gas-load batch
//   3) waiting_30m     — handed off to the scheduler (no work here)
//   4) retrying        — re-claim failed_gas wallets ONCE, set final_status
// Self-recursive: when its time-budget runs low it re-invokes itself.

import { Wallet, JsonRpcProvider, Contract, formatEther } from "npm:ethers@6.13.4";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { decryptKey } from "../_shared/dailyCrypto.ts";
import { GD_NETWORKS, resolveNetwork, type GDNetwork } from "../_shared/gdNetworks.ts";
import { isTransient, recoverStalledRetry } from "./recovery.ts";
import { CLAIM_EVIDENCE_ABI, receivedGd, verifyPriorClaim } from "../_shared/claimEvidence.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const admin = createClient(SUPABASE_URL, SERVICE_KEY);

const UBI_ABI = [
  ...CLAIM_EVIDENCE_ABI,
  "function claim() returns (uint256)",
  "function checkEntitlement(address member) view returns (uint256)",
  "function checkEntitlement() view returns (uint256)",
];
const IDENTITY_ABI = ["function isWhitelisted(address account) view returns (bool)"];
// keccak256("Transfer(address,address,uint256)")
const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";


// Round-robin over several RPC endpoints so one flaky/rate-limited node cannot
// stall a whole wave.
const providerPools: Partial<Record<GDNetwork, JsonRpcProvider[]>> = {};
let rpcCursor = 0;
function providerFor(net: GDNetwork) {
  let pool = providerPools[net];
  if (!pool) {
    const cfg = GD_NETWORKS[net];
    const urls = cfg.rpcs && cfg.rpcs.length > 0 ? cfg.rpcs : [cfg.rpc];
    pool = urls.map((u) => new JsonRpcProvider(u, cfg.chainId, { staticNetwork: true, batchMaxCount: 1 }));
    providerPools[net] = pool;
  }
  return pool[rpcCursor++ % pool.length];
}

// Use the live network gas price when sending claim txs. Celo currently rejects
// underpriced txs, so forcing a low cap can make wallets with 0.06–0.07 CELO
// fail even though they have enough gas.

// Daily auto-claim — tuned for steady throughput while staying RPC-friendly.
const CLAIM_WAVE_SIZE = 8;
const CLAIM_WAVE_GAP_MS = 1800;
const RECEIPT_TIMEOUT_MS = 90_000;
const TIME_BUDGET_MS = 110_000;
// Hard ceiling per wallet so one hanging RPC cannot block an entire wave.
const WALLET_TIMEOUT_MS = 100_000;

// Public RPC nodes regularly return 500/400/"could not coalesce error". Those
// escaped as unhandled rejections from ethers' internal polling and killed the
// whole isolate mid-wave, which stalled the run. Swallow them here — every
// meaningful error is already handled inside claimOne().
addEventListener("unhandledrejection", (e: any) => {
  try { e.preventDefault(); } catch { /* ignore */ }
  console.log("suppressed unhandled rejection:", String(e?.reason?.message || e?.reason || e));
});
addEventListener("error", (e: any) => {
  try { e.preventDefault(); } catch { /* ignore */ }
  console.log("suppressed error:", String(e?.message || e));
});

const WORKER_URL = `${SUPABASE_URL}/functions/v1/daily-claim-worker`;

const inFlight = new Set<string>();

// Transient node/network failures must NOT burn a wallet's attempt — they are
// retried on a different RPC endpoint instead of being recorded as failures.
function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${label} timeout`)), ms);
    p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}


function classifyError(err: any): "gas" | "kyc" | "already" | "other" {
  const raw = (err?.message || err?.shortMessage || err?.reason || String(err) || "").toLowerCase();
  if (raw.includes("no entitlement") || raw.includes("already claimed") || raw.includes("alreadyclaim") || raw.includes("claim no-op")) return "already";
  if (raw.includes("insufficient funds") || raw.includes("insufficient balance") || raw.includes("gas required exceeds") || err?.code === "INSUFFICIENT_FUNDS") return "gas";
  if (raw.includes("not whitelisted") || raw.includes("whitelist") || raw.includes("identity") || raw.includes("not verified")) return "kyc";
  return "other";
}

function fmt(wei: bigint) {
  return Number(formatEther(wei)).toFixed(6).replace(/0+$/, "").replace(/\.$/, "");
}

async function readEntitlement(ubi: Contract, addr: string) {
  try {
    const v = await (ubi as any)["checkEntitlement(address)"].staticCall(addr);
    return { amount: BigInt(v) };
  } catch (firstError) {
    try {
      const v = await (ubi as any)["checkEntitlement()"].staticCall();
      return { amount: BigInt(v) };
    } catch { return { error: firstError as any }; }
  }
}

type ClaimResult = {
  status: "success" | "failed_gas" | "failed_kyc" | "already_claimed" | "failed_other";
  txHash?: string;
  error?: string;
};

async function claimOne(privateKey: string, network: GDNetwork): Promise<ClaimResult> {
  try {
    const cfg = GD_NETWORKS[network];
    const provider = providerFor(network);
    const signer = new Wallet(privateKey, provider);
    const ubi = new Contract(cfg.ubiSchemeAddress, UBI_ABI, signer);
    const identity = new Contract(cfg.identityAddress, IDENTITY_ABI, provider);
    const addr = (await signer.getAddress()).toLowerCase();

    try {
      const ok = await identity.isWhitelisted(addr);
      if (!ok) return { status: "failed_kyc", error: "not whitelisted" };
    } catch { /* let on-chain decide */ }

    const ent = await readEntitlement(ubi, addr);
    if (typeof ent.amount === "bigint") {
      if (ent.amount === 0n && await verifyPriorClaim(ubi, provider, addr)) {
        return { status: "already_claimed", error: "Verified claim in current on-chain period" };
      }
    }

    let tx;
    try {
      const feeData = await provider.getFeeData();
      const estimatedGas = BigInt(await (ubi as any).claim.estimateGas());
      const reported = feeData.gasPrice ?? feeData.maxFeePerGas ?? null;
      const gasUnitPrice = reported && reported > 0n ? reported : null;
      const gasLimit = (estimatedGas * 120n) / 100n;
      if (gasUnitPrice) {
        const balance = await provider.getBalance(addr);
        const required = gasLimit * gasUnitPrice;
        if (balance < required) {
          const nativeLabel = network === "xdc" ? "XDC" : "CELO";
          return { status: "failed_gas", error: `insufficient ${nativeLabel} for gas: has ${fmt(balance)}, needs ~${fmt(required)}` };
        }
      }
      tx = await (ubi as any).claim({
        gasLimit,
        ...(gasUnitPrice ? { gasPrice: gasUnitPrice } : {}),
      });
    } catch (e: any) {

      const cls = classifyError(e);
      const msg = (e?.shortMessage || e?.reason || e?.message || "claim revert").slice(0, 240);
      if (cls === "gas") return { status: "failed_gas", error: msg };
      if (cls === "kyc") return { status: "failed_kyc", error: msg };
      if (cls === "already" && await verifyPriorClaim(ubi, provider, addr)) return { status: "already_claimed", error: "Verified claim in current on-chain period" };
      return { status: "failed_other", error: msg };
    }
    try {
      const receipt = await tx.wait(1, RECEIPT_TIMEOUT_MS);
      if (receipt && receipt.status === 1) {
        // Strict verification: the tx only counts as a real claim when the G$
        // token emitted Transfer(to = wallet) with a non-zero amount. A mined
        // tx alone is NOT proof — GoodDollar's claim() can be a silent no-op.
        const received = receivedGd(receipt.logs || [], addr, cfg.gdTokenAddress);
        if (received) return { status: "success", txHash: tx.hash };
        return { status: "failed_other", txHash: tx.hash, error: "Claim unconfirmed: no verified G$ transfer received" };
      }
      return { status: "failed_other", txHash: tx.hash, error: "tx reverted" };

    } catch (e: any) {
      return { status: "failed_other", txHash: tx?.hash, error: (e?.message || String(e)).slice(0, 240) };
    }
  } catch (e: any) {
    const cls = classifyError(e);
    const msg = (e?.message || String(e)).slice(0, 240);
    if (cls === "gas") return { status: "failed_gas", error: msg };
    if (cls === "kyc") return { status: "failed_kyc", error: msg };
    return { status: "failed_other", error: msg };
  }
}

// Claim with automatic retry across different RPC endpoints. A wallet is only
// recorded as failed once a real (non-transient) outcome is known.
async function claimWithRetry(privateKey: string, network: GDNetwork): Promise<ClaimResult> {
  let last: ClaimResult = { status: "failed_other", error: "unknown" };
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      last = await withTimeout(claimOne(privateKey, network), WALLET_TIMEOUT_MS, "wallet");
    } catch (e: any) {
      last = { status: "failed_other", error: (e?.message || String(e)).slice(0, 240) };
    }
    if (last.status !== "failed_other") return last;
    if (!isTransient(last.error || "")) return last;
    rpcCursor++; // move to another endpoint
    await new Promise((r) => setTimeout(r, 1200 * (attempt + 1)));
  }
  return last;
}



function selfKick(runId: string, phase: string) {
  const p = fetch(WORKER_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${SERVICE_KEY}`,
      apikey: SERVICE_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ run_id: runId, phase }),
  }).catch(() => {});
  // Keep the isolate alive until the hand-off request has actually been sent,
  // otherwise the chain can silently break and the run stalls.
  try { (globalThis as any).EdgeRuntime?.waitUntil?.(p); } catch { /* ignore */ }
}


async function removeSavedKycWallet(ownerUserId: string | null | undefined, walletAddress: string, network: GDNetwork) {
  if (!ownerUserId || !walletAddress) return;
  try {
    await admin
      .from("daily_claim_wallets")
      .delete()
      .eq("owner_user_id", ownerUserId)
      .eq("network", network)
      .eq("wallet_address", walletAddress);
  } catch (e) {
    console.warn("kyc wallet auto-remove failed", String((e as any)?.message || e));
  }
}

async function removeKycWalletsForRun(runId: string, network: GDNetwork) {
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data: rows } = await admin
      .from("daily_claim_run_items")
      .select("owner_user_id, wallet_address")
      .eq("run_id", runId)
      .eq("final_status", "failed_kyc")
      .range(from, from + PAGE - 1);
    const page = rows || [];
    if (page.length === 0) break;

    const byOwner = new Map<string, string[]>();
    for (const r of page as any[]) {
      const owner = String(r.owner_user_id || "");
      const wallet = String(r.wallet_address || "");
      if (!owner || !wallet) continue;
      const list = byOwner.get(owner) || [];
      list.push(wallet);
      byOwner.set(owner, list);
    }

    for (const [owner, wallets] of byOwner.entries()) {
      for (let i = 0; i < wallets.length; i += 500) {
        await admin
          .from("daily_claim_wallets")
          .delete()
          .eq("owner_user_id", owner)
          .eq("network", network)
          .in("wallet_address", wallets.slice(i, i + 500));
      }
    }

    if (page.length < PAGE) break;
  }
}


async function refreshCounters(runId: string) {
  const count = async (apply: (q: any) => any) => {
    const { count: c } = await apply(
      admin.from("daily_claim_run_items").select("id", { count: "exact", head: true }).eq("run_id", runId),
    );
    return c || 0;
  };
  const [success, finalGas, finalKyc, finalOther, alreadyClaimed, pendingGas] = await Promise.all([
    count((q) => q.eq("final_status", "success")),
    count((q) => q.eq("final_status", "failed_gas")),
    count((q) => q.eq("final_status", "failed_kyc")),
    count((q) => q.eq("final_status", "failed_other")),
    count((q) => q.eq("final_status", "already_claimed")),
    count((q) => q.eq("final_status", "pending").eq("phase1_status", "failed_gas")),
  ]);
  const failed_gas = finalGas + pendingGas;
  const failed_other = finalKyc + finalOther + alreadyClaimed;
  const final_failed = finalGas + finalKyc + finalOther;
  await admin.from("daily_claim_runs").update({
    success, failed_gas, failed_other, final_failed,
    updated_at: new Date().toISOString(),
  }).eq("id", runId);
}

async function runPhase1(runId: string, network: GDNetwork, deadline: number) {
  // Recover wallets stuck in "claiming" from a previous worker invocation that
  // died mid-flight (timeout/crash before writing the result patch). Without
  // this, those rows are orphaned and the run completes with phantom "missing"
  // wallets (e.g. 985 total / 975 success / 10 silently stuck).
  const staleCutoff = new Date(Date.now() - 2 * 60 * 1000).toISOString();
  await admin.from("daily_claim_run_items")
    .update({ phase1_status: "pending" })
    .eq("run_id", runId)
    .eq("phase1_status", "claiming")
    .eq("final_status", "pending")
    .lt("updated_at", staleCutoff);

  // Recover retryable RPC/nonce rows that were left as failed_other + pending
  // by an older invocation. These rows are not terminal outcomes, so the run
  // must keep processing them instead of completing with invisible leftovers.
  const { data: stranded } = await admin
    .from("daily_claim_run_items")
    .select("id, phase1_error, final_status")
    .eq("run_id", runId)
    .eq("phase1_status", "failed_other")
    .limit(1000);
  const retryableIds = (stranded || [])
    .filter((r: any) => r.final_status === "pending" || isTransient(r.phase1_error || ""))
    .map((r: any) => r.id);
  if (retryableIds.length > 0) {
    await admin.from("daily_claim_run_items")
      .update({ phase1_status: "pending", final_status: "pending" })
      .in("id", retryableIds);
  }

  while (Date.now() < deadline) {
    const { data: rows } = await admin
      .from("daily_claim_run_items")
      .select("id, owner_user_id, wallet_address, encrypted_key, attempts")
      .eq("run_id", runId)
      .eq("phase1_status", "pending")
      .limit(CLAIM_WAVE_SIZE);
    if (!rows || rows.length === 0) break;


    const ids = rows.map((r: any) => r.id);
    await admin.from("daily_claim_run_items").update({ phase1_status: "claiming" }).in("id", ids);

    await Promise.all(rows.map(async (r: any) => {
      const tries = (r.attempts || 0) + 1;
      try {
        const pk = await decryptKey(r.encrypted_key);
        const res = await claimWithRetry(pk, network);
        // Still a transient node failure after retries → keep the wallet in the
        // queue instead of burning it as a permanent failure.
        if (res.status === "failed_other" && isTransient(res.error || "")) {
          await admin.from("daily_claim_run_items").update({
            phase1_status: "pending",
            phase1_error: (res.error || "").slice(0, 240),
            attempts: tries,
          }).eq("id", r.id);
          return;
        }
        const patch: any = {
          phase1_status: res.status,
          phase1_tx: res.txHash || null,
          phase1_error: res.error || null,
          attempts: tries,
        };
        if (res.status === "success" || res.status === "already_claimed" || res.status === "failed_kyc") {
          patch.final_status = res.status;
          if (res.status === "success") patch.encrypted_key = null;
          if (res.status === "failed_kyc") await removeSavedKycWallet(r.owner_user_id, r.wallet_address, network);
        } else if (res.status === "failed_other") {
          patch.final_status = "failed_other";
        }

        await admin.from("daily_claim_run_items").update(patch).eq("id", r.id);
      } catch (e: any) {
        const msg = (e?.message || String(e)).slice(0, 240);
        if (isTransient(msg)) {
          await admin.from("daily_claim_run_items").update({
            phase1_status: "pending", phase1_error: msg, attempts: tries,
          }).eq("id", r.id);
          return;
        }
        await admin.from("daily_claim_run_items").update({
          phase1_status: "failed_other",
          phase1_error: msg,
          final_status: "failed_other",
          attempts: tries,
        }).eq("id", r.id);
      }

    }));

    await removeKycWalletsForRun(runId, network);

    await refreshCounters(runId);
    await new Promise((r) => setTimeout(r, CLAIM_WAVE_GAP_MS));
  }

  // Count anything not yet resolved — including rows still "claiming" from a
  // crashed wave. Those get reset to "pending" by the recovery step at the top
  // of the next runPhase1 invocation.
  const { count: pendingLeft } = await admin
    .from("daily_claim_run_items")
    .select("id", { count: "exact", head: true })
    .eq("run_id", runId)
    .eq("final_status", "pending")
    .in("phase1_status", ["pending", "claiming", "failed_other"]);
  if ((pendingLeft || 0) > 0) {
    selfKick(runId, "claiming");
    return false;
  }


  const { count: gasNeeded } = await admin
    .from("daily_claim_run_items")
    .select("id", { count: "exact", head: true })
    .eq("run_id", runId)
    .eq("phase1_status", "failed_gas")
    .eq("final_status", "pending");

  await admin.from("daily_claim_runs").update({
    phase1_done_at: new Date().toISOString(),
    phase: (gasNeeded || 0) > 0 ? "gas_requesting" : "completed",
    gas_requests_done_at: (gasNeeded || 0) > 0 ? null : new Date().toISOString(),
    finished_at: (gasNeeded || 0) > 0 ? null : new Date().toISOString(),
  }).eq("id", runId);

  if ((gasNeeded || 0) > 0) selfKick(runId, "gas_requesting");
  return true;
}

async function runGasRequesting(runId: string, network: GDNetwork, _deadline: number) {
  const { data: parentRun } = await admin.from("daily_claim_runs").select("owner_user_id").eq("id", runId).maybeSingle();
  if (!parentRun?.owner_user_id) return;
  const { data: needGas } = await admin
    .from("daily_claim_run_items")
    .select("id, wallet_address")
    .eq("run_id", runId)
    .eq("phase1_status", "failed_gas")
    .eq("final_status", "pending")
    .is("gas_request_status", null);

  if (needGas && needGas.length > 0) {
    const batchName = `daily-claim-${network}-${runId.slice(0, 8)}`;
    let jobId: string | null = null;
    const { data: existingJobs } = await admin
      .from("gas_load_jobs")
      .select("id, status")
      .eq("batch_name", batchName)
      .in("status", ["pending", "running"])
      .order("created_at", { ascending: true })
      .limit(1);
    jobId = existingJobs?.[0]?.id || null;

    if (!jobId) {
      const jobRes = await admin.from("gas_load_jobs").insert({
        owner_user_id: parentRun.owner_user_id,
        total: needGas.length,
        delay_ms: 3000,
        status: "pending",
        batch_name: batchName,
        network,
        max_retries: 2,
      }).select("id").single();
      jobId = jobRes.data?.id || null;
    }

    if (jobId) {
      const queueRows = needGas.map((r: any) => ({
        job_id: jobId,
        wallet_address: r.wallet_address,
        status: "pending",
      }));
      const { data: existingQueue } = await admin
        .from("gas_load_queue")
        .select("wallet_address")
        .eq("job_id", jobId);
      const queued = new Set((existingQueue || []).map((q: any) => String(q.wallet_address || "").toLowerCase()));
      const missingRows = queueRows.filter((r: any) => !queued.has(String(r.wallet_address).toLowerCase()));
      const BATCH = 500;
      for (let i = 0; i < missingRows.length; i += BATCH) {
        await admin.from("gas_load_queue").insert(missingRows.slice(i, i + BATCH));
      }
      await admin
        .from("daily_claim_run_items")
        .update({
          gas_request_status: "requested",
          gas_requested_at: new Date().toISOString(),
          gas_tx: jobId,
        })
        .in("id", needGas.map((r: any) => r.id));

      fetch(`${SUPABASE_URL}/functions/v1/gas-loader-worker`, {
        method: "POST",
        headers: { Authorization: `Bearer ${SERVICE_KEY}`, apikey: SERVICE_KEY, "Content-Type": "application/json" },
        body: JSON.stringify({ trigger: "daily-claim", job_id: jobId }),
      }).catch(() => {});
    }
  }

  const { data: requested } = await admin
    .from("daily_claim_run_items")
    .select("id, wallet_address, gas_tx")
    .eq("run_id", runId)
    .eq("gas_request_status", "requested");

  if (requested && requested.length > 0) {
    const byJob = new Map<string, { id: string; wallet_address: string }[]>();
    for (const r of requested as any[]) {
      const j = r.gas_tx;
      if (!j) continue;
      if (!byJob.has(j)) byJob.set(j, []);
      byJob.get(j)!.push({ id: r.id, wallet_address: r.wallet_address });
    }
    for (const [jobId, items] of byJob.entries()) {
      const { data: queueRows } = await admin
        .from("gas_load_queue")
        .select("wallet_address, status, tx_hash, error_message")
        .eq("job_id", jobId);
      const map = new Map<string, any>();
      for (const q of queueRows || []) map.set(String(q.wallet_address).toLowerCase(), q);
      for (const it of items) {
        const q = map.get(it.wallet_address.toLowerCase());
        if (!q) continue;
        if (q.status === "success") {
          await admin.from("daily_claim_run_items").update({
            gas_request_status: "done",
            gas_tx: q.tx_hash || null,
          }).eq("id", it.id);
        } else if (q.status === "failed" || q.status === "skipped") {
          await admin.from("daily_claim_run_items").update({
            gas_request_status: "error",
            gas_tx: null,
            phase1_error: (q.error_message || "gas load failed").slice(0, 240),
          }).eq("id", it.id);
        }
      }
    }
  }

  const { count: leftRequested } = await admin
    .from("daily_claim_run_items")
    .select("id", { count: "exact", head: true })
    .eq("run_id", runId)
    .eq("gas_request_status", "requested");

  if ((leftRequested || 0) > 0) {
    setTimeout(() => selfKick(runId, "gas_requesting"), 15_000);
    return false;
  }

  await admin.from("daily_claim_runs").update({
    phase: "waiting_30m",
    gas_requests_done_at: new Date().toISOString(),
  }).eq("id", runId);
  return true;
}

async function runRetrying(runId: string, network: GDNetwork, deadline: number) {
  // Match phase-one recovery: a dead invocation must not strand its retry wave.
  await recoverStalledRetry(admin, runId);
  const { data: strandedRetry } = await admin
    .from("daily_claim_run_items")
    .select("id, phase2_error, final_status")
    .eq("run_id", runId)
    .eq("phase1_status", "failed_gas")
    .eq("phase2_status", "failed_other")
    .limit(1000);
  const retryIds = (strandedRetry || [])
    .filter((r: any) => r.final_status === "pending" || isTransient(r.phase2_error || ""))
    .map((r: any) => r.id);
  if (retryIds.length > 0) {
    await admin.from("daily_claim_run_items")
      .update({ phase2_status: "pending", final_status: "pending" })
      .in("id", retryIds);
  }

  while (Date.now() < deadline) {
    const { data: rows } = await admin
      .from("daily_claim_run_items")
      .select("id, owner_user_id, wallet_address, encrypted_key")
      .eq("run_id", runId)
      .eq("phase1_status", "failed_gas")
      .eq("final_status", "pending")
      .or("phase2_status.is.null,phase2_status.eq.pending")
      .limit(CLAIM_WAVE_SIZE);
    if (!rows || rows.length === 0) break;

    const ids = rows.map((r: any) => r.id);
    await admin.from("daily_claim_run_items").update({ phase2_status: "claiming" }).in("id", ids);

    await Promise.all(rows.map(async (r: any) => {
      try {
        const pk = await decryptKey(r.encrypted_key);
        const res = await claimWithRetry(pk, network);
        if (res.status === "failed_other" && isTransient(res.error || "")) {
          await admin.from("daily_claim_run_items").update({
            phase2_status: "pending",
            phase2_error: (res.error || "").slice(0, 240),
            final_status: "pending",
          }).eq("id", r.id);
          return;
        }
        const patch: any = {
          phase2_status: res.status,
          phase2_tx: res.txHash || null,
          phase2_error: res.error || null,
          final_status: res.status,
          attempts: 2,
        };
        if (res.status === "success") patch.encrypted_key = null;
        if (res.status === "failed_kyc") await removeSavedKycWallet(r.owner_user_id, r.wallet_address, network);
        await admin.from("daily_claim_run_items").update(patch).eq("id", r.id);
      } catch (e: any) {
        const msg = (e?.message || String(e)).slice(0, 240);
        if (isTransient(msg)) {
          await admin.from("daily_claim_run_items").update({
            phase2_status: "pending", phase2_error: msg, final_status: "pending",
          }).eq("id", r.id);
          return;
        }
        await admin.from("daily_claim_run_items").update({
          phase2_status: "failed_other",
          phase2_error: msg,
          final_status: "failed_other",
          attempts: 2,
        }).eq("id", r.id);
      }
    }));

    await refreshCounters(runId);
    await new Promise((r) => setTimeout(r, CLAIM_WAVE_GAP_MS));
  }

  const { count: leftRetry } = await admin
    .from("daily_claim_run_items")
    .select("id", { count: "exact", head: true })
    .eq("run_id", runId)
    .eq("phase1_status", "failed_gas")
    .eq("final_status", "pending");
  if ((leftRetry || 0) > 0) {
    selfKick(runId, "retrying");
    return false;
  }

  await refreshCounters(runId);
  await removeKycWalletsForRun(runId, network);
  await admin.from("daily_claim_runs").update({
    phase: "completed",
    finished_at: new Date().toISOString(),
  }).eq("id", runId);
  return true;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  let body: any = {};
  try { body = await req.json(); } catch { /* ignore */ }
  const runId: string | undefined = body?.run_id;
  if (!runId) return new Response(JSON.stringify({ error: "run_id required" }), { status: 400, headers: corsHeaders });

  if (inFlight.has(runId)) {
    return new Response(JSON.stringify({ ok: true, skipped: "already running" }), { headers: corsHeaders });
  }
  inFlight.add(runId);
  const deadline = Date.now() + TIME_BUDGET_MS;

  try {
    const { data: run } = await admin.from("daily_claim_runs").select("*").eq("id", runId).maybeSingle();
    if (!run) return new Response(JSON.stringify({ error: "run not found" }), { status: 404, headers: corsHeaders });

    const network = resolveNetwork(run.network).id;
    let phase = body?.phase || run.phase;
    if (phase === "claiming") await runPhase1(runId, network, deadline);
    else if (phase === "gas_requesting") await runGasRequesting(runId, network, deadline);
    else if (phase === "retrying") await runRetrying(runId, network, deadline);
    return new Response(JSON.stringify({ ok: true, phase }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e: any) {
    return new Response(JSON.stringify({ ok: false, error: e?.message || String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } finally {
    inFlight.delete(runId);
  }
});
