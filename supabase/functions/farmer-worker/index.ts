// Background worker that processes active farmer_jobs.
// Runs on pg_cron every minute. Single isolate guard to avoid overlap.
//
// Serial flow (per wallet, one at a time):
//   1. Generate 1 fresh wallet and insert it with gd_status=pending.
//   2. Send G$ to it from the funder wallet (wait for tx submission).
//   3. Wait 5 seconds for the G$ tx to settle on-chain.
//   4. Call the GoodDollar faucet for that wallet (gas request).
//   5. Move on to the next wallet.
// Stop checks happen between every step so the user can halt instantly.

import { Wallet, JsonRpcProvider, Contract, parseUnits } from "npm:ethers@6.13.4";
import { createClient } from "npm:@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const PROXY_USER = Deno.env.get("WEBSHARE_PROXY_USERNAME") || "";
const PROXY_PASS = Deno.env.get("WEBSHARE_PROXY_PASSWORD") || "";

const CELO_RPC = "https://forno.celo.org";
const G_DOLLAR_ADDRESS = "0x62B8B11039FcfE5aB0C56E502b1C372A3d2a9c7A";
const G_DOLLAR_ABI = [
  "function transfer(address to, uint256 amount) returns (bool)",
];
const GD_FAUCET_URL = "https://goodserver.gooddollar.org/verify/topWallet";

const GD_SETTLE_MS = 5_000;             // wait 5s after G$ tx submitted, before faucet
const FAUCET_GAP_MS = 500;              // tiny gap before moving to next wallet
const FAUCET_RETRY_WAIT_MS = 1_500;     // wait before retry with new IP
const FAUCET_MAX_ATTEMPTS = 2;          // 1 initial + 1 retry with fresh IP
const FAUCET_CALL_TIMEOUT_MS = 8_000;   // keep each request under worker budget
const MAX_WALLETS_PER_INVOCATION = 6;   // serial cap per worker run (each ~6-8s)

const WORKER_TIME_BUDGET_MS = 60_000;
const STOP_BEFORE_TIMEOUT_MS = 4_000;
const TRIGGER_URL = `${SUPABASE_URL}/functions/v1/farmer-worker`;
const CONTINUE_DELAY_MS = 2_000;

const provider = new JsonRpcProvider(CELO_RPC, 42220);
const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

let inFlight = false;

function wait(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function isJobRunning(jobId: string): Promise<boolean> {
  const { data } = await admin
    .from("farmer_jobs")
    .select("status")
    .eq("id", jobId)
    .single();
  return data?.status === "running";
}

/** Sleep up to ms, breaking early if job is stopped. Returns true if still running. */
async function waitWhileRunning(jobId: string, ms: number): Promise<boolean> {
  const step = 1_000;
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (!(await isJobRunning(jobId))) return false;
    await wait(Math.min(step, until - Date.now()));
  }
  return isJobRunning(jobId);
}

function buildProxyUrl(): string | null {
  if (!PROXY_USER || !PROXY_PASS) return null;
  return `http://${encodeURIComponent(PROXY_USER)}:${encodeURIComponent(
    PROXY_PASS
  )}@p.webshare.io:80`;
}

function shouldRetryFaucet(error?: string) {
  const t = (error || "").toLowerCase();
  return (
    t.includes("not whitelisted") ||
    t.includes("whitelist") ||
    t.includes("timeout") ||
    t.includes("network") ||
    t.includes("fetch") ||
    t.includes("429") ||
    /http\s+5\d\d/.test(t)
  );
}

