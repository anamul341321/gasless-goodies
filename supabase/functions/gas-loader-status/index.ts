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

  const adminPassword = Deno.env.get("ADMIN_PASSWORD");
  const provided = req.headers.get("x-admin-password");
  if (!adminPassword || provided !== adminPassword) {
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
    const wRes = await fetch(
      `${SUPABASE_URL}/rest/v1/gas_load_queue?job_id=eq.${targetJobId}&select=wallet_address,status,tx_hash,proxy_ip,error_message,attempts,processed_at&order=created_at.asc`,
      { headers: sbHeaders() }
    );
    if (wRes.ok) wallets = await wRes.json();
  }

  return new Response(JSON.stringify({ job, wallets }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
