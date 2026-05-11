// Daily claim worker. Drives a single run through 4 phases:
//   1) claiming        — try claim() on every wallet (slow, parallel waves)
//   2) gas_requesting  — for failed_gas wallets, hit free-gas-load with 3s gap
//   3) waiting_30m     — handed off to the scheduler (no work here)
//   4) retrying        — re-claim failed_gas wallets ONCE, set final_status
// Self-recursive: when its time-budget runs low it re-invokes itself.

import { Wallet, JsonRpcProvider, Contract, formatEther } from "npm:ethers@6.13.4";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { decryptKey } from "../_shared/dailyCrypto.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const admin = createClient(SUPABASE_URL, SERVICE_KEY);

const CELO_RPC = "https://forno.celo.org";
const IDENTITY_ADDRESS = "0xC361A6E67822a0EDc17D899227dd9FC50BD62F42";
const UBI_SCHEME_ADDRESS = "0x43d72Ff17701B2DA814620735C39C620Ce0ea4A1";
const UBI_ABI = [
  "function claim() returns (uint256)",
  "function checkEntitlement(address member) view returns (uint256)",
  "function checkEntitlement() view returns (uint256)",
];
const IDENTITY_ABI = ["function isWhitelisted(address account) view returns (bool)"];

const provider = new JsonRpcProvider(CELO_RPC, 42220);

const CLAIM_WAVE_SIZE = 8;        // wallets in flight at once for claim
const CLAIM_WAVE_GAP_MS = 1500;   // pause between waves to keep it slow
const GAS_GAP_MS = 3000;          // 3 sec between gas requests
const RECEIPT_TIMEOUT_MS = 60_000;
const TIME_BUDGET_MS = 110_000;

const WORKER_URL = `${SUPABASE_URL}/functions/v1/daily-claim-worker`;
const FREE_GAS_URL = `${SUPABASE_URL}/functions/v1/free-gas-load`;

const inFlight = new Set<string>();

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

