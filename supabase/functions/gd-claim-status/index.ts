// Public status endpoint for the GoodDollar claim job UI to poll.
// Reads only counts + per-wallet status (no private keys).

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
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

  let body: any;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "invalid json" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const jobId = typeof body?.job_id === "string" ? body.job_id : "";
  if (!/^[0-9a-f-]{36}$/i.test(jobId)) {
    return new Response(JSON.stringify({ error: "invalid job_id" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const includeWallets = body?.include_wallets === true;

  const jobRes = await fetch(
    `${SUPABASE_URL}/rest/v1/rpc/get_gd_claim_status`,
    {
      method: "POST",
      headers: sbHeaders(),
      body: JSON.stringify({ p_job_id: jobId }),
    }
  );
  if (!jobRes.ok) {
    return new Response(JSON.stringify({ error: "lookup failed" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  const jobs = await jobRes.json();
  const job = Array.isArray(jobs) && jobs[0] ? jobs[0] : null;
  if (!job) {
    return new Response(JSON.stringify({ job: null, wallets: [] }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let wallets: any[] = [];
  if (includeWallets) {
    const wRes = await fetch(
      `${SUPABASE_URL}/rest/v1/rpc/get_gd_claim_wallets`,
      {
        method: "POST",
        headers: sbHeaders(),
        body: JSON.stringify({ p_job_id: jobId }),
      }
    );
    if (wRes.ok) wallets = await wRes.json();
  }

  return new Response(JSON.stringify({ job, wallets }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
