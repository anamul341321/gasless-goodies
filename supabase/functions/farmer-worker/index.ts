// Background worker that processes active farmer_jobs.
// Runs on pg_cron every minute. Single isolate guard to avoid overlap.
//
// New batch flow (per cycle):
//   Phase 1 (fast, ~60s): generate BATCH_SIZE wallets and send G$ to all of them
//                          in parallel using a managed nonce. Each wallet is
//                          inserted into farmer_wallets immediately with
//                          gd_status = success/submitted/failed and faucet_status = pending.
//   Phase 2: return quickly and re-trigger after settle time so the platform
//            never kills the function mid-batch.
//   Phase 3: drain settled faucet wallets in short chunks, then re-trigger.
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

const BATCH_SIZE = 15;                  // wallets per cycle
const GD_BATCH_SETTLE_MS = 15_000;      // strict 15s wait after all G$ submitted
const FAUCET_GAP_MS = 250;              // gap between faucet calls
const FAUCET_RETRY_WAIT_MS = 1_500;     // wait before retry with new IP
const FAUCET_MAX_ATTEMPTS = 2;          // 1 initial + 1 retry with fresh IP
const FAUCET_CALL_TIMEOUT_MS = 8_000;   // keep each request under worker budget
const FAUCET_MAX_PER_CYCLE = 8;         // short drain chunk to avoid platform kill

const WORKER_TIME_BUDGET_MS = 18_000;
const STOP_BEFORE_TIMEOUT_MS = 3_000;
const TRIGGER_URL = `${SUPABASE_URL}/functions/v1/farmer-worker`;
const CONTINUE_DELAY_MS = 16_000;

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

type BatchEntry = {
  rowId: string;
  address: string;
  privKey: string;
  gdStatus: string;
};

/**
 * Phase 1: create BATCH_SIZE wallets and send G$ SEQUENTIALLY (one tx at a time).
 * Sequential submit lets ethers manage nonce safely on the same signer — no
 * "nonce too low" / "replacement underpriced" races. Each wallet row is inserted
 * immediately so it shows up in the UI right away. Returns entries that have G$
 * (success or submitted) and are ready for the faucet phase.
 */