async function claimOne(privateKey: string): Promise<ClaimResult> {
  try {
    const signer = new Wallet(privateKey, provider);
    const ubi = new Contract(UBI_SCHEME_ADDRESS, UBI_ABI, signer);
    const identity = new Contract(IDENTITY_ADDRESS, IDENTITY_ABI, provider);
    const addr = (await signer.getAddress()).toLowerCase();

    try {
      const ok = await identity.isWhitelisted(addr);
      if (!ok) return { status: "failed_kyc", error: "not whitelisted" };
    } catch { /* let on-chain decide */ }

    const ent = await readEntitlement(ubi, addr);
    if (typeof ent.amount === "bigint") {
      if (ent.amount === 0n) return { status: "already_claimed", error: "no entitlement (already claimed today)" };
    }

    let tx;
    try {
      const feeData = await provider.getFeeData();
      const estimatedGas = BigInt(await (ubi as any).claim.estimateGas());
      const gasUnitPrice = feeData.maxFeePerGas ?? feeData.gasPrice;
      if (gasUnitPrice) {
        const balance = await provider.getBalance(addr);
        const required = estimatedGas * gasUnitPrice;
        if (balance < required) {
          return { status: "failed_gas", error: `insufficient CELO for gas: has ${fmt(balance)}, needs ~${fmt(required)}` };
        }
      }
      tx = await (ubi as any).claim({ gasLimit: (estimatedGas * 120n) / 100n });
    } catch (e: any) {
      const cls = classifyError(e);
      const msg = (e?.shortMessage || e?.reason || e?.message || "claim revert").slice(0, 240);
      if (cls === "gas") return { status: "failed_gas", error: msg };
      if (cls === "kyc") return { status: "failed_kyc", error: msg };
      if (cls === "already") return { status: "already_claimed", error: msg };
      return { status: "failed_other", error: msg };
    }
    try {
      const receipt = await tx.wait(1, RECEIPT_TIMEOUT_MS);
      if (receipt && receipt.status === 1) {
        const logs = (receipt.logs || []) as any[];
        const touched = logs.some((l) => (l.topics || []).some((t: string) => typeof t === "string" && t.toLowerCase().endsWith(addr.slice(2))));
        if (touched) return { status: "success", txHash: tx.hash };
        return { status: "already_claimed", txHash: tx.hash, error: "claim no-op" };
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
    if (cls === "already") return { status: "already_claimed", error: msg };
    return { status: "failed_other", error: msg };
  }
}

function selfKick(runId: string, phase: string) {
  fetch(WORKER_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${SERVICE_KEY}`,
      apikey: SERVICE_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ run_id: runId, phase }),
  }).catch(() => {});
}

async function refreshCounters(runId: string) {
  const { data: items } = await admin
    .from("daily_claim_run_items")
    .select("phase1_status, final_status")
    .eq("run_id", runId);
  let success = 0, failed_gas = 0, failed_other = 0, final_failed = 0;
  for (const r of items || []) {
    const fs = r.final_status;
    if (fs === "success") success++;
    else if (fs === "failed_gas") { failed_gas++; final_failed++; }
    else if (fs === "failed_kyc" || fs === "failed_other" || fs === "already_claimed") {
      failed_other++;
      if (fs !== "already_claimed") final_failed++;
    }
    if (r.phase1_status === "failed_gas" && fs === "pending") failed_gas++;
  }
  await admin.from("daily_claim_runs").update({
    success, failed_gas, failed_other, final_failed,
    updated_at: new Date().toISOString(),
  }).eq("id", runId);
}

async function runPhase1(runId: string, deadline: number) {
  // Pick pending phase1 items in waves
  while (Date.now() < deadline) {
    const { data: rows } = await admin
      .from("daily_claim_run_items")
      .select("id, wallet_address, encrypted_key")
      .eq("run_id", runId)
      .eq("phase1_status", "pending")
      .limit(CLAIM_WAVE_SIZE);
    if (!rows || rows.length === 0) break;

    // Mark claiming
    const ids = rows.map((r: any) => r.id);
    await admin.from("daily_claim_run_items").update({ phase1_status: "claiming" }).in("id", ids);

    await Promise.all(rows.map(async (r: any) => {
      try {
        const pk = await decryptKey(r.encrypted_key);
        const res = await claimOne(pk);
        const patch: any = {
          phase1_status: res.status,
          phase1_tx: res.txHash || null,
          phase1_error: res.error || null,
          attempts: 1,
        };
        if (res.status === "success" || res.status === "already_claimed" || res.status === "failed_kyc") {
          patch.final_status = res.status;
          if (res.status === "success") patch.encrypted_key = null;
        }
        await admin.from("daily_claim_run_items").update(patch).eq("id", r.id);
      } catch (e: any) {
        await admin.from("daily_claim_run_items").update({
          phase1_status: "failed_other",
          phase1_error: (e?.message || String(e)).slice(0, 240),
          final_status: "failed_other",
          attempts: 1,
        }).eq("id", r.id);
      }
    }));

    await refreshCounters(runId);
    await new Promise((r) => setTimeout(r, CLAIM_WAVE_GAP_MS));
  }

  // Any pending left? continue later.
  const { count: pendingLeft } = await admin
    .from("daily_claim_run_items")
    .select("id", { count: "exact", head: true })
    .eq("run_id", runId)
    .eq("phase1_status", "pending");
  if ((pendingLeft || 0) > 0) {
    selfKick(runId, "claiming");
    return false;
  }

  // Phase 1 done. Move to gas_requesting (or skip directly to retrying if no failed_gas).
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

async function runGasRequesting(runId: string, _deadline: number) {
  // Bulk-create ONE gas_load job for all failed_gas wallets needing gas.
  // The existing gas-loader-worker (pg_cron, proxy IP rotation, 3s delay)
  // will process them in the background. We then wait until all queued
  // wallets reach a terminal status, marking each item's gas_request_status.

  // Find items still needing a gas request
  const { data: needGas } = await admin
    .from("daily_claim_run_items")
    .select("id, wallet_address")
    .eq("run_id", runId)
    .eq("phase1_status", "failed_gas")
    .eq("final_status", "pending")
    .is("gas_request_status", null);

  if (needGas && needGas.length > 0) {
    // Create one job
    const jobRes = await admin.from("gas_load_jobs").insert({
      total: needGas.length,
      delay_ms: 3000,
      status: "pending",
      batch_name: `daily-claim-${runId.slice(0, 8)}`,
    }).select("id").single();

    if (jobRes.data?.id) {
      const jobId = jobRes.data.id;
      const queueRows = needGas.map((r: any) => ({
        job_id: jobId,
        wallet_address: r.wallet_address,
        status: "pending",
      }));
      const BATCH = 500;
      for (let i = 0; i < queueRows.length; i += BATCH) {
        await admin.from("gas_load_queue").insert(queueRows.slice(i, i + BATCH));
      }
      // Mark items as 'requested' with the job id stored in gas_tx temporarily
      await admin
        .from("daily_claim_run_items")
        .update({
          gas_request_status: "requested",
          gas_requested_at: new Date().toISOString(),
          gas_tx: jobId, // store job id so we can poll
        })
        .in("id", needGas.map((r: any) => r.id));

      // Kick the gas worker
      fetch(`${SUPABASE_URL}/functions/v1/gas-loader-worker`, {
        method: "POST",
        headers: { Authorization: `Bearer ${SERVICE_KEY}`, apikey: SERVICE_KEY, "Content-Type": "application/json" },
        body: JSON.stringify({ trigger: "daily-claim", job_id: jobId }),
      }).catch(() => {});
    }
  }

  // Poll: count items still 'requested'. If gas-loader queue rows for
  // those wallets are all in terminal status, mark our items 'done'/'error'.
  const { data: requested } = await admin
    .from("daily_claim_run_items")
    .select("id, wallet_address, gas_tx")
    .eq("run_id", runId)
    .eq("gas_request_status", "requested");

  if (requested && requested.length > 0) {
    // Group by job id
    const byJob = new Map<string, { id: string; wallet_address: string }[]>();
    for (const r of requested as any[]) {
      const j = r.gas_tx;
      if (!j) continue;
      if (!byJob.has(j)) byJob.set(j, []);
      byJob.get(j)!.push({ id: r.id, wallet_address: r.wallet_address });
    }
    for (const [jobId, items] of byJob.entries()) {
      const addrs = items.map((i) => i.wallet_address.toLowerCase());
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

  // Anything still requested? Re-poll later.
  const { count: leftRequested } = await admin
    .from("daily_claim_run_items")
    .select("id", { count: "exact", head: true })
    .eq("run_id", runId)
    .eq("gas_request_status", "requested");

  if ((leftRequested || 0) > 0) {
    // Re-kick after a short wait so we poll again
    setTimeout(() => selfKick(runId, "gas_requesting"), 15_000);
    return false;
  }

  // All gas requests complete (done or error). Move to waiting_30m.
  await admin.from("daily_claim_runs").update({
    phase: "waiting_30m",
    gas_requests_done_at: new Date().toISOString(),
  }).eq("id", runId);
  return true;
}

async function runRetrying(runId: string, deadline: number) {
  while (Date.now() < deadline) {
    const { data: rows } = await admin
      .from("daily_claim_run_items")
      .select("id, wallet_address, encrypted_key")
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
        const res = await claimOne(pk);
        const patch: any = {
          phase2_status: res.status,
          phase2_tx: res.txHash || null,
          phase2_error: res.error || null,
          final_status: res.status,
          attempts: 2,
        };
        if (res.status === "success") patch.encrypted_key = null;
        await admin.from("daily_claim_run_items").update(patch).eq("id", r.id);
      } catch (e: any) {
        await admin.from("daily_claim_run_items").update({
          phase2_status: "failed_other",
          phase2_error: (e?.message || String(e)).slice(0, 240),
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

    let phase = body?.phase || run.phase;
    if (phase === "claiming") await runPhase1(runId, deadline);
    else if (phase === "gas_requesting") await runGasRequesting(runId, deadline);
    else if (phase === "retrying") await runRetrying(runId, deadline);
    else if (phase === "waiting_30m") {
      // No-op, scheduler handles it
    }

    return new Response(JSON.stringify({ ok: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e: any) {
    console.error("daily-claim-worker error", e?.message || e);
    return new Response(JSON.stringify({ ok: false, error: e?.message || String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } finally {
    inFlight.delete(runId);
  }
});
