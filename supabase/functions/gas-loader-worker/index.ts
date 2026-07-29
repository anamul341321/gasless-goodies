// Background worker that processes pending gas_load_queue rows.
// Runs on a cron schedule (every minute) AND can be kicked by gas-loader on submit.
// Single-instance guarded by PG advisory lock to prevent overlap.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const GD_FAUCET_URL = "https://goodserver.gooddollar.org/verify/topWallet";
const CELO_RPC_URL = "https://forno.celo.org";
const XDC_RPC_URL = "https://rpc.xinfin.network";

type Network = "celo" | "xdc";
const CHAIN_IDS: Record<Network, number> = { celo: 42220, xdc: 50 };
const RPC_URLS: Record<Network, string> = { celo: CELO_RPC_URL, xdc: XDC_RPC_URL };
const NATIVE_LABEL: Record<Network, string> = { celo: "CELO", xdc: "XDC" };
const WEBSHARE_HOST = "p.webshare.io";
const WEBSHARE_PORT = "80";
const BALANCE_VERIFY_ATTEMPTS = 8;
const BALANCE_VERIFY_DELAY_MS = 4_000;
// Only skip faucet when the wallet is genuinely ready for the expensive Celo
// claim gas path. Previously this was 0.005 CELO, so wallets with ~0.048 CELO
// were marked success without receiving any faucet tx, while daily claim still
// needed ~0.06 CELO. Match GoodDollar's current app behavior: ~0.06 native
// coin is already enough, so don't mark those wallets failed just because the
// faucet returns success without sending another tx.
const FAUCET_SKIP_THRESHOLD_WEI = 60_000_000_000_000_000n; // 0.06 native coin

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const WS_USERNAME = Deno.env.get("WEBSHARE_PROXY_USERNAME") ?? "";
const WS_PASSWORD = Deno.env.get("WEBSHARE_PROXY_PASSWORD") ?? "";

// Per worker invocation budget — must stay well under 150s edge timeout.
const WORKER_TIME_BUDGET_MS = 110_000;
const STALE_PROCESSING_MINUTES = 3;
// Re-trigger ourselves if more work remains so processing keeps flowing
// even between cron ticks.
const WORKER_TRIGGER_URL = `${SUPABASE_URL}/functions/v1/gas-loader-worker`;

function sbHeaders(extra: Record<string, string> = {}) {
  return {
    "Content-Type": "application/json",
    apikey: SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    ...extra,
  };
}

function buildProxyUrl(): string | null {
  if (!WS_USERNAME || !WS_PASSWORD) return null;
  return `http://${encodeURIComponent(WS_USERNAME)}:${encodeURIComponent(
    WS_PASSWORD
  )}@${WEBSHARE_HOST}:${WEBSHARE_PORT}`;
}

async function getNativeBalanceWei(address: string, network: Network): Promise<bigint | null> {
  try {
    const res = await fetch(RPC_URLS[network], {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "eth_getBalance",
        params: [address, "latest"],
      }),
    });
    const json = await res.json();
    if (!res.ok || json?.error || typeof json?.result !== "string") return null;
    return BigInt(json.result);
  } catch (e) {
    console.error("balance check failed", e);
    return null;
  }
}

async function waitForBalanceIncrease(
  address: string,
  before: bigint | null,
  network: Network,
): Promise<{ increased: boolean; before: string | null; after: string | null }> {
  let after: bigint | null = null;
  for (let i = 0; i < BALANCE_VERIFY_ATTEMPTS; i++) {
    await new Promise((r) => setTimeout(r, BALANCE_VERIFY_DELAY_MS));
    after = await getNativeBalanceWei(address, network);
    if (before !== null && after !== null && after > before) {
      return { increased: true, before: before.toString(), after: after.toString() };
    }
  }
  return {
    increased: false,
    before: before === null ? null : before.toString(),
    after: after === null ? null : after.toString(),
  };
}