async function fundBatch(job: {
  id: string;
  owner_user_id: string;
  funder_key: string;
  g_amount: string;
}, deadline: number): Promise<{ entries: BatchEntry[]; failedCount: number; stopped: boolean; exhausted: boolean }> {
  let gAmountWei: bigint;
  try {
    gAmountWei = parseUnits(job.g_amount || "0.5", 18);
    if (gAmountWei <= 0n) throw new Error("amount must be > 0");
  } catch (e: any) {
    return { entries: [], failedCount: 0, stopped: false, exhausted: false };
  }
  if (!/^0x[a-fA-F0-9]{64}$/.test(job.funder_key)) {
    return { entries: [], failedCount: 0, stopped: false, exhausted: false };
  }

  const funderSigner = new Wallet(job.funder_key, provider);
  const gd = new Contract(G_DOLLAR_ADDRESS, G_DOLLAR_ABI, funderSigner);

  // Manage nonce explicitly. Using "pending" so that even if another
  // concurrent worker invocation just submitted a tx from the same funder,
  // we pick up the next free slot instead of colliding.
  let nextNonce: number;
  try {
    nextNonce = await provider.getTransactionCount(funderSigner.address, "pending");
  } catch (e: any) {
    console.error("getTransactionCount failed", e?.message);
    return { entries: [], failedCount: 0, stopped: false, exhausted: false };
  }

  // Stop check before parallel submit
  if (!hasTimeLeft(deadline)) {
    return { entries: [], failedCount: 0, stopped: false, exhausted: true };
  }
  if (!(await isJobRunning(job.id))) {
    return { entries: [], failedCount: 0, stopped: true, exhausted: false };
  }

  // Create all wallets together, but submit G$ txs one-by-one with explicit
  // nonces. Fully parallel tx submission was faster, but RPC/mempool lag can
  // reuse nonces and freeze a batch with replacement/nonce errors.
  const wallets = Array.from({ length: BATCH_SIZE }, () => Wallet.createRandom());

  const submitResults: Array<{ w: Wallet; gdTxHash: string | null; gdStatus: string; gdError: string | null }> = [];
  for (const w of wallets) {
    if (!hasTimeLeft(deadline)) break;
    try {
      const tx = await gd.transfer(w.address, gAmountWei, { nonce: nextNonce++ });
      submitResults.push({ w, gdTxHash: tx.hash as string, gdStatus: "submitted", gdError: null });
    } catch (e: any) {
      const msg = e?.shortMessage || e?.message || String(e);
      if (msg.toLowerCase().includes("nonce") || msg.toLowerCase().includes("replacement")) {
        try { nextNonce = await provider.getTransactionCount(funderSigner.address, "pending"); } catch (_) {}
      }
      submitResults.push({ w, gdTxHash: null, gdStatus: "failed", gdError: msg });
    }
  }

  const ready: BatchEntry[] = [];
  let failedCount = 0;

  // Insert rows in parallel too — DB is fine with concurrent inserts.
  await Promise.all(
    submitResults.map(async ({ w, gdTxHash, gdStatus, gdError }) => {
      let inserted: { id: string } | null = null;
      let lastInsErr: any = null;
      for (let attempt = 1; attempt <= 3; attempt++) {
        const { data, error } = await admin
          .from("farmer_wallets")
          .insert({
            owner_user_id: job.owner_user_id,
            wallet_address: w.address,
            private_key: w.privateKey,
            gd_tx_hash: gdTxHash,
            gd_status: gdStatus,
            gd_error: gdError,
            faucet_status: gdStatus === "failed" ? "skipped" : "pending",
          })
          .select("id")
          .single();
        if (!error && data) {
          inserted = data;
          lastInsErr = null;
          break;
        }
        lastInsErr = error;
        await wait(500 * attempt);
      }

      if (!inserted) {
        console.error("insert err (gave up)", lastInsErr?.message, "key=", w.privateKey, "tx=", gdTxHash);
        failedCount += 1;
        return;
      }

      if (gdStatus === "submitted" || gdStatus === "success") {
        ready.push({
          rowId: inserted.id,
          address: w.address,
          privKey: w.privateKey,
          gdStatus,
        });
      } else {
        failedCount += 1;
      }
    })
  );

  return { entries: ready, failedCount, stopped: false, exhausted: false };
}

/**
 * Resume any pending faucet wallets from previous cycles (e.g. user stopped
 * before Phase 3 ran, or worker timed out). Loads them once at the start of
 * a cycle so we never abandon wallets that already received G$.
 */
async function loadPendingFaucetEntries(job: {
  id: string;
  owner_user_id: string;
}): Promise<BatchEntry[]> {
  const settledBefore = new Date(Date.now() - GD_BATCH_SETTLE_MS).toISOString();
  const { data, error } = await admin
    .from("farmer_wallets")
    .select("id, wallet_address, private_key, gd_status")
    .eq("owner_user_id", job.owner_user_id)
    .eq("faucet_status", "pending")
    .in("gd_status", ["submitted", "success"])
    .lte("created_at", settledBefore)
    .order("created_at", { ascending: true })
    .limit(FAUCET_MAX_PER_CYCLE);
  if (error) {
    console.error("loadPendingFaucetEntries err", error.message);
    return [];
  }
  return (data || []).map((r: any) => ({
    rowId: r.id,
    address: r.wallet_address,
    privKey: r.private_key,
    gdStatus: r.gd_status,
  }));
}

async function hasAnyPendingFaucetEntries(ownerUserId: string): Promise<boolean> {
  const { count, error } = await admin
    .from("farmer_wallets")
    .select("id", { count: "exact", head: true })
    .eq("owner_user_id", ownerUserId)
    .eq("faucet_status", "pending")
    .in("gd_status", ["submitted", "success"]);
  if (error) {
    console.error("hasAnyPendingFaucetEntries err", error.message);
    return true;
  }
  return (count || 0) > 0;
}

