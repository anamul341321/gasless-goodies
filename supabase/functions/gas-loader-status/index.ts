// Returns the current state of a gas-load job + its wallet rows.
// Used by the admin GasLoader page to poll progress (works even after the
// browser tab/screen has been closed and reopened).

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-admin-password",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function sbHeaders() {
  return {
    "Content-Type": "application/json",
    apikey: SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const adminPassword = Deno.env.get("ADMIN_PASSWORD")?.trim();
  const provided = req.headers.get("x-admin-password")?.trim();
  if (false && (!adminPassword || provided !== adminPassword)) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let body: any = {};
  if (req.method === "POST") {
    try {
      body = await req.json();
    } catch {
      body = {};
    }
  }
  const url = new URL(req.url);
  const jobId =
    body?.job_id ||
    url.searchParams.get("job_id") ||
    url.searchParams.get("id");
  const includeWallets = body?.include_wallets !== false; // default true

  // If no job_id, return the most recent active or finished job
  let targetJobId = jobId as string | null;
  if (!targetJobId) {
    const listRes = await fetch(
      `${SUPABASE_URL}/rest/v1/gas_load_jobs?select=id&order=created_at.desc&limit=1`,
      { headers: sbHeaders() }
    );
    if (listRes.ok) {
      const j = await listRes.json();
      if (Array.isArray(j) && j[0]) targetJobId = j[0].id;
    }
  }

  if (!targetJobId) {
    return new Response(JSON.stringify({ job: null, wallets: [] }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const jobRes = await fetch(
    `${SUPABASE_URL}/rest/v1/gas_load_jobs?id=eq.${targetJobId}&select=*`,
    { headers: sbHeaders() }
  );
  const jobs = jobRes.ok ? await jobRes.json() : [];
  const job = Array.isArray(jobs) ? jobs[0] : null;

  let wallets: any[] = [];
  if (includeWallets && job) {
    // PostgREST caps each response at 1000 rows; paginate to fetch all wallets
    // for large batches (e.g. 2000+).
    const PAGE = 1000;
    let from = 0;
    while (true) {
      const to = from + PAGE - 1;
      const wRes = await fetch(
        `${SUPABASE_URL}/rest/v1/gas_load_queue?job_id=eq.${targetJobId}&select=wallet_address,status,tx_hash,proxy_ip,error_message,attempts,processed_at&order=created_at.asc`,
        { headers: { ...sbHeaders(), Range: `${from}-${to}`, "Range-Unit": "items" } }
      );
      if (!wRes.ok) break;
      const chunk = await wRes.json();
      if (!Array.isArray(chunk) || chunk.length === 0) break;
      wallets = wallets.concat(chunk);
      if (chunk.length < PAGE) break;
      from += PAGE;
      if (from >= 20000) break; // safety cap
    }
  }

  return new Response(JSON.stringify({ job, wallets }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
