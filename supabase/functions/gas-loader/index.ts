import { historyUser, historyDenied } from "../_shared/historyAuth.ts";
// Instant job queue submitter.
// Validates wallets, creates a job + queue rows, returns the job_id immediately.
// The actual faucet calls are processed by gas-loader-worker (cron-driven).

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-admin-password",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

async function sbFetch(path: string, init: RequestInit) {
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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const requester = await historyUser(req);
  if (!requester) return historyDenied(corsHeaders);

  const adminPassword = Deno.env.get("ADMIN_PASSWORD")?.trim();
  const provided = req.headers.get("x-admin-password")?.trim();
  if (false && (!adminPassword || provided !== adminPassword)) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Check global enabled flag (admin can switch off from dashboard)
  try {
    const enabledRes = await sbFetch(
      "/rest/v1/admin_settings?id=eq.main&select=gas_loader_enabled",
      { method: "GET" }
    );
    if (enabledRes.ok) {
      const rows = await enabledRes.json();
      const flag = Array.isArray(rows) && rows[0]
        ? rows[0].gas_loader_enabled
        : true;
      if (flag === false) {
        return new Response(
          JSON.stringify({ error: "Gas loader is currently disabled by admin." }),
          {
            status: 403,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }
    }
  } catch (e) {
    console.warn("enabled check failed", (e as Error).message);
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
  const delayMs: number = Math.max(
    0,
    Math.min(15000, Number(body?.delay_ms ?? 3000))
  );
  const batchName: string =
    typeof body?.batch_name === "string" ? body.batch_name.trim() : "";
  const network: "celo" | "xdc" | "fuse" = body?.network === "xdc" || body?.network === "fuse" ? body.network : "celo";

  if (!batchName || batchName.length < 1 || batchName.length > 80) {
    return new Response(
      JSON.stringify({
        error: "batch_name is required (1-80 characters)",
      }),
      {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }

  // Dedupe + validate
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
      JSON.stringify({ error: "no valid wallet addresses provided" }),
      {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }

  // Create job
  const jobRes = await sbFetch("/rest/v1/gas_load_jobs", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({
      owner_user_id: requester.id,
      total: valid.length,
      delay_ms: delayMs,
      status: "pending",
      batch_name: batchName,
      network,
    }),
  });

  if (!jobRes.ok) {
    const text = await jobRes.text();
    return new Response(
      JSON.stringify({ error: "failed to create job", detail: text }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }

  const jobRows = await jobRes.json();
  const job = Array.isArray(jobRows) ? jobRows[0] : jobRows;
  const jobId = job.id as string;

  // Insert queue rows in background — return job_id immediately so the client
  // doesn't time out on huge batches (e.g. 2,000+ wallets).
  const queueRows = valid.map((w) => ({
    job_id: jobId,
    wallet_address: w,
    status: "pending",
  }));

  const enqueueAndKick = async () => {
    const BATCH = 500;
    for (let i = 0; i < queueRows.length; i += BATCH) {
      const slice = queueRows.slice(i, i + BATCH);
      const qRes = await sbFetch("/rest/v1/gas_load_queue", {
        method: "POST",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify(slice),
      });
      if (!qRes.ok) {
        const text = await qRes.text();
        console.error("queue insert failed", text);
        return;
      }
    }
    // Kick worker once all rows are enqueued
    fetch(`${SUPABASE_URL}/functions/v1/gas-loader-worker`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ trigger: "submit", job_id: jobId }),
    }).catch((e) => console.warn("kick worker failed", (e as Error).message));
  };

  // @ts-ignore — EdgeRuntime is available in Supabase Edge Functions
  if (typeof EdgeRuntime !== "undefined" && EdgeRuntime?.waitUntil) {
    // @ts-ignore
    EdgeRuntime.waitUntil(enqueueAndKick());
  } else {
    enqueueAndKick().catch((e) => console.error("enqueue failed", e));
  }

  return new Response(
    JSON.stringify({
      job_id: jobId,
      total: valid.length,
      invalid: wallets.length - valid.length,
      queued: "background",
    }),
    {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    }
  );
});