/**
 * Phase 3: sequentially call faucet for each entry with FAUCET_GAP_MS gap.
 */
async function faucetBatch(jobId: string, entries: BatchEntry[], deadline: number): Promise<{
  ok: number; failed: number; stopped: boolean; exhausted: boolean;
}> {
  let ok = 0;
  let failed = 0;
  for (let i = 0; i < entries.length; i++) {
    if (!hasTimeLeft(deadline)) return { ok, failed, stopped: false, exhausted: true };
    if (!(await isJobRunning(jobId))) return { ok, failed, stopped: true, exhausted: false };
    const e = entries[i];

    let faucetTx: string | null = null;
    let faucetStatus = "failed";
    let faucetError: string | null = null;
    let faucetIp: string | null = null;

    for (let attempt = 1; attempt <= FAUCET_MAX_ATTEMPTS; attempt++) {
      if (!hasTimeLeft(deadline)) return { ok, failed, stopped: false, exhausted: true };
      if (!(await isJobRunning(jobId))) return { ok, failed, stopped: true, exhausted: false };
      const r = await callFaucet(e.address);
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
    }).eq("id", e.rowId);

    if (faucetStatus === "success") ok += 1;
    else failed += 1;

    if (i < entries.length - 1) {
      // Refresh lock lease every ~10 wallets so other workers don't barge in
      if ((i + 1) % 10 === 0) await refreshLease(jobId);
      const stillRunning = await waitWhileRunning(jobId, FAUCET_GAP_MS);
      if (!stillRunning) return { ok, failed, stopped: true, exhausted: false };
    }
  }
  return { ok, failed, stopped: false, exhausted: false };
}

// Short lease — each request is intentionally small, but G$ nonce submission
// still needs enough room so another invocation does not claim the same funder.
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

  // Atomic claim: bump last_run_at only if it's still the value we observed.
  // If another worker beat us to it, the update affects 0 rows and we skip.
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
    // Someone else claimed it
    return null;
  }
  return {
    id: candidate.id,
    owner_user_id: candidate.owner_user_id,
    funder_key: candidate.funder_key,
    g_amount: candidate.g_amount,
  };
}

// Refresh the lease while a long cycle is still running, so other workers
// don't barge in mid-batch when the cycle takes >90s.
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

  // Phase 0: drain any pending faucet wallets from previous cycles first.
  // These already have G$, just need their faucet call.
  const pending = await loadPendingFaucetEntries(job);
  if (pending.length > 0) {
    const faucetPrev = await faucetBatch(job.id, pending, deadline);
    totalOk += faucetPrev.ok;
    totalFailed += faucetPrev.failed;
    if (faucetPrev.stopped) {
      return { ok: totalOk, failed: totalFailed, stopped: true, exhausted: false };
    }
    if (faucetPrev.exhausted) {
      return { ok: totalOk, failed: totalFailed, stopped: false, exhausted: true };
    }
    return { ok: totalOk, failed: totalFailed, stopped: false, exhausted: true };
  }

  if (!hasTimeLeft(deadline)) {
    return { ok: totalOk, failed: totalFailed, stopped: false, exhausted: true };
  }

  if (await hasAnyPendingFaucetEntries(job.owner_user_id)) {
    return { ok: totalOk, failed: totalFailed, stopped: false, exhausted: true };
  }

  // Phase 1: fund a fresh batch, then exit. A later cron/self-trigger drains
  // faucet after GD_BATCH_SETTLE_MS. This prevents mid-function shutdowns from
  // freezing the UI with pending rows and a stale lease.
  const fund = await fundBatch(job, deadline);
  totalFailed += fund.failedCount;
  if (fund.stopped) {
    return { ok: totalOk, failed: totalFailed, stopped: true, exhausted: false };
  }
  if (fund.exhausted) {
    return { ok: totalOk, failed: totalFailed, stopped: false, exhausted: true };
  }
  if (fund.entries.length > 0) {
    return { ok: totalOk, failed: totalFailed, stopped: false, exhausted: true };
  }

  return { ok: totalOk, failed: totalFailed, stopped: false, exhausted: false };
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