// Find the most recent incoming native tx to `address` by scanning the
// last `lookback` blocks. Used to recover tx hash for chains where the
// faucet response doesn't include one (e.g. XDC via GoodDollar).
async function findIncomingTxHash(
  address: string,
  network: Network,
  lookback = 25,
): Promise<string | null> {
  try {
    const rpc = RPC_URLS[network];
    const head = await fetch(rpc, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_blockNumber", params: [] }),
    }).then((r) => r.json());
    if (typeof head?.result !== "string") return null;
    const latest = parseInt(head.result, 16);
    const target = address.toLowerCase();
    for (let i = 0; i < lookback; i++) {
      const blockHex = "0x" + (latest - i).toString(16);
      const blk = await fetch(rpc, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0", id: 1, method: "eth_getBlockByNumber", params: [blockHex, true],
        }),
      }).then((r) => r.json());
      const txs = blk?.result?.transactions;
      if (!Array.isArray(txs)) continue;
      for (const tx of txs) {
        if (typeof tx?.to === "string" && tx.to.toLowerCase() === target) {
          if (tx.value && tx.value !== "0x0" && tx.value !== "0x") {
            return tx.hash || null;
          }
        }
      }
    }
  } catch (e) {
    console.warn("findIncomingTxHash failed", e);
  }
  return null;
}

