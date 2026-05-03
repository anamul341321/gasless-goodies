// GoodDollar batch claim worker (parallel mode).
//
// Strategy:
//   - Pick up to BATCH_SIZE pending wallets from gd_claim_queue.
//   - Mark them all 'claiming' atomically.
//   - Fire UBIScheme.claim() in parallel for ALL of them (no waiting between
//     wallets, no waiting for receipt before sending the next). Each call
//     uses the wallet's own nonce so they don't collide.
//   - For each wallet, await the receipt to record success/failure.
//   - Classify failures:
//       * insufficient gas       -> status 'failed_gas'  (key kept for user)
//       * not whitelisted / KYC  -> status 'failed_kyc'  (key kept for user)
//       * anything else          -> status 'failed'      (key kept for user)
//   - DOES NOT auto-request gas from any faucet — that responsibility is
//     handled separately (or not at all).
//
//   Gas: ethers picks gas params automatically (no overrides), so the fee
//   matches what gooddapp.org pays.

import { Wallet, JsonRpcProvider, Contract } from "npm:ethers@6.13.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const CELO_RPC = "https://forno.celo.org";
const UBI_SCHEME_ADDRESS = "0x43d72Ff17701B2DA814620735C39C620Ce0ea4A1";
const UBI_ABI = ["function claim() returns (bool)"];

const WORKER_TRIGGER_URL = `${SUPABASE_URL}/functions/v1/gd-claim-worker`;

const BATCH_SIZE = 100;             // wallets per parallel wave
const RECEIPT_TIMEOUT_MS = 90_000;  // wait at most 90s for each receipt
const WORKER_TIME_BUDGET_MS = 110_000;

function sbHeaders(extra: Record<string, string> = {}) {
  return {
    "Content-Type": "application/json",
    apikey: SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    ...extra,
  };
}

const provider = new JsonRpcProvider(CELO_RPC, 42220);

type QueueRow = {
  id: string;
  job_id: string;
  wallet_address: string;
  private_key: string;
  attempts: number;
};

function classifyError(err: any): "gas" | "kyc" | "other" {
  const raw = (err?.message || err?.shortMessage || err?.reason || String(err) || "").toLowerCase();
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

async function pickPendingBatch(): Promise<QueueRow[]> {
  const findRes = await fetch(
    `${SUPABASE_URL}/rest/v1/gd_claim_queue?status=eq.pending&select=id,job_id,wallet_address,private_key,attempts&order=created_at.asc&limit=${BATCH_SIZE}`,
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
  const winners = rows.filter((r: any) => claimedIds.has(r.id));

  // Mark involved jobs as 'running'
  const jobIds = [...new Set(winners.map((r: any) => r.job_id))];
  for (const jid of jobIds) {
    fetch(`${SUPABASE_URL}/rest/v1/gd_claim_jobs?id=eq.${jid}&status=eq.pending`, {
      method: "PATCH",
      headers: sbHeaders({ Prefer: "return=minimal" }),
      body: JSON.stringify({ status: "running", updated_at: new Date().toISOString() }),
    }).catch(() => {});
  }

  return winners as QueueRow[];
}

async function claimOne(row: QueueRow): Promise<{
  status: "success" | "failed_gas" | "failed_kyc" | "failed";
  txHash?: string;
  error?: string;
}> {
  try {
    const signer = new Wallet(row.private_key, provider);
    const ubi = new Contract(UBI_SCHEME_ADDRESS, UBI_ABI, signer);
    let tx;
    try {
      // No gas overrides -> ethers + node estimate (matches gooddapp.org).
      tx = await ubi.claim();
    } catch (e: any) {
      const cls = classifyError(e);
      const msg = (e?.shortMessage || e?.reason || e?.message || "claim revert").slice(0, 240);
      if (cls === "gas") return { status: "failed_gas", error: msg };
      if (cls === "kyc") return { status: "failed_kyc", error: msg };
      return { status: "failed", error: msg };
    }
    try {
      const receipt = await tx.wait(1, RECEIPT_TIMEOUT_MS);
      if (receipt && receipt.status === 1) {
        return { status: "success", txHash: tx.hash };
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
  // Run all claims fully in parallel — each wallet has its own nonce.
  const settled = await Promise.all(rows.map(async (r) => {
    const res = await claimOne(r);
    await finalize(r, res);
    return r.job_id;
  }));
  // Aggregate per affected job, once.
  const jobIds = [...new Set(settled)];
  for (const jid of jobIds) await refreshJobAggregate(jid);
}

async function processLoop(): Promise<{ processed: number; remaining: boolean }> {
  const startedAt = Date.now();
  let processed = 0;

  while (Date.now() - startedAt < WORKER_TIME_BUDGET_MS) {
    const batch = await pickPendingBatch();
    if (batch.length === 0) break;
    await processWave(batch);
    processed += batch.length;
    if (batch.length < BATCH_SIZE) break;
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