async function callFaucet(account: string): Promise<{
  ok: boolean;
  txHash?: string;
  error?: string;
  ip?: string;
}> {
  const ac = new AbortController();
  const timeout = setTimeout(() => ac.abort(), FAUCET_CALL_TIMEOUT_MS);
  const proxyUrl = buildProxyUrl();
  // @ts-ignore Deno API
  const createHttp = (Deno as any).createHttpClient;
  let client: any = null;
  if (proxyUrl && typeof createHttp === "function") {
    try {
      client = createHttp({ proxy: { url: proxyUrl } });
    } catch (_) {
      client = null;
    }
  }
  const opts = (extra: RequestInit = {}): RequestInit => ({
    ...extra,
    // @ts-ignore
    ...(client ? { client } : {}),
    signal: ac.signal,
  });

  // Do not pre-fetch proxy IP here: if that diagnostic request hangs, it can
  // consume the same timeout signal and abort the real faucet call.
  let ip: string | undefined;

  try {
    const res = await fetch(
      GD_FAUCET_URL,
      opts({
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          "User-Agent":
            "Mozilla/5.0 (Linux; Android 13; SM-A536B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36",
          Origin: "https://wallet.gooddollar.org",
          Referer: "https://wallet.gooddollar.org/",
        },
        body: JSON.stringify({ account }),
      })
    );
    const text = await res.text();
    let body: any = null;
    try { body = JSON.parse(text); } catch { body = { raw: text }; }
    if (!res.ok) {
      return {
        ok: false, ip,
        error: body?.error || body?.message || `HTTP ${res.status}: ${text.slice(0, 160)}`,
      };
    }
    const txHash =
      body?.hash || body?.transactionHash || body?.txHash ||
      body?.result?.transactionHash || body?.result?.hash || null;
    if (!txHash && (body?.ok === false || body?.error)) {
      return {
        ok: false, ip,
        error: body?.error || body?.message || `faucet rejected: ${text.slice(0, 160)}`,
      };
    }
    return { ok: true, ip, txHash: txHash || undefined };
  } catch (e: any) {
    return { ok: false, ip, error: e?.message || String(e) };
  } finally {
    clearTimeout(timeout);
    try { client?.close?.(); } catch (_) {}
  }
}

function hasTimeLeft(deadline: number) {
  return Date.now() < deadline - STOP_BEFORE_TIMEOUT_MS;
}

function triggerContinueAfterDelay() {
  const run = async () => {
    await wait(CONTINUE_DELAY_MS);
    await fetch(TRIGGER_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ trigger: "continue" }),
    });
  };
  try {
    (globalThis as any).EdgeRuntime?.waitUntil?.(run());
  } catch (_) {
    run().catch(() => {});
  }
}

/**
 * Process a single wallet end-to-end:
 *   create -> G$ transfer -> wait 5s -> faucet call.
 * Returns true on full success (faucet succeeded), false on any failure.
 * Returns "stopped" if the user paused the job mid-flight.
 */
