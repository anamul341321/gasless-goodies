// Background worker: claims GoodDollar G$ on Celo for queued wallets.
// Pacing: 10s between wallets (no IP rotation needed — claim() is on-chain).
// Gas-fail handling: on insufficient funds, marks wallet 'needs_gas',
// enqueues a free-gas faucet job for that wallet, then on next pass
// flips back to 'pending' so the claim is retried after gas arrives.

import { Wallet, JsonRpcProvider, Contract } from "https://esm.sh/ethers@6.13.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const CELO_RPC = "https://forno.celo.org";
const UBI_SCHEME_ADDRESS = "0x43d72Ff17701B2DA814620735C39C620Ce0ea4A1";
const UBI_ABI = [
  "function claim() returns (bool)",
  "function checkEntitlement(address member) view returns (uint256)",
];

// Faucet endpoint (existing internal worker)
const FAUCET_TRIGGER_URL = `${SUPABASE_URL}/functions/v1/gas-loader-worker`;

// Pacing
const PER_WALLET_DELAY_MS = 10_000; // 10s between wallets (per request)
const WORKER_TIME_BUDGET_MS = 110_000;
const GAS_RETRY_AFTER_MS = 60_000; // wait at least 60s after gas request before retry
const MAX_GAS_REQUESTS = 3; // give up after 3 failed gas refills
const MAX_ATTEMPTS = 5;

const WORKER_TRIGGER_URL = `${SUPABASE_URL}/functions/v1/gd-claim-worker`;

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
  gas_requests: number;
  last_gas_request_at: string | null;
  status: string;
};

async function reactivateWaitingGas() {
  // Flip 'waiting_gas' rows whose last_gas_request_at is older than
  // GAS_RETRY_AFTER_MS back to 'pending' so the worker tries claim again.
  const cutoff = new Date(Date.now() - GAS_RETRY_AFTER_MS).toISOString();
  const url =
    `${SUPABASE_URL}/rest/v1/gd_claim_queue` +
    `?status=eq.waiting_gas&last_gas_request_at=lt.${encodeURIComponent(cutoff)}`;
  await fetch(url, {
    method: "PATCH",
    headers: sbHeaders({ Prefer: "return=minimal" }),
    body: JSON.stringify({
      status: "pending",
      updated_at: new Date().toISOString(),
    }),
  }).catch(() => {});
}

async function claimNextWallet(): Promise<QueueRow | null> {
  const findRes = await fetch(
    `${SUPABASE_URL}/rest/v1/gd_claim_queue?status=eq.pending&select=id,job_id,wallet_address,private_key,attempts,gas_requests,last_gas_request_at,status&order=created_at.asc&limit=1`,
    { headers: sbHeaders() }
  );
  if (!findRes.ok) return null;
  const rows = await findRes.json();
  if (!Array.isArray(rows) || rows.length === 0) return null;
  const row = rows[0] as QueueRow;

  const claimRes = await fetch(
    `${SUPABASE_URL}/rest/v1/gd_claim_queue?id=eq.${row.id}&status=eq.pending`,
    {
      method: "PATCH",
      headers: sbHeaders({ Prefer: "return=representation" }),
      body: JSON.stringify({
        status: "claiming",
        attempts: row.attempts + 1,
        updated_at: new Date().toISOString(),
      }),
    }
  );
  if (!claimRes.ok) return null;
  const claimed = await claimRes.json();
  if (!Array.isArray(claimed) || claimed.length === 0) return null;

  // Mark parent job as running on first activity
  await fetch(
    `${SUPABASE_URL}/rest/v1/gd_claim_jobs?id=eq.${row.job_id}&status=eq.pending`,
    {
      method: "PATCH",
      headers: sbHeaders({ Prefer: "return=minimal" }),
      body: JSON.stringify({ status: "running", updated_at: new Date().toISOString() }),
    }
  ).catch(() => {});

  return row;
}

