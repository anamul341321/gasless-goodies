// Background worker: claims GoodDollar G$ on Celo for queued wallets.
//
// Strategy (1 faucet request per wallet, max):
//   Phase A (CLAIM): for each 'pending' wallet, call UBIScheme.claim().
//     - Success → 'success', wipe key
//     - Insufficient gas AND gas_requests=0 → enqueue into the batch's faucet
//       job INLINE (don't wait), mark 'waiting_gas', gas_requests=1, move on.
//     - Other error → 'failed', keep key (user can copy)
//
//   Phase B (RETRY ROUND): only after no 'pending'/'claiming' rows remain in
//     the job, check the linked faucet job. When it finishes, flip:
//       - faucet success + attempts < MAX_CLAIM_ATTEMPTS → 'pending'
//         (Round 2 claim happens on next tick — no new faucet request because
//          gas_requests is already 1)
//       - faucet failed → 'failed' (key kept)
//     If Round 2 claim still hits insufficient funds, the inline-enqueue
//     skip (gas_requests > 0) ensures we don't spam the faucet. It just
//     becomes 'failed'.

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
const UBI_ABI = [
  "function claim() returns (bool)",
  "function checkEntitlement(address member) view returns (uint256)",
];

const FAUCET_TRIGGER_URL = `${SUPABASE_URL}/functions/v1/gas-loader-worker`;
const WORKER_TRIGGER_URL = `${SUPABASE_URL}/functions/v1/gd-claim-worker`;

const PER_WALLET_DELAY_MS = 30_000; // 30s between claim() calls (~2 per minute)
const FAUCET_DELAY_MS = 10_000;      // 10s between gas refill calls (1 IP per req)
const WORKER_TIME_BUDGET_MS = 110_000;
const MAX_CLAIM_ATTEMPTS = 3;        // total claim() tries per wallet (incl. post-gas)

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
  status: string;
};

function isInsufficientFundsError(err: any): boolean {
  const msg = (err?.message || err?.shortMessage || String(err) || "").toLowerCase();
  return (
    msg.includes("insufficient funds") ||
    msg.includes("insufficient balance") ||
    msg.includes("gas required exceeds") ||
    err?.code === "INSUFFICIENT_FUNDS"
  );
}

// ---------------- Phase A: CLAIM ----------------