async function processOneWallet(job: {
  id: string;
  owner_user_id: string;
  funder_key: string;
  g_amount: string;
}, deadline: number): Promise<"success" | "failed" | "stopped" | "no-time"> {
  // Validate funder + amount once per call (cheap).
  let gAmountWei: bigint;
  try {
    gAmountWei = parseUnits(job.g_amount || "0.5", 18);
    if (gAmountWei <= 0n) throw new Error("amount must be > 0");
  } catch (_) {
    return "failed";
  }
  if (!/^0x[a-fA-F0-9]{64}$/.test(job.funder_key)) {
    return "failed";
  }

  if (!hasTimeLeft(deadline)) return "no-time";
  if (!(await isJobRunning(job.id))) return "stopped";

  // 1. Generate one wallet and insert it as pending.
  const w = Wallet.createRandom();
  const { data: inserted, error: insertError } = await admin
    .from("farmer_wallets")
    .insert({
      owner_user_id: job.owner_user_id,
      wallet_address: w.address,
      private_key: w.privateKey,
      gd_status: "pending",
      faucet_status: "pending",
    })
    .select("id")
    .single();
  if (insertError || !inserted) {
    console.error("wallet insert err", insertError?.message);
    return "failed";
  }
  const rowId = inserted.id as string;

  // 2. Send G$ transfer.
  const funderSigner = new Wallet(job.funder_key, provider);
  const gd = new Contract(G_DOLLAR_ADDRESS, G_DOLLAR_ABI, funderSigner);
  let gdTxHash: string | null = null;
  try {
    const tx = await gd.transfer(w.address, gAmountWei);
    gdTxHash = tx.hash as string;
    await admin.from("farmer_wallets").update({
      gd_tx_hash: gdTxHash,
      gd_status: "submitted",
      gd_error: null,
    }).eq("id", rowId);
  } catch (e: any) {
    const msg = e?.shortMessage || e?.message || String(e);
    await admin.from("farmer_wallets").update({
      gd_status: "failed",
      gd_error: msg,
      faucet_status: "skipped",
    }).eq("id", rowId);
    return "failed";
  }

  await refreshLease(job.id);

  // 3. Wait 5 seconds (allow stop to interrupt).
  const stillRunning = await waitWhileRunning(job.id, GD_SETTLE_MS);
  if (!stillRunning) return "stopped";
  if (!hasTimeLeft(deadline)) {
    // Faucet step will be picked up next invocation — leave faucet_status pending.
    return "no-time";
  }

  // 4. Faucet call (gas request) with one retry on transient errors.
  let faucetTx: string | null = null;
  let faucetStatus = "failed";
  let faucetError: string | null = null;
  let faucetIp: string | null = null;
  for (let attempt = 1; attempt <= FAUCET_MAX_ATTEMPTS; attempt++) {
    if (!hasTimeLeft(deadline)) break;
    const r = await callFaucet(w.address);
    faucetIp = r.ip || null;
    if (r.ok) {
      faucetStatus = "success";
      faucetTx = r.txHash || null;
      faucetError = null;
      break;
    }
    faucetError = r.error || "unknown error";
    if (attempt < FAUCET_MAX_ATTEMPTS && shouldRetryFaucet(faucetError)) {
      await wait(FAUCET_RETRY_WAIT_MS);
      continue;
    }
    break;
  }

  await admin.from("farmer_wallets").update({
    faucet_tx_hash: faucetTx,
    faucet_status: faucetStatus,
    faucet_error: faucetError,
    faucet_ip: faucetIp,
  }).eq("id", rowId);

  await refreshLease(job.id);
  return faucetStatus === "success" ? "success" : "failed";
}

/**
 * Resume any wallets from previous invocations whose faucet step never ran
 * (G$ already submitted, faucet still pending). Run them serially with the
 * 5-second settle gap honored from their creation time.
 */