async function enqueueFaucetForWallet(walletAddress: string) {
  // Create a tiny faucet job with just this wallet so the existing
  // gas-loader-worker (with proxy IP rotation) processes it.
  try {
    const jobRes = await fetch(`${SUPABASE_URL}/rest/v1/gas_load_jobs`, {
      method: "POST",
      headers: sbHeaders({ Prefer: "return=representation" }),
      body: JSON.stringify({
        total: 1,
        status: "pending",
        batch_name: `auto-gas:${walletAddress.slice(0, 10)}`,
        delay_ms: 0,
        max_retries: 2,
      }),
    });
    if (!jobRes.ok) return;
    const job = await jobRes.json();
    const jobId = (Array.isArray(job) ? job[0] : job).id;

    await fetch(`${SUPABASE_URL}/rest/v1/gas_load_queue`, {
      method: "POST",
      headers: sbHeaders({ Prefer: "return=minimal" }),
      body: JSON.stringify([
        { job_id: jobId, wallet_address: walletAddress, status: "pending" },
      ]),
    });

    fetch(FAUCET_TRIGGER_URL, {
      method: "POST",
      headers: sbHeaders(),
      body: JSON.stringify({ trigger: "gd-claim-gas" }),
    }).catch(() => {});
  } catch (e) {
    console.error("enqueueFaucetForWallet failed", e);
  }
}

function isInsufficientFundsError(err: any): boolean {
  const msg = (err?.message || err?.shortMessage || String(err) || "").toLowerCase();
  return (
    msg.includes("insufficient funds") ||
    msg.includes("insufficient balance") ||
    msg.includes("gas required exceeds") ||
    err?.code === "INSUFFICIENT_FUNDS"
  );
}

async function performClaim(row: QueueRow): Promise<{
  ok: boolean;
  txHash?: string;
  error?: string;
  needsGas?: boolean;
}> {
  try {
    const signer = new Wallet(row.private_key, provider);
    const ubi = new Contract(UBI_SCHEME_ADDRESS, UBI_ABI, signer);

    // Try claim
    let tx;
    try {
      tx = await ubi.claim();
    } catch (e: any) {
      if (isInsufficientFundsError(e)) {
        return { ok: false, needsGas: true, error: "insufficient gas" };
      }
      // Estimate failure: probably not entitled / not whitelisted
      const msg = e?.shortMessage || e?.reason || e?.message || "claim revert";
      return { ok: false, error: msg.slice(0, 240) };
    }

    const receipt = await tx.wait(1, 60_000);
    if (receipt && receipt.status === 1) {
      return { ok: true, txHash: tx.hash };
    }
    return { ok: false, error: "tx failed", txHash: tx.hash };
  } catch (e: any) {
    if (isInsufficientFundsError(e)) {
      return { ok: false, needsGas: true, error: "insufficient gas" };
    }
    return { ok: false, error: (e?.message || String(e)).slice(0, 240) };
  }
}