async function pickNextPendingClaim(): Promise<QueueRow | null> {
  const findRes = await fetch(
    `${SUPABASE_URL}/rest/v1/gd_claim_queue?status=eq.pending&select=id,job_id,wallet_address,private_key,attempts,gas_requests,status&order=created_at.asc&limit=1`,
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

async function performClaim(row: QueueRow): Promise<{
  ok: boolean;
  txHash?: string;
  error?: string;
  needsGas?: boolean;
}> {
  try {
    const signer = new Wallet(row.private_key, provider);
    const ubi = new Contract(UBI_SCHEME_ADDRESS, UBI_ABI, signer);

    let tx;
    try {
      tx = await ubi.claim();
    } catch (e: any) {
      if (isInsufficientFundsError(e)) {
        return { ok: false, needsGas: true, error: "insufficient gas" };
      }
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

async function finalizeClaim(
  row: QueueRow,
  result: { ok: boolean; txHash?: string; error?: string; needsGas?: boolean }
) {
  const patch: Record<string, any> = {
    tx_hash: result.txHash || null,
    error_message: result.ok ? null : (result.error || "unknown").slice(0, 240),
    processed_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  if (result.ok) {
    patch.status = "success";
    patch.private_key = null;
  } else if (result.needsGas) {
    // Park for Phase B. Keep private_key (still need to sign claim later).
    patch.status = "waiting_gas";
  } else {
    // Failed claim (revert, network error, etc.) — keep the private key
    // so the owner can copy/recover it from their account. The owner can
    // manually delete it later via delete_my_failed_key.
    patch.status = "failed";
  }

  await fetch(`${SUPABASE_URL}/rest/v1/gd_claim_queue?id=eq.${row.id}`, {
    method: "PATCH",
    headers: sbHeaders({ Prefer: "return=minimal" }),
    body: JSON.stringify(patch),
  });

  await refreshJobAggregate(row.job_id);
}

// ---------------- Phase B: GAS REFILL ----------------

async function jobHasPending(jobId: string): Promise<boolean> {
  const r = await fetch(
    `${SUPABASE_URL}/rest/v1/gd_claim_queue?job_id=eq.${jobId}&or=(status.eq.pending,status.eq.claiming)&select=id&limit=1`,
    { headers: sbHeaders() }
  );
  if (!r.ok) return false;
  const j = await r.json();
  return Array.isArray(j) && j.length > 0;
}

async function getWaitingGasWallets(jobId: string): Promise<QueueRow[]> {
  const r = await fetch(
    `${SUPABASE_URL}/rest/v1/gd_claim_queue?job_id=eq.${jobId}&status=eq.waiting_gas&select=id,job_id,wallet_address,private_key,attempts,gas_requests,status&order=created_at.asc&limit=2000`,
    { headers: sbHeaders() }
  );
  if (!r.ok) return [];
  const j = await r.json();
  return Array.isArray(j) ? (j as QueueRow[]) : [];
}

// Find/create the faucet job linked to this claim job. We tag the faucet job
// with batch_name = "gd-claim:<jobId>" so we can find it again on retries.
async function findActiveFaucetJob(jobId: string): Promise<string | null> {
  const tag = `gd-claim:${jobId}`;
  const r = await fetch(
    `${SUPABASE_URL}/rest/v1/gas_load_jobs?batch_name=eq.${encodeURIComponent(tag)}&or=(status.eq.pending,status.eq.running)&select=id&limit=1`,
    { headers: sbHeaders() }
  );
  if (!r.ok) return null;
  const j = await r.json();
  return Array.isArray(j) && j[0] ? j[0].id : null;
}

async function createFaucetJob(jobId: string, wallets: QueueRow[]): Promise<string | null> {
  const tag = `gd-claim:${jobId}`;
  const jobRes = await fetch(`${SUPABASE_URL}/rest/v1/gas_load_jobs`, {
    method: "POST",
    headers: sbHeaders({ Prefer: "return=representation" }),
    body: JSON.stringify({
      total: wallets.length,
      status: "pending",
      batch_name: tag,
      delay_ms: FAUCET_DELAY_MS,
      max_retries: 0,
    }),
  });
  if (!jobRes.ok) return null;
  const job = await jobRes.json();
  const faucetJobId = (Array.isArray(job) ? job[0] : job).id as string;

  const queueRows = wallets.map((w) => ({
    job_id: faucetJobId,
    wallet_address: w.wallet_address,
    status: "pending",
  }));

  // Insert in chunks
  const CHUNK = 200;
  for (let i = 0; i < queueRows.length; i += CHUNK) {
    const slice = queueRows.slice(i, i + CHUNK);
    const ins = await fetch(`${SUPABASE_URL}/rest/v1/gas_load_queue`, {
      method: "POST",
      headers: sbHeaders({ Prefer: "return=minimal" }),
      body: JSON.stringify(slice),
    });
    if (!ins.ok) {
      console.error("faucet enqueue failed", await ins.text());
      return null;
    }
  }

  // Kick faucet worker (best-effort)
  fetch(FAUCET_TRIGGER_URL, {
    method: "POST",
    headers: sbHeaders(),
    body: JSON.stringify({ trigger: "gd-claim-gas", job_id: faucetJobId }),
  }).catch(() => {});

  // Mark waiting_gas wallets as having had a gas request
  await fetch(
    `${SUPABASE_URL}/rest/v1/gd_claim_queue?job_id=eq.${jobId}&status=eq.waiting_gas`,
    {
      method: "PATCH",
      headers: sbHeaders({ Prefer: "return=minimal" }),
      body: JSON.stringify({
        gas_requests: 1,
        last_gas_request_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }),
    }
  ).catch(() => {});

  return faucetJobId;
}

type FaucetWalletStatus = { wallet_address: string; status: string };

async function getFaucetJobResults(faucetJobId: string): Promise<{
  done: boolean;
  results: Map<string, FaucetWalletStatus>;
}> {
  const jobRes = await fetch(
    `${SUPABASE_URL}/rest/v1/gas_load_jobs?id=eq.${faucetJobId}&select=status`,
    { headers: sbHeaders() }
  );
  let done = false;
  if (jobRes.ok) {
    const j = await jobRes.json();
    const st = Array.isArray(j) && j[0] ? j[0].status : null;
    done = st === "completed" || st === "failed";
  }

  const wRes = await fetch(
    `${SUPABASE_URL}/rest/v1/gas_load_queue?job_id=eq.${faucetJobId}&select=wallet_address,status&limit=2000`,
    { headers: sbHeaders() }
  );
  const map = new Map<string, FaucetWalletStatus>();
  if (wRes.ok) {
    const arr = await wRes.json();
    if (Array.isArray(arr)) {
      for (const r of arr) {
        map.set(String(r.wallet_address).toLowerCase(), r as FaucetWalletStatus);
      }
    }
  }
  return { done, results: map };
}

// After faucet job finishes: flip waiting_gas rows to either pending (gas ok)
// or failed (gas could not be delivered).
async function applyFaucetResults(jobId: string, faucetJobId: string) {
  const { results } = await getFaucetJobResults(faucetJobId);
  const waiting = await getWaitingGasWallets(jobId);

  for (const w of waiting) {
    const fr = results.get(w.wallet_address.toLowerCase());
    const faucetOk = fr?.status === "success";

    if (faucetOk && w.attempts < MAX_CLAIM_ATTEMPTS) {
      await fetch(`${SUPABASE_URL}/rest/v1/gd_claim_queue?id=eq.${w.id}`, {
        method: "PATCH",
        headers: sbHeaders({ Prefer: "return=minimal" }),
        body: JSON.stringify({
          status: "pending",
          updated_at: new Date().toISOString(),
        }),
      });
    } else {
      // Gas could not be delivered → final failed. Keep private_key so user
      // can copy it from the UI.
      await fetch(`${SUPABASE_URL}/rest/v1/gd_claim_queue?id=eq.${w.id}`, {
        method: "PATCH",
        headers: sbHeaders({ Prefer: "return=minimal" }),
        body: JSON.stringify({
          status: "failed",
          error_message: faucetOk
            ? "claim retries exhausted"
            : (fr?.status ? `faucet ${fr.status}` : "faucet not delivered"),
          processed_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }),
      });
    }
  }

  await refreshJobAggregate(jobId);
}

// ---------------- Aggregate / job lifecycle ----------------

async function refreshJobAggregate(jobId: string) {
  const aggRes = await fetch(
    `${SUPABASE_URL}/rest/v1/gd_claim_queue?job_id=eq.${jobId}&select=status&limit=2000`,
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
    if (
      r.status === "pending" ||
      r.status === "claiming" ||
      r.status === "waiting_gas"
    ) {
      activeRemaining++;
    }
  }
  const allDone = activeRemaining === 0 && (all?.length ?? 0) > 0;

  await fetch(`${SUPABASE_URL}/rest/v1/gd_claim_jobs?id=eq.${jobId}`, {
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

  // On final completion, scrub remaining private keys for SUCCESS rows only
  // (failed-with-gas-issue rows keep their key so user can copy).
  if (allDone) {
    await fetch(
      `${SUPABASE_URL}/rest/v1/gd_claim_queue?job_id=eq.${jobId}&status=eq.success&private_key=not.is.null`,
      {
        method: "PATCH",
        headers: sbHeaders({ Prefer: "return=minimal" }),
        body: JSON.stringify({ private_key: null }),
      }
    ).catch(() => {});
  }
}

// ---------------- Main loop ----------------

async function getActiveJobIds(): Promise<string[]> {
  const r = await fetch(
    `${SUPABASE_URL}/rest/v1/gd_claim_jobs?or=(status.eq.pending,status.eq.running)&select=id&limit=20`,
    { headers: sbHeaders() }
  );
  if (!r.ok) return [];
  const j = await r.json();
  return Array.isArray(j) ? j.map((row: any) => row.id as string) : [];
}

async function processClaimPhase(): Promise<number> {
  const startedAt = Date.now();
  let processed = 0;
  let lastDelay = 0;

  while (Date.now() - startedAt < WORKER_TIME_BUDGET_MS) {
    if (lastDelay > 0) {
      await new Promise((r) => setTimeout(r, lastDelay));
      if (Date.now() - startedAt >= WORKER_TIME_BUDGET_MS) break;
    }

    const item = await pickNextPendingClaim();
    if (!item) return processed;

    let result: any;
    try {
      result = await performClaim(item);
    } catch (e: any) {
      result = { ok: false, error: e?.message || String(e) };
    }

    await finalizeClaim(item, result);
    processed += 1;
    lastDelay = PER_WALLET_DELAY_MS;
  }
  return processed;
}

async function processGasPhaseForJob(jobId: string) {
  // If pending/claiming still exist, do not start gas phase yet.
  if (await jobHasPending(jobId)) return;

  const waiting = await getWaitingGasWallets(jobId);
  if (waiting.length === 0) return;

  // Find or create the linked faucet job
  let faucetJobId = await findActiveFaucetJob(jobId);

  if (!faucetJobId) {
    // Only enqueue wallets that have not yet had a gas attempt
    const fresh = waiting.filter((w) => w.gas_requests === 0);
    if (fresh.length === 0) {
      // All waiting_gas already had their one shot but faucet job is gone →
      // mark them failed (shouldn't normally happen).
      for (const w of waiting) {
        await fetch(`${SUPABASE_URL}/rest/v1/gd_claim_queue?id=eq.${w.id}`, {
          method: "PATCH",
          headers: sbHeaders({ Prefer: "return=minimal" }),
          body: JSON.stringify({
            status: "failed",
            error_message: "faucet not delivered",
            processed_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          }),
        });
      }
      await refreshJobAggregate(jobId);
      return;
    }
    faucetJobId = await createFaucetJob(jobId, fresh);
    return; // wait for next tick to check faucet results
  }

  // Faucet job exists — check status
  const { done } = await getFaucetJobResults(faucetJobId);
  if (!done) {
    // Still running — kick worker again and bail
    fetch(FAUCET_TRIGGER_URL, {
      method: "POST",
      headers: sbHeaders(),
      body: JSON.stringify({ trigger: "gd-claim-gas", job_id: faucetJobId }),
    }).catch(() => {});
    return;
  }

  // Faucet finished — apply results
  await applyFaucetResults(jobId, faucetJobId);
}

async function processLoop(): Promise<{ processed: number; remaining: boolean }> {
  // Phase A: drain any pending claims (across all active jobs)
  const processed = await processClaimPhase();

  // Phase B: for each active job with no pending left, run gas phase
  const jobIds = await getActiveJobIds();
  for (const jid of jobIds) {
    try {
      await processGasPhaseForJob(jid);
    } catch (e) {
      console.error("gas phase error", jid, e);
    }
  }

  // Determine if there is anything still to do
  const remCheck = await fetch(
    `${SUPABASE_URL}/rest/v1/gd_claim_queue?or=(status.eq.pending,status.eq.claiming,status.eq.waiting_gas)&select=id&limit=1`,
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