async function processPendingFaucet(job: {
  id: string;
  owner_user_id: string;
}, deadline: number): Promise<{ ok: number; failed: number; stopped: boolean; processed: number }> {
  let ok = 0;
  let failed = 0;
  let processed = 0;

  while (hasTimeLeft(deadline) && processed < MAX_WALLETS_PER_INVOCATION) {
    if (!(await isJobRunning(job.id))) {
      return { ok, failed, stopped: true, processed };
    }

    const { data, error } = await admin
      .from("farmer_wallets")
      .select("id, wallet_address, created_at")
      .eq("owner_user_id", job.owner_user_id)
      .eq("faucet_status", "pending")
      .in("gd_status", ["submitted", "success"])
      .order("created_at", { ascending: true })
      .limit(1);
    if (error) {
      console.error("processPendingFaucet load err", error.message);
      return { ok, failed, stopped: false, processed };
    }
    if (!data || data.length === 0) {
      return { ok, failed, stopped: false, processed };
    }
    const row = data[0] as any;

    // Honor 5s settle from creation time.
    const ageMs = Date.now() - new Date(row.created_at).getTime();
    if (ageMs < GD_SETTLE_MS) {
      const waitMs = GD_SETTLE_MS - ageMs;
      const stillRunning = await waitWhileRunning(job.id, waitMs);
      if (!stillRunning) return { ok, failed, stopped: true, processed };
    }
    if (!hasTimeLeft(deadline)) return { ok, failed, stopped: false, processed };

    let faucetTx: string | null = null;
    let faucetStatus = "failed";
    let faucetError: string | null = null;
    let faucetIp: string | null = null;
    for (let attempt = 1; attempt <= FAUCET_MAX_ATTEMPTS; attempt++) {
      if (!hasTimeLeft(deadline)) break;
      const r = await callFaucet(row.wallet_address);
      faucetIp = r.ip || null;
      if (r.ok) {
        faucetStatus = "success";
        faucetTx = r.txHash || null;
        faucetError = null;
        break;
      }
      faucetError = r.error || "unknown error";
      if (attempt < FAUCET_MAX_ATTEMPTS && shouldRetryFaucet(faucetError)) {
        await wait(FAUCET_RETRY_WAIT_MS);
        continue;
      }
      break;
    }

    await admin.from("farmer_wallets").update({
      faucet_tx_hash: faucetTx,
      faucet_status: faucetStatus,
      faucet_error: faucetError,
      faucet_ip: faucetIp,
    }).eq("id", row.id);

    if (faucetStatus === "success") ok += 1; else failed += 1;
    processed += 1;
    await refreshLease(job.id);
  }

  return { ok, failed, stopped: false, processed };
}

// Short lease — each request is intentionally small, but the funder nonce
// pipeline still needs enough room so another invocation does not collide.
const LOCK_LEASE_MS = 45_000;

async function pickNextJob(): Promise<{
  id: string;
  owner_user_id: string;
  funder_key: string;
  g_amount: string;
} | null> {
  // Only consider jobs whose lease has expired (or never ran).
  const leaseCutoff = new Date(Date.now() - LOCK_LEASE_MS).toISOString();
  const { data, error } = await admin
    .from("farmer_jobs")
    .select("id, owner_user_id, funder_key, g_amount, last_run_at")
    .eq("status", "running")
    .or(`last_run_at.is.null,last_run_at.lt.${leaseCutoff}`)
    .order("last_run_at", { ascending: true, nullsFirst: true })
    .limit(1);
  if (error) {
    console.error("pickNextJob error", error.message);
    return null;
  }
  if (!data || data.length === 0) return null;
  const candidate = data[0] as any;

  const claimQuery = admin
    .from("farmer_jobs")
    .update({ last_run_at: new Date().toISOString() })
    .eq("id", candidate.id)
    .eq("status", "running");
  const claim = candidate.last_run_at
    ? await claimQuery.eq("last_run_at", candidate.last_run_at).select("id")
    : await claimQuery.is("last_run_at", null).select("id");
  if (claim.error) {
    console.error("claim error", claim.error.message);
    return null;
  }
  if (!claim.data || claim.data.length === 0) {
    return null;
  }
  return {
    id: candidate.id,
    owner_user_id: candidate.owner_user_id,
    funder_key: candidate.funder_key,
    g_amount: candidate.g_amount,
  };
}

async function refreshLease(jobId: string) {
  await admin
    .from("farmer_jobs")
    .update({ last_run_at: new Date().toISOString() })
    .eq("id", jobId);
}