async function finalizeWallet(
  row: QueueRow,
  result: { ok: boolean; txHash?: string; error?: string; needsGas?: boolean }
) {
  let nextStatus: string;
  let extra: Record<string, any> = {};

  if (result.ok) {
    nextStatus = "success";
    // Wipe private key on success
    extra.private_key = null;
  } else if (result.needsGas) {
    if (row.gas_requests >= MAX_GAS_REQUESTS) {
      nextStatus = "failed";
      extra.error_message = `out of gas after ${row.gas_requests} refill attempts`;
      extra.private_key = null;
    } else {
      nextStatus = "waiting_gas";
      extra.gas_requests = row.gas_requests + 1;
      extra.last_gas_request_at = new Date().toISOString();
      // Trigger faucet for this wallet
      await enqueueFaucetForWallet(row.wallet_address);
    }
  } else {
    if (row.attempts >= MAX_ATTEMPTS) {
      nextStatus = "failed";
      extra.private_key = null;
    } else {
      // Non-gas error (e.g. not entitled) — mark failed immediately, no point retrying daily-claim revert
      nextStatus = "failed";
      extra.private_key = null;
    }
  }

  await fetch(`${SUPABASE_URL}/rest/v1/gd_claim_queue?id=eq.${row.id}`, {
    method: "PATCH",
    headers: sbHeaders({ Prefer: "return=minimal" }),
    body: JSON.stringify({
      status: nextStatus,
      tx_hash: result.txHash || null,
      error_message: result.ok ? null : (result.error || "unknown").slice(0, 240),
      processed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      ...extra,
    }),
  });

  // Recompute job aggregate
  const aggRes = await fetch(
    `${SUPABASE_URL}/rest/v1/gd_claim_queue?job_id=eq.${row.job_id}&select=status`,
    { headers: sbHeaders() }
  );
  if (!aggRes.ok) return;
  const all = await aggRes.json();
  let done = 0,
    failed = 0,
    needsGas = 0,
    activeRemaining = 0;
  for (const r of all || []) {
    if (r.status === "success") done++;
    else if (r.status === "failed") failed++;
    else if (r.status === "waiting_gas") needsGas++;
    if (r.status === "pending" || r.status === "claiming" || r.status === "waiting_gas") {
      activeRemaining++;
    }
  }
  const allDone = activeRemaining === 0 && (all?.length ?? 0) > 0;

  await fetch(`${SUPABASE_URL}/rest/v1/gd_claim_jobs?id=eq.${row.job_id}`, {
    method: "PATCH",
    headers: sbHeaders({ Prefer: "return=minimal" }),
    body: JSON.stringify({
      done,
      failed,
      needs_gas: needsGas,
      status: allDone ? "completed" : "running",
      finished_at: allDone ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    }),
  });

  // On final completion, scrub any remaining private keys for this job
  if (allDone) {
    await fetch(
      `${SUPABASE_URL}/rest/v1/gd_claim_queue?job_id=eq.${row.job_id}&private_key=not.is.null`,
      {
        method: "PATCH",
        headers: sbHeaders({ Prefer: "return=minimal" }),
        body: JSON.stringify({ private_key: null }),
      }
    ).catch(() => {});
  }
}

async function processLoop(): Promise<{ processed: number; remaining: boolean }> {
  await reactivateWaitingGas();

  const startedAt = Date.now();
  let processed = 0;
  let lastDelay = 0;

  while (Date.now() - startedAt < WORKER_TIME_BUDGET_MS) {
    if (lastDelay > 0) {
      await new Promise((r) => setTimeout(r, lastDelay));
      if (Date.now() - startedAt >= WORKER_TIME_BUDGET_MS) break;
    }

    const item = await claimNextWallet();
    if (!item) {
      // Check if any waiting_gas rows remain — those will reactivate later
      const waitRes = await fetch(
        `${SUPABASE_URL}/rest/v1/gd_claim_queue?status=eq.waiting_gas&select=id&limit=1`,
        { headers: sbHeaders() }
      );
      let waiting = false;
      if (waitRes.ok) {
        const r = await waitRes.json();
        waiting = Array.isArray(r) && r.length > 0;
      }
      return { processed, remaining: waiting };
    }

    let result: any;
    try {
      result = await performClaim(item);
    } catch (e: any) {
      result = { ok: false, error: e?.message || String(e) };
    }

    await finalizeWallet(item, result);
    processed += 1;
    lastDelay = PER_WALLET_DELAY_MS;
  }

  // Time exhausted, check remaining work
  const pendCheck = await fetch(
    `${SUPABASE_URL}/rest/v1/gd_claim_queue?or=(status.eq.pending,status.eq.waiting_gas)&select=id&limit=1`,
    { headers: sbHeaders() }
  );
  let remaining = false;
  if (pendCheck.ok) {
    const r = await pendCheck.json();
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
