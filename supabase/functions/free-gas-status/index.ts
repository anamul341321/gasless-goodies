// Public status endpoint for free gas loader.
// Returns current job progress + today's IP usage.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const DAILY_LIMIT = 2;

function sb(path: string, init: RequestInit = {}) {
  return fetch(`${SUPABASE_URL}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
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

  const ip = getClientIp(req);

  let body: any = {};
  try { body = await req.json(); } catch {}
  const jobId = typeof body?.job_id === "string" ? body.job_id : null;
  const knownWallets: string[] = Array.isArray(body?.wallets)
    ? body.wallets.filter((w: any) => typeof w === "string" && /^0x[a-fA-F0-9]{40}$/.test(w)).map((w: string) => w.toLowerCase())
    : [];
  const fingerprint: string | null =
    typeof body?.device_id === "string" && body.device_id.length >= 8 && body.device_id.length <= 200
      ? body.device_id
      : null;

  // Today's usage (by IP, fingerprint, or previously-loaded wallets remembered client-side)
  const countRes = await sb("/rest/v1/rpc/get_free_gas_count_today", {
    method: "POST",
    body: JSON.stringify({
      p_ip: ip,
      p_wallets: knownWallets,
      p_fingerprint: fingerprint,
    }),
  });
  let usedToday = 0;
  if (countRes.ok) {
    const data = await countRes.json();
    usedToday = typeof data === "number" ? data : 0;
  }

  let job: any = null;
  let wallets: any[] = [];
  if (jobId && /^[0-9a-f-]{36}$/i.test(jobId)) {
    const jr = await sb(`/rest/v1/gas_load_jobs?id=eq.${jobId}&select=id,total,done,failed,status,batch_name,created_at,finished_at`);
    if (jr.ok) {
      const rows = await jr.json();
      // Only return job if it was a free batch (batch_name starts with "free-")
      if (Array.isArray(rows) && rows[0] && typeof rows[0].batch_name === "string" && rows[0].batch_name.startsWith("free-")) {
        job = rows[0];
        const wr = await sb(`/rest/v1/gas_load_queue?job_id=eq.${jobId}&select=wallet_address,status,tx_hash,error_message,processed_at&order=created_at.asc`);
        if (wr.ok) wallets = await wr.json();
      }
    }
  }

  return new Response(
    JSON.stringify({
      job,
      wallets,
      used_today: usedToday,
      remaining: Math.max(0, DAILY_LIMIT - usedToday),
      limit: DAILY_LIMIT,
    }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});
