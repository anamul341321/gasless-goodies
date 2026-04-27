// Submit a CELO sweep batch to run in the background.
// Stores keys in celo_sweep_queue and creates a celo_sweep_jobs row.
// Authenticated users only — keys are tied to the authenticated user_id.

import { createClient } from "npm:@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "method not allowed" }), {
      status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data: userRes, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userRes?.user) {
    return new Response(JSON.stringify({ error: "invalid session" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  const userId = userRes.user.id;

  let body: any;
  try { body = await req.json(); } catch {
    return new Response(JSON.stringify({ error: "invalid json" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const keys: string[] = Array.isArray(body?.keys) ? body.keys : [];
  const receiver: string = typeof body?.receiver === "string" ? body.receiver.trim() : "";

  if (!/^0x[a-fA-F0-9]{40}$/.test(receiver)) {
    return new Response(JSON.stringify({ error: "invalid receiver address" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const seen = new Set<string>();
  const validKeys: string[] = [];
  for (const k of keys) {
    if (typeof k !== "string") continue;
    const t = k.trim();
    if (!/^0x[a-fA-F0-9]{64}$/.test(t)) continue;
    if (seen.has(t.toLowerCase())) continue;
    seen.add(t.toLowerCase());
    validKeys.push(t);
  }
  if (validKeys.length === 0) {
    return new Response(JSON.stringify({ error: "no valid private keys provided" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Create the job
  const { data: job, error: jobErr } = await admin
    .from("celo_sweep_jobs")
    .insert({
      owner_user_id: userId,
      receiver,
      total: validKeys.length,
      status: "running",
    })
    .select("id")
    .single();
  if (jobErr || !job) {
    return new Response(JSON.stringify({ error: jobErr?.message || "failed to create job" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Insert queue rows in chunks of 500
  const CHUNK = 500;
  for (let i = 0; i < validKeys.length; i += CHUNK) {
    const slice = validKeys.slice(i, i + CHUNK).map((pk) => ({
      job_id: job.id,
      owner_user_id: userId,
      private_key: pk,
    }));
    const { error: qErr } = await admin.from("celo_sweep_queue").insert(slice);
    if (qErr) {
      console.error("queue insert err", qErr.message);
      await admin.from("celo_sweep_jobs")
        .update({ status: "stopped", last_error: qErr.message })
        .eq("id", job.id);
      return new Response(JSON.stringify({ error: qErr.message }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  }

  // Trigger worker immediately (don't await)
  fetch(`${SUPABASE_URL}/functions/v1/celo-sweep-worker`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ trigger: "submit", job_id: job.id }),
  }).catch(() => {});

  return new Response(JSON.stringify({
    ok: true,
    job_id: job.id,
    total: validKeys.length,
  }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
});