async function logHistory(row: {
  wallet_address: string;
  status: "success" | "failed";
  tx_hash?: string | null;
  proxy_ip?: string | null;
  error_message?: string | null;
}) {
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/gas_load_history`, {
      method: "POST",
      headers: sbHeaders({ Prefer: "return=minimal" }),
      body: JSON.stringify(row),
    });
  } catch (e) {
    console.error("history log failed", e);
  }
}

function isTerminalFaucetError(error?: string | null): boolean {
  const msg = (error || "").toLowerCase();
  return (
    msg.includes("insufficient funds for gas") ||
    msg.includes("insufficient funds")
  );
}

async function callFaucet(
  account: string,
  network: Network,
  signal: AbortSignal
): Promise<{ ok: boolean; txHash?: string; error?: string; ip?: string }> {
  const proxyUrl = buildProxyUrl();
  // @ts-ignore - Deno runtime API
  const createClient = (Deno as any).createHttpClient;
  let client: any = null;
  if (proxyUrl && typeof createClient === "function") {
    try {
      client = createClient({ proxy: { url: proxyUrl } });
    } catch (e) {
      console.error("createHttpClient failed", e);
    }
  }

  const fetchOpts = (extra: RequestInit = {}): RequestInit => ({
    ...extra,
    // @ts-ignore - non-standard but accepted by Deno
    ...(client ? { client } : {}),
    signal,
  });

  try {
    let ip: string | undefined;
    try {
      const ipRes = await fetch("https://api.ipify.org?format=json", fetchOpts());
      if (ipRes.ok) {
        const j = await ipRes.json();
        ip = j.ip;
      }
    } catch (_) {
      // ignore
    }

    const beforeBalance = await getNativeBalanceWei(account, network);
    const chainId = CHAIN_IDS[network];
    const nativeLabel = NATIVE_LABEL[network];

    // Pre-check: only wallets that are already claim-ready are marked success
    // without a faucet tx. Low-but-nonzero balances must still call faucet.
    if (beforeBalance !== null && beforeBalance >= FAUCET_SKIP_THRESHOLD_WEI) {
      return { ok: true, ip, error: undefined };
    }

    const res = await fetch(
      GD_FAUCET_URL,
      fetchOpts({
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          "User-Agent":
            "Mozilla/5.0 (Linux; Android 13; SM-A536B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36",
          Origin: "https://wallet.gooddollar.org",
          Referer: "https://wallet.gooddollar.org/",
        },
        body: JSON.stringify({ account, chainId }),
      })
    );

    const text = await res.text();
    let body: any = null;
    try {
      body = JSON.parse(text);
    } catch {
      body = { raw: text };
    }

    if (!res.ok) {
      return {
        ok: false,
        ip,
        error:
          body?.error ||
          body?.message ||
          `HTTP ${res.status}: ${text.slice(0, 200)}`,
      };
    }

    const txHash =
      body?.hash ||
      body?.transactionHash ||
      body?.txHash ||
      body?.result?.transactionHash ||
      body?.result?.hash ||
      null;

    if (!txHash && (body?.ok === false || body?.error)) {
      return {
        ok: false,
        ip,
        error:
          body?.error ||
          body?.message ||
          `faucet rejected: ${text.slice(0, 200)}`,
      };
    }

    // If wallet already has enough native gas for a G$ claim, GoodDollar faucet
    // can return {ok:1} without sending a tx. Treat that as success only above
    // the claim-ready threshold.
    if (
      beforeBalance !== null &&
      beforeBalance >= FAUCET_SKIP_THRESHOLD_WEI
    ) {
      return {
        ok: true,
        ip,
        txHash: txHash || undefined,
        error: undefined,
      };
    }

    const confirmation = await waitForBalanceIncrease(account, beforeBalance, network);
    if (!confirmation.increased) {
      return {
        ok: false,
        ip,
        txHash: txHash || undefined,
        error: `faucet returned success but ${nativeLabel} balance did not increase (before=${confirmation.before ?? "unknown"}, after=${confirmation.after ?? "unknown"})`,
      };
    }

    let finalHash = txHash || null;
    if (!finalHash) {
      finalHash = await findIncomingTxHash(account, network);
    }
    return { ok: true, ip, txHash: finalHash || undefined };
  } catch (e: any) {
    return { ok: false, error: e?.message || String(e) };
  } finally {
    try {
      client?.close?.();
    } catch (_) {
      // noop
    }
  }
}

// Atomically grab one pending wallet (any active job) and mark it processing.
async function claimNextWallet(): Promise<{
  id: string;
  job_id: string;
  wallet_address: string;
  delay_ms: number;
  network: Network;
} | null> {
  // If an invocation timed out or crashed after marking rows as processing,
  // those wallets would otherwise stay stuck forever. Re-open stale rows so
  // the next cron/trigger can continue the batch.
  const staleCutoff = new Date(
    Date.now() - STALE_PROCESSING_MINUTES * 60_000
  ).toISOString();
  await fetch(
    `${SUPABASE_URL}/rest/v1/gas_load_queue?status=eq.processing&updated_at=lt.${encodeURIComponent(staleCutoff)}`,
    {
      method: "PATCH",
      headers: sbHeaders({ Prefer: "return=minimal" }),
      body: JSON.stringify({
        status: "pending",
        updated_at: new Date().toISOString(),
      }),
    }
  ).catch((e) => console.warn("stale processing reset failed", e));

  // Find oldest pending row
  const findRes = await fetch(
    `${SUPABASE_URL}/rest/v1/gas_load_queue?status=eq.pending&select=id,job_id,wallet_address&order=created_at.asc&limit=1`,
    { headers: sbHeaders() }
  );
  if (!findRes.ok) {
    console.error("find pending failed", await findRes.text());
    return null;
  }
  const rows = await findRes.json();
  if (!Array.isArray(rows) || rows.length === 0) return null;
  const row = rows[0];

  // Try to claim it (only succeeds if still pending)
  const claimRes = await fetch(
    `${SUPABASE_URL}/rest/v1/gas_load_queue?id=eq.${row.id}&status=eq.pending`,
    {
      method: "PATCH",
      headers: sbHeaders({ Prefer: "return=representation" }),
      body: JSON.stringify({
        status: "processing",
        attempts: 1,
        updated_at: new Date().toISOString(),
      }),
    }
  );
  if (!claimRes.ok) {
    console.error("claim failed", await claimRes.text());
    return null;
  }
  const claimed = await claimRes.json();
  if (!Array.isArray(claimed) || claimed.length === 0) {
    // Lost the race; try again next tick
    return null;
  }

  // Read the parent job's delay + network setting
  const jobRes = await fetch(
    `${SUPABASE_URL}/rest/v1/gas_load_jobs?id=eq.${row.job_id}&select=delay_ms,status,network`,
    { headers: sbHeaders() }
  );
  let delay_ms = 3000;
  let network: Network = "celo";
  if (jobRes.ok) {
    const jobs = await jobRes.json();
    if (Array.isArray(jobs) && jobs[0]) {
      delay_ms = Number(jobs[0].delay_ms) || 3000;
      if (jobs[0].network === "xdc") network = "xdc";
      // Mark job as running on first activity
      if (jobs[0].status === "pending") {
        await fetch(
          `${SUPABASE_URL}/rest/v1/gas_load_jobs?id=eq.${row.job_id}`,
          {
            method: "PATCH",
            headers: sbHeaders({ Prefer: "return=minimal" }),
            body: JSON.stringify({
              status: "running",
              updated_at: new Date().toISOString(),
            }),
          }
        );
      }
    }
  }

  return {
    id: row.id,
    job_id: row.job_id,
    wallet_address: row.wallet_address,
    delay_ms,
    network,
  };
}

// Efficient counter using PostgREST `Prefer: count=exact` HEAD requests.
// Avoids fetching every row in the queue (which was O(n) per wallet =
// O(n²) per batch — would melt at 10k wallets).
async function countQueueByStatus(
  jobId: string,
  status: string,
): Promise<number> {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/gas_load_queue?job_id=eq.${jobId}&status=eq.${status}&select=id`,
    { method: "HEAD", headers: sbHeaders({ Prefer: "count=exact" }) },
  );
  if (!res.ok) return 0;
  const range = res.headers.get("content-range") || "";
  const m = range.match(/\/(\d+|\*)$/);
  if (!m || m[1] === "*") return 0;
  return parseInt(m[1], 10) || 0;
}

