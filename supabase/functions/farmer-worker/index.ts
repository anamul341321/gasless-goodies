// Background worker that processes active farmer_jobs.
// Runs on pg_cron every minute. Single isolate guard to avoid overlap.
// For each running job: generate 10 wallets -> send G$ to all -> wait 10s -> faucet one-by-one with 3s gaps.
// Repeats until time budget exhausted, then re-triggers itself if more work remains.

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

const GD_SETTLE_WAIT_MS = 7_000;       // strict 7s wait after G$ transfer before faucet
const FAUCET_RETRY_WAIT_MS = 3_000;    // wait before retry with new IP
const FAUCET_MAX_ATTEMPTS = 2;         // 1 initial + 1 retry with fresh IP
const WALLET_GAP_MS = 2_000;           // gap between wallets to avoid faucet rate limit

const WORKER_TIME_BUDGET_MS = 110_000;
const TRIGGER_URL = `${SUPABASE_URL}/functions/v1/farmer-worker`;

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
  const timeout = setTimeout(() => ac.abort(), 35_000);
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

  let ip: string | undefined;
  try {
    const ipRes = await fetch("https://api.ipify.org?format=json", opts());
    if (ipRes.ok) ip = (await ipRes.json()).ip;
  } catch (_) {}

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

async function processOneWallet(job: {
  id: string;
  owner_user_id: string;
  funder_key: string;
  g_amount: string;
}): Promise<{ ok: boolean; failed: boolean; stopped?: boolean; error?: string }> {
  let gAmountWei: bigint;
  try {
    gAmountWei = parseUnits(job.g_amount || "0.5", 18);
    if (gAmountWei <= 0n) throw new Error("amount must be > 0");
  } catch (e: any) {
    return { ok: false, failed: true, error: `invalid g_amount: ${e?.message || e}` };
  }
  if (!/^0x[a-fA-F0-9]{64}$/.test(job.funder_key)) {
    return { ok: false, failed: true, error: "invalid funder key" };
  }

  // 1. Create new wallet (fast)
  const newWallet = Wallet.createRandom();
  const newAddress = newWallet.address;
  const newPrivKey = newWallet.privateKey;

  // 2. Send G$ from funder (fast — submit + 1 confirmation)
  let gdTxHash: string | null = null;
  let gdStatus = "failed";
  let gdError: string | null = null;
  try {
    const funderSigner = new Wallet(job.funder_key, provider);
    const gd = new Contract(G_DOLLAR_ADDRESS, G_DOLLAR_ABI, funderSigner);
    const tx = await gd.transfer(newAddress, gAmountWei);
    gdTxHash = tx.hash;
    gdStatus = "submitted";
    try {
      const rcpt = await tx.wait(1);
      gdStatus = rcpt && rcpt.status === 1 ? "success" : "failed";
    } catch (e: any) {
      gdStatus = "submitted";
      gdError = e?.message || String(e);
    }
  } catch (e: any) {
    gdError = e?.shortMessage || e?.message || String(e);
  }

  // 3. Strict 7s wait for G$ to settle (no DB calls, no work — pure sleep)
  //    then faucet (1 retry with fresh IP after 3s)
  let faucetTx: string | null = null;
  let faucetStatus = "failed";
  let faucetError: string | null = null;
  let faucetIp: string | null = null;

  if (gdStatus === "success" || gdStatus === "submitted") {
    // Quick stop check before the long wait
    if (!(await isJobRunning(job.id))) {
      return { ok: false, failed: false, stopped: true };
    }
    // Pure 7s sleep — nothing else happens during this window
    await wait(GD_SETTLE_WAIT_MS);
    if (!(await isJobRunning(job.id))) {
      return { ok: false, failed: false, stopped: true };
    }
    for (let attempt = 1; attempt <= FAUCET_MAX_ATTEMPTS; attempt++) {
      if (!(await isJobRunning(job.id))) {
        return { ok: false, failed: false, stopped: true };
      }
      const r = await callFaucet(newAddress);
      faucetIp = r.ip || null;
      if (r.ok) {
        faucetStatus = "success";
        faucetTx = r.txHash || null;
        faucetError = null;
        break;
      }
      faucetError = r.error || "unknown error";
      if (attempt < FAUCET_MAX_ATTEMPTS) {
        if (!(await waitWhileRunning(job.id, FAUCET_RETRY_WAIT_MS))) {
          return { ok: false, failed: false, stopped: true };
        }
        continue;
      }
    }
  } else {
    faucetError = "skipped — G$ transfer failed";
    faucetStatus = "skipped";
  }

  // 4. Save row
  await admin.from("farmer_wallets").insert({
    owner_user_id: job.owner_user_id,
    wallet_address: newAddress,
    private_key: newPrivKey,
    gd_tx_hash: gdTxHash,
    gd_status: gdStatus,
    gd_error: gdError,
    faucet_tx_hash: faucetTx,
    faucet_status: faucetStatus,
    faucet_error: faucetError,
    faucet_ip: faucetIp,
  });

  const ok = faucetStatus === "success";
  return {
    ok,
    failed: !ok,
    error: ok ? undefined : faucetError || gdError || "unknown",
  };
}

async function pickNextJob(): Promise<{
  id: string;
  owner_user_id: string;
  funder_key: string;
  g_amount: string;
} | null> {
  const { data, error } = await admin
    .from("farmer_jobs")
    .select("id, owner_user_id, funder_key, g_amount")
    .eq("status", "running")
    .order("last_run_at", { ascending: true, nullsFirst: true })
    .limit(1);
  if (error) {
    console.error("pickNextJob error", error.message);
    return null;
  }
  if (!data || data.length === 0) return null;
  return data[0] as any;
}

async function processLoop() {
  const startedAt = Date.now();
  let processed = 0;

  while (Date.now() - startedAt < WORKER_TIME_BUDGET_MS) {
    const job = await pickNextJob();
    if (!job) return { processed, remaining: false };

    let result: { ok: boolean; failed: boolean; stopped?: boolean; error?: string };
    try {
      result = await processOneWallet(job);
    } catch (e: any) {
      result = { ok: false, failed: true, error: e?.message || String(e) };
    }

    const { data: cur } = await admin
      .from("farmer_jobs")
      .select("status, ok_count, failed_count")
      .eq("id", job.id)
      .single();

    if (cur) {
      const patch: any = {
        last_run_at: new Date().toISOString(),
        last_error: result.ok ? null : result.error || null,
      };
      if (result.ok) patch.ok_count = (cur.ok_count || 0) + 1;
      if (result.failed) patch.failed_count = (cur.failed_count || 0) + 1;
      await admin.from("farmer_jobs").update(patch).eq("id", job.id);

      if (cur.status !== "running" || result.stopped) return { processed, remaining: false };
    }

    processed += (result.ok ? 1 : 0) + (result.failed ? 1 : 0);
  }

  // Time budget exhausted; check if any running job remains
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

    // Self re-trigger if more work is pending so we don't wait for the next cron tick
    if (result.remaining) {
      fetch(TRIGGER_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          apikey: SUPABASE_SERVICE_ROLE_KEY,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ trigger: "continue" }),
      }).catch(() => {});
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
