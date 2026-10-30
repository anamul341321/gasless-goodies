// Public status endpoint for the GoodDollar claim job UI to poll.
// If the request includes a Supabase user JWT, we forward the user id to
// get_gd_claim_wallets so the user gets back their own failed private keys
// for the recovery boxes.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function sbHeaders(req: Request) {
  return {
    "Content-Type": "application/json",
    apikey: SUPABASE_ANON_KEY,
    Authorization: req.headers.get("Authorization") || "",
  };
}

async function getRequesterId(req: Request): Promise<string | null> {
  const auth = req.headers.get("Authorization") || "";
  if (!auth.toLowerCase().startsWith("bearer ")) return null;
  try {
    const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: auth } },
    });
    const { data } = await sb.auth.getUser();
    return data?.user?.id ?? null;
  } catch {
    return null;
  }
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
      headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" },
    });
  }

  const jobId = typeof body?.job_id === "string" ? body.job_id : "";
  if (!/^[0-9a-f-]{36}$/i.test(jobId)) {
    return new Response(JSON.stringify({ error: "invalid job_id" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" },
    });
  }

  const includeWallets = body?.include_wallets === true;
  const requesterId = await getRequesterId(req);
  if (!requesterId) return new Response(JSON.stringify({ error: "Sign in required" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  const jobRes = await fetch(
    `${SUPABASE_URL}/rest/v1/rpc/get_gd_claim_status`,
    {
      method: "POST",
      headers: sbHeaders(req),
      body: JSON.stringify({ p_job_id: jobId }),
    }
  );
  if (!jobRes.ok) {
    return new Response(JSON.stringify({ error: "lookup failed" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" },
    });
  }
  const jobs = await jobRes.json();
  const job = Array.isArray(jobs) && jobs[0] ? jobs[0] : null;
  if (!job) {
    return new Response(JSON.stringify({ job: null, wallets: [] }), {
      headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" },
    });
  }

  let wallets: any[] = [];
  if (includeWallets) {
    for (let offset = 0; offset < 50000; offset += 1000) {
      const wRes = await fetch(
        `${SUPABASE_URL}/rest/v1/rpc/get_gd_claim_wallets?limit=1000&offset=${offset}`,
        { method: "POST", headers: sbHeaders(req), body: JSON.stringify({ p_job_id: jobId, p_requester: requesterId }) }
      );
      if (!wRes.ok) break;
      const page = await wRes.json();
      wallets.push(...page);
      if (!Array.isArray(page) || page.length < 1000) break;
    }
  }

  return new Response(JSON.stringify({ job, wallets }), {
    headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
});