async function countTerminalFailed(jobId: string): Promise<number> {
  // Failed rows whose error message contains "insufficient funds" — these
  // cannot be retried by switching IP, so we exclude them from retry logic.
  const url =
    `${SUPABASE_URL}/rest/v1/gas_load_queue?job_id=eq.${jobId}&status=eq.failed` +
    `&error_message=ilike.*insufficient*funds*&select=id`;
  const res = await fetch(url, {
    method: "HEAD",
    headers: sbHeaders({ Prefer: "count=exact" }),
  });
  if (!res.ok) return 0;
  const range = res.headers.get("content-range") || "";
  const m = range.match(/\/(\d+|\*)$/);
  if (!m || m[1] === "*") return 0;
  return parseInt(m[1], 10) || 0;
}

async function finalizeWallet(
  queueId: string,
  jobId: string,
  result: { ok: boolean; txHash?: string; error?: string; ip?: string }
) {
  // Update queue row
  await fetch(`${SUPABASE_URL}/rest/v1/gas_load_queue?id=eq.${queueId}`, {
    method: "PATCH",
    headers: sbHeaders({ Prefer: "return=minimal" }),
    body: JSON.stringify({
      status: result.ok ? "success" : "failed",
      tx_hash: result.txHash || null,
      proxy_ip: result.ip || null,
      error_message: result.ok ? null : result.error || "unknown",
      processed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }),
  });

  // Cheap aggregate via count headers — no full-row scan.
  const [done, failed, pending, processing] = await Promise.all([
    countQueueByStatus(jobId, "success"),
    countQueueByStatus(jobId, "failed"),
    countQueueByStatus(jobId, "pending"),
    countQueueByStatus(jobId, "processing"),
  ]);
  const total = done + failed + pending + processing;
  const allDone = pending === 0 && processing === 0 && total > 0;

  // Auto-retry ALL failed wallets with a fresh proxy/IP. The faucet often
  // returns "insufficient funds" or "balance did not increase" intermittently
  // on a per-IP basis, so every failure deserves at least one retry attempt.
  if (allDone && failed > 0) {
    const jobInfoRes = await fetch(
      `${SUPABASE_URL}/rest/v1/gas_load_jobs?id=eq.${jobId}&select=retry_round,max_retries`,
      { headers: sbHeaders() }
    );
    if (jobInfoRes.ok) {
      const jobInfo = await jobInfoRes.json();
      const info = Array.isArray(jobInfo) && jobInfo[0] ? jobInfo[0] : null;
      const retryRound = Number(info?.retry_round ?? 0);
      const maxRetries = Number(info?.max_retries ?? 2);

      if (retryRound < maxRetries) {
        // Reset all failed queue rows back to pending — fresh IP next attempt
        await fetch(
          `${SUPABASE_URL}/rest/v1/gas_load_queue?job_id=eq.${jobId}&status=eq.failed`,
          {
            method: "PATCH",
            headers: sbHeaders({ Prefer: "return=minimal" }),
            body: JSON.stringify({
              status: "pending",
              tx_hash: null,
              error_message: null,
              proxy_ip: null,
              processed_at: null,
              updated_at: new Date().toISOString(),
            }),
          }
        );

        // Bump retry_round, reset failed count, mark job running again
        await fetch(`${SUPABASE_URL}/rest/v1/gas_load_jobs?id=eq.${jobId}`, {
          method: "PATCH",
          headers: sbHeaders({ Prefer: "return=minimal" }),
          body: JSON.stringify({
            done,
            failed: 0,
            retry_round: retryRound + 1,
            status: "running",
            finished_at: null,
            updated_at: new Date().toISOString(),
          }),
        });
        console.log(
          `[retry] job ${jobId} round ${retryRound + 1}/${maxRetries} — ${failed} failed wallets re-queued`
        );
        return;
      }
    }
  }

  await fetch(`${SUPABASE_URL}/rest/v1/gas_load_jobs?id=eq.${jobId}`, {
    method: "PATCH",
    headers: sbHeaders({ Prefer: "return=minimal" }),
    body: JSON.stringify({
      done,
      failed,
      status: allDone ? "completed" : "running",
      finished_at: allDone ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    }),
  });
}

