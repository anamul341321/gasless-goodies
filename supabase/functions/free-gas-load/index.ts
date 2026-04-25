// Free public gas loader for non-VIP users.
// Limits: max 2 wallet loads per day per IP (UTC date).
// Reuses the gas_load_jobs/queue/worker pipeline so processing keeps
// running in the background even if the user closes their browser.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const DAILY_LIMIT = 2;

function sb(path: string, init: RequestInit = {}) {
  return fetch(`${SUPABASE_URL}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      ...(init.headers || {}),
    },
  });
}

function getClientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for") || "";
  const first = fwd.split(",")[0]?.trim();
  if (first) return first;
  return (
    req.headers.get("cf-connecting-ip") ||
    req.headers.get("x-real-ip") ||
    "unknown"
  );
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "POST only" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Check global enabled flag
  try {
    const enabledRes = await sb(
      "/rest/v1/admin_settings?id=eq.main&select=gas_loader_enabled",
    );
    if (enabledRes.ok) {
      const rows = await enabledRes.json();
      const flag =
        Array.isArray(rows) && rows[0] ? rows[0].gas_loader_enabled : true;
      if (flag === false) {
        return new Response(
          JSON.stringify({
            error: "Gas loader is currently disabled by admin.",
          }),
          {
            status: 403,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }
    }
  } catch (_) {
    // ignore
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "invalid json" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const wallets: string[] = Array.isArray(body?.wallets) ? body.wallets : [];
  const fingerprint: string | null =
    typeof body?.device_id === "string" && body.device_id.length >= 8 && body.device_id.length <= 200
      ? body.device_id
      : null;

  // Validate + dedupe
  const seen = new Set<string>();
  const valid: string[] = [];
  for (const w of wallets) {
    if (typeof w !== "string") continue;
    if (!/^0x[a-fA-F0-9]{40}$/.test(w)) continue;
    const k = w.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    valid.push(w);
  }
  if (valid.length === 0) {
    return new Response(
      JSON.stringify({ error: "No valid wallet addresses provided" }),
      {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }

  const ip = getClientIp(req);

  // Check today's usage for this IP OR fingerprint OR any of the submitted wallets
  const countRes = await sb("/rest/v1/rpc/get_free_gas_count_today", {
    method: "POST",
    body: JSON.stringify({
      p_ip: ip,
      p_wallets: valid.map((w) => w.toLowerCase()),
      p_fingerprint: fingerprint,
    }),
  });
  let usedToday = 0;
  if (countRes.ok) {
    const data = await countRes.json();
    usedToday = typeof data === "number" ? data : 0;
  }

  const remaining = Math.max(0, DAILY_LIMIT - usedToday);
  if (remaining <= 0) {
    return new Response(
      JSON.stringify({
        error: "Daily limit reached",
        message: `Free users can load only ${DAILY_LIMIT} wallets per day. Upgrade to VIP for unlimited loading.`,
        used_today: usedToday,
        limit: DAILY_LIMIT,
        remaining: 0,
      }),
      {
        status: 429,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }

  // Filter out wallets already loaded today (any IP)
  const lowered = valid.map((w) => w.toLowerCase());
  const dupRes = await sb(
    `/rest/v1/free_gas_usage?used_on=eq.${new Date().toISOString().slice(0, 10)}&select=wallet_address&wallet_address=in.(${lowered.join(",")})`,
  );
  let alreadyLoaded = new Set<string>();
  if (dupRes.ok) {
    const rows = await dupRes.json();
    if (Array.isArray(rows)) alreadyLoaded = new Set(rows.map((r: any) => String(r.wallet_address).toLowerCase()));
  }
  const fresh = valid.filter((w) => !alreadyLoaded.has(w.toLowerCase()));
  const dupSkipped = valid.length - fresh.length;

  // Only allow up to `remaining` wallets in this submission
  const allowed = fresh.slice(0, remaining);
  const skipped = (fresh.length - allowed.length) + dupSkipped;

  if (allowed.length === 0) {
    return new Response(
      JSON.stringify({
        error: "Already loaded today",
        message: dupSkipped > 0
          ? `These wallet(s) already received free gas today. Try again tomorrow or upgrade to VIP.`
          : `Daily free limit reached. Upgrade to VIP for unlimited loading.`,
        used_today: usedToday,
        limit: DAILY_LIMIT,
        remaining: Math.max(0, DAILY_LIMIT - usedToday),
        skipped,
      }),
      {
        status: 429,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }

  // Create a job
  const jobRes = await sb("/rest/v1/gas_load_jobs", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({
      total: allowed.length,
      delay_ms: 3000,
      status: "pending",
      batch_name: `free-${ip.slice(0, 12)}-${new Date().toISOString().slice(0, 10)}`,
    }),
  });
  if (!jobRes.ok) {
    const t = await jobRes.text();
    return new Response(
      JSON.stringify({ error: "Failed to create job", detail: t }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
  const job = (await jobRes.json())[0];
  const jobId = job.id as string;

  // Insert queue rows
  const queueRows = allowed.map((w) => ({
    job_id: jobId,
    wallet_address: w,
    status: "pending",
  }));
  const qRes = await sb("/rest/v1/gas_load_queue", {
    method: "POST",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify(queueRows),
  });
  if (!qRes.ok) {
    const t = await qRes.text();
    return new Response(
      JSON.stringify({ error: "Failed to enqueue", detail: t }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }

  // Record IP + fingerprint usage rows
  const usageRows = allowed.map((w) => ({
    ip_address: ip,
    wallet_address: w.toLowerCase(),
    status: "queued",
    device_fingerprint: fingerprint,
  }));
  await sb("/rest/v1/free_gas_usage", {
    method: "POST",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify(usageRows),
  }).catch(() => {});

  // Kick worker (best effort)
  fetch(`${SUPABASE_URL}/functions/v1/gas-loader-worker`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ trigger: "free", job_id: jobId }),
  }).catch(() => {});

  return new Response(
    JSON.stringify({
      job_id: jobId,
      total: allowed.length,
      skipped,
      used_today: usedToday + allowed.length,
      remaining: DAILY_LIMIT - (usedToday + allowed.length),
      limit: DAILY_LIMIT,
      message: skipped > 0
        ? `Daily limit: only ${allowed.length} of ${valid.length} wallets queued.`
        : "Wallets queued successfully.",
    }),
    {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    },
  );
});
