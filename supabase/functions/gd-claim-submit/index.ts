// Public endpoint: accepts pasted private keys, derives addresses,
// creates a gd_claim_jobs row + queue rows, kicks the worker.

import { Wallet } from "npm:ethers@6.13.4";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { resolveNetwork } from "../_shared/gdNetworks.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

async function getUserFromAuthHeader(authHeader: string | null): Promise<{ id: string; email: string | null } | null> {
  if (!authHeader) return null;
  const token = authHeader.replace(/^Bearer\s+/i, "");
  if (!token || token === SUPABASE_ANON_KEY) return null;
  try {
    const supa = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const { data, error } = await supa.auth.getUser();
    if (error || !data?.user) return null;
    return { id: data.user.id, email: data.user.email ?? null };
  } catch {
    return null;
  }
}

function sbHeaders(extra: Record<string, string> = {}) {
  return {
    "Content-Type": "application/json",
    apikey: SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    ...extra,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Identify the caller (optional). Logged-in users get their batch linked.
  const user = await getUserFromAuthHeader(req.headers.get("Authorization"));

  let body: any;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "invalid json" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const rawKeys: string[] = Array.isArray(body?.private_keys) ? body.private_keys : [];
  const batchName: string =
    typeof body?.batch_name === "string" && body.batch_name.trim()
      ? body.batch_name.trim().slice(0, 80)
      : `Claim ${new Date().toISOString().slice(0, 16).replace("T", " ")}`;


  if (rawKeys.length === 0) {
    return new Response(JSON.stringify({ error: "no private keys provided" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (rawKeys.length > 1000) {
    return new Response(JSON.stringify({ error: "max 1000 keys per batch" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Validate + derive addresses, dedupe
  const seen = new Set<string>();
  const valid: { address: string; pk: string }[] = [];
  let invalid = 0;

  for (const raw of rawKeys) {
    if (typeof raw !== "string") {
      invalid++;
      continue;
    }
    let pk = raw.trim();
    if (!pk) continue;
    if (!pk.startsWith("0x")) pk = "0x" + pk;
    if (!/^0x[a-fA-F0-9]{64}$/.test(pk)) {
      invalid++;
      continue;
    }
    try {
      const w = new Wallet(pk);
      const addr = w.address.toLowerCase();
      if (seen.has(addr)) continue;
      seen.add(addr);
      valid.push({ address: w.address, pk });
    } catch {
      invalid++;
    }
  }

  if (valid.length === 0) {
    return new Response(JSON.stringify({ error: "no valid private keys" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Create job (linked to user when authenticated)
  const jobRes = await fetch(`${SUPABASE_URL}/rest/v1/gd_claim_jobs`, {
    method: "POST",
    headers: sbHeaders({ Prefer: "return=representation" }),
    body: JSON.stringify({
      total: valid.length,
      status: "pending",
      batch_name: batchName,
      owner_user_id: user?.id ?? null,
      owner_label: user?.email ?? null,
    }),
  });

  if (!jobRes.ok) {
    const text = await jobRes.text();
    return new Response(JSON.stringify({ error: "failed to create job", detail: text }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const jobRows = await jobRes.json();
  const job = Array.isArray(jobRows) ? jobRows[0] : jobRows;
  const jobId = job.id as string;

  // Insert queue rows
  const queueRows = valid.map((v) => ({
    job_id: jobId,
    wallet_address: v.address,
    private_key: v.pk,
    status: "pending",
  }));

  const BATCH = 200;
  for (let i = 0; i < queueRows.length; i += BATCH) {
    const slice = queueRows.slice(i, i + BATCH);
    const qRes = await fetch(`${SUPABASE_URL}/rest/v1/gd_claim_queue`, {
      method: "POST",
      headers: sbHeaders({ Prefer: "return=minimal" }),
      body: JSON.stringify(slice),
    });
    if (!qRes.ok) {
      const text = await qRes.text();
      return new Response(JSON.stringify({ error: "failed to enqueue", detail: text }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  }

  // Kick the worker (best-effort)
  fetch(`${SUPABASE_URL}/functions/v1/gd-claim-worker`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ trigger: "submit", job_id: jobId }),
  }).catch(() => {});

  return new Response(
    JSON.stringify({
      job_id: jobId,
      total: valid.length,
      invalid,
    }),
    {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    }
  );
});