async function processOneCycle(job: {
  id: string;
  owner_user_id: string;
  funder_key: string;
  g_amount: string;
}, deadline: number): Promise<{ ok: number; failed: number; stopped: boolean; exhausted: boolean; error?: string }> {
  let totalOk = 0;
  let totalFailed = 0;

  // Phase A: drain any wallets from prior invocations whose faucet step
  // never ran (e.g. worker timed out between G$ tx and faucet call).
  const drained = await processPendingFaucet(job, deadline);
  totalOk += drained.ok;
  totalFailed += drained.failed;
  if (drained.stopped) {
    return { ok: totalOk, failed: totalFailed, stopped: true, exhausted: false };
  }

  // Phase B: serial per-wallet pipeline. Stop when out of time, stopped,
  // or we hit the per-invocation cap (so cron can pick up again).
  let processed = drained.processed;
  while (hasTimeLeft(deadline) && processed < MAX_WALLETS_PER_INVOCATION) {
    if (!(await isJobRunning(job.id))) {
      return { ok: totalOk, failed: totalFailed, stopped: true, exhausted: false };
    }
    const result = await processOneWallet(job, deadline);
    if (result === "stopped") {
      return { ok: totalOk, failed: totalFailed, stopped: true, exhausted: false };
    }
    if (result === "no-time") {
      return { ok: totalOk, failed: totalFailed, stopped: false, exhausted: true };
    }
    if (result === "success") totalOk += 1; else totalFailed += 1;
    processed += 1;

    // Tiny pause between wallets to avoid hammering the funder/RPC.
    if (processed < MAX_WALLETS_PER_INVOCATION && hasTimeLeft(deadline)) {
      const stillRunning = await waitWhileRunning(job.id, FAUCET_GAP_MS);
      if (!stillRunning) {
        return { ok: totalOk, failed: totalFailed, stopped: true, exhausted: false };
      }
    }
  }

  // We always have more work as long as the job is running.
  return { ok: totalOk, failed: totalFailed, stopped: false, exhausted: true };
}

async function processLoop() {
  const startedAt = Date.now();
  const deadline = startedAt + WORKER_TIME_BUDGET_MS;
  let processed = 0;

  while (hasTimeLeft(deadline)) {
    const job = await pickNextJob();
    if (!job) return { processed, remaining: false };

    let result: { ok: number; failed: number; stopped: boolean; exhausted: boolean; error?: string };
    try {
      result = await processOneCycle(job, deadline);
    } catch (e: any) {
      result = { ok: 0, failed: 0, stopped: false, exhausted: false, error: e?.message || String(e) };
    }

    // Recompute counters from the DB so they always match the real wallets.
    // ok = wallets where faucet succeeded
    // failed = wallets where G$ failed OR faucet failed
    // pending wallets are not counted (they're still in flight)
    const [{ count: okCount }, { count: failedCount }, { data: cur }] = await Promise.all([
      admin.from("farmer_wallets")
        .select("id", { count: "exact", head: true })
        .eq("owner_user_id", job.owner_user_id)
        .eq("faucet_status", "success"),
      admin.from("farmer_wallets")
        .select("id", { count: "exact", head: true })
        .eq("owner_user_id", job.owner_user_id)
        .or("gd_status.eq.failed,faucet_status.eq.failed"),
      admin.from("farmer_jobs")
        .select("status")
        .eq("id", job.id)
        .single(),
    ]);

    if (cur) {
      await admin.from("farmer_jobs").update({
        last_run_at: new Date().toISOString(),
        last_error: result.error || null,
        ok_count: okCount || 0,
        failed_count: failedCount || 0,
      }).eq("id", job.id);

      if (cur.status !== "running" || result.stopped) {
        return { processed, remaining: false };
      }
    }

    processed += (result.ok || 0) + (result.failed || 0);

    if (result.exhausted) break;

    // One cycle is heavy (~95s). Re-trigger to continue rather than squeezing another cycle in.
    if (!hasTimeLeft(deadline)) break;
  }

  const { data: more } = await admin
    .from("farmer_jobs")
    .select("id")
    .eq("status", "running")
    .limit(1);
  return { processed, remaining: Boolean(more && more.length > 0) };
}

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
      triggerContinueAfterDelay();
    }

    return new Response(JSON.stringify({ ok: true, ...result }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    console.error("worker error", e?.message || e);
    return new Response(JSON.stringify({ ok: false, error: e?.message || String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } finally {
    inFlight = false;
  }
});
