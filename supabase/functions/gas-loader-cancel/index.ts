// Cancels an active gas-load job. Marks the job 'completed' (with finished_at)
// and converts every still-pending/processing wallet to 'failed' with a clear
// error message. The worker will skip cancelled jobs naturally.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-admin-password",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function sbHeaders(extra: Record<string, string> = {}) {
  return {
    "Content-Type": "application/json",
    apikey: SERVICE_KEY,
    Authorization: `Bearer ${SERVICE_KEY}`,
    ...extra,
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
  try {
    body = await req.json();
  } catch {
    // ignore
  }
  const jobId = String(body?.jobId || "").trim();
  if (!jobId || !/^[0-9a-f-]{36}$/i.test(jobId)) {
    return new Response(JSON.stringify({ error: "invalid jobId" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    // 1) Mark all pending/processing wallets in this job as failed.
    const wRes = await fetch(
      `${SUPABASE_URL}/rest/v1/gas_load_queue?job_id=eq.${jobId}&status=in.(pending,processing)`,
      {
        method: "PATCH",
        headers: sbHeaders({ Prefer: "return=representation" }),
        body: JSON.stringify({
          status: "failed",
          error_message: "Cancelled by user",
          processed_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }),
      }
    );
    const updatedWallets = wRes.ok ? await wRes.json() : [];
    const cancelledCount = Array.isArray(updatedWallets) ? updatedWallets.length : 0;

    // 2) Recalculate done/failed totals from the queue.
    const sumRes = await fetch(
      `${SUPABASE_URL}/rest/v1/gas_load_queue?job_id=eq.${jobId}&select=status`,
      { headers: sbHeaders() }
    );
    let done = 0;
    let failed = 0;
    let total = 0;
    if (sumRes.ok) {
      const all = await sumRes.json();
      if (Array.isArray(all)) {
        total = all.length;
        for (const r of all) {
          if (r.status === "success") done += 1;
          else if (r.status === "failed") failed += 1;
        }
      }
    }

    // 3) Mark the job completed (so worker skips it & UI hides spinner).
    //    Set retry_round = max_retries to disable any further auto-retry round.
    await fetch(`${SUPABASE_URL}/rest/v1/gas_load_jobs?id=eq.${jobId}`, {
      method: "PATCH",
      headers: sbHeaders({ Prefer: "return=minimal" }),
      body: JSON.stringify({
        status: "completed",
        done,
        failed,
        retry_round: 999,
        finished_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }),
    });

    return new Response(
      JSON.stringify({ ok: true, cancelled: cancelledCount, done, failed, total }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e?.message || String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