async function processOneWallet(item: {
  id: string;
  job_id: string;
  wallet_address: string;
  network: Network;
}) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), 45_000);
  let result: { ok: boolean; txHash?: string; error?: string; ip?: string };
  try {
    result = await callFaucet(item.wallet_address, item.network, ac.signal);
  } catch (e: any) {
    result = { ok: false, error: e?.message || String(e) };
  }
  clearTimeout(t);

  await finalizeWallet(item.id, item.job_id, result);
  logHistory({
    wallet_address: item.wallet_address,
    status: result.ok ? "success" : "failed",
    tx_hash: result.txHash || null,
    proxy_ip: result.ip || null,
    error_message: result.ok ? null : result.error || "unknown",
  }).catch(() => {});
}

async function processLoop(): Promise<{ processed: number; remaining: boolean }> {
  const startedAt = Date.now();
  let processed = 0;
  let lastDelay = 0;

  while (Date.now() - startedAt < WORKER_TIME_BUDGET_MS) {
    // Honor user-set delay BETWEEN wallets (e.g., 3000ms = one request every 3s).
    if (lastDelay > 0) {
      await new Promise((r) => setTimeout(r, lastDelay));
      if (Date.now() - startedAt >= WORKER_TIME_BUDGET_MS) break;
    }

    const item = await claimNextWallet();
    if (!item) {
      // No more pending work
      return { processed, remaining: false };
    }

    await processOneWallet(item);

    processed += 1;
    lastDelay = item.delay_ms; // user-controlled delay until next request
  }

  // Time budget exhausted; check if more pending exists
  const pendCheck = await fetch(
    `${SUPABASE_URL}/rest/v1/gas_load_queue?status=eq.pending&select=id&limit=1`,
    { headers: sbHeaders() }
  );
  let remaining = false;
  if (pendCheck.ok) {
    const r = await pendCheck.json();
    remaining = Array.isArray(r) && r.length > 0;
  }
  return { processed, remaining };
}

// Simple in-memory single-flight guard inside this isolate
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

    // Re-trigger ourselves immediately if there's still work, so we don't
    // wait for the next cron tick. Fire-and-forget.
    if (result.remaining) {
      fetch(WORKER_TRIGGER_URL, {
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
    return new Response(
      JSON.stringify({ ok: false, error: e?.message || String(e) }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } finally {
    inFlight = false;
  }
});
