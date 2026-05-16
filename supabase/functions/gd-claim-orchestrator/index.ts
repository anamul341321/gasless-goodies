// Orchestrates the auto gas-recovery + retry phase for GoodDollar claim batches.
// Runs every minute via pg_cron. Two phases:
//   1) gas_phase='requesting' → if the linked gas_load_job is finished, mark
//      gas_phase='gas_done', set retry_eligible_at = now() + 60s.
//   2) gas_phase='gas_done' AND now() >= retry_eligible_at → reset all
//      failed_gas queue rows back to 'pending', flip gas_phase='retrying',
//      and trigger gd-claim-worker.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function sbHeaders(extra: Record<string, string> = {}) {
  return {
    "Content-Type": "application/json",
    apikey: SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    ...extra,
  };
}

async function handleRequesting() {
  const r = await fetch(
    `${SUPABASE_URL}/rest/v1/gd_claim_jobs?gas_phase=eq.requesting&select=id,gas_job_id&limit=100`,
    { headers: sbHeaders() }
  );
  if (!r.ok) return 0;
  const jobs = await r.json();
  let advanced = 0;
  for (const j of jobs || []) {
    if (!j.gas_job_id) continue;
    const gr = await fetch(
      `${SUPABASE_URL}/rest/v1/gas_load_jobs?id=eq.${j.gas_job_id}&select=status,total,done,failed`,
      { headers: sbHeaders() }
    );
    if (!gr.ok) continue;
    const arr = await gr.json();
    const gj = Array.isArray(arr) ? arr[0] : null;
    if (!gj) continue;
    const done = (gj.done || 0) + (gj.failed || 0);
    const terminal = gj.status === "completed" || gj.status === "done" || gj.status === "failed" || (gj.total > 0 && done >= gj.total);
    if (!terminal) continue;
    const eligible = new Date(Date.now() + 60_000).toISOString();
    await fetch(`${SUPABASE_URL}/rest/v1/gd_claim_jobs?id=eq.${j.id}`, {
      method: "PATCH",
      headers: sbHeaders({ Prefer: "return=minimal" }),
      body: JSON.stringify({
        gas_phase: "gas_done",
        gas_done_at: new Date().toISOString(),
        retry_eligible_at: eligible,
        updated_at: new Date().toISOString(),
      }),
    });
    advanced++;
  }
  return advanced;
}

async function handleRetryDue() {
  const nowIso = new Date().toISOString();
  const r = await fetch(
    `${SUPABASE_URL}/rest/v1/gd_claim_jobs?gas_phase=eq.gas_done&retry_eligible_at=lte.${encodeURIComponent(nowIso)}&select=id&limit=50`,
    { headers: sbHeaders() }
  );
  if (!r.ok) return 0;
  const jobs = await r.json();
  let kicked = 0;
  for (const j of jobs || []) {
    // Reset failed_gas wallets back to pending so the worker re-attempts
    const upd = await fetch(
      `${SUPABASE_URL}/rest/v1/gd_claim_queue?job_id=eq.${j.id}&status=eq.failed_gas`,
      {
        method: "PATCH",
        headers: sbHeaders({ Prefer: "return=minimal" }),
        body: JSON.stringify({
          status: "pending",
          error_message: null,
          tx_hash: null,
          updated_at: new Date().toISOString(),
        }),
      }
    );
    if (!upd.ok) continue;

    await fetch(`${SUPABASE_URL}/rest/v1/gd_claim_jobs?id=eq.${j.id}`, {
      method: "PATCH",
      headers: sbHeaders({ Prefer: "return=minimal" }),
      body: JSON.stringify({
        gas_phase: "retrying",
        status: "running",
        finished_at: null,
        updated_at: new Date().toISOString(),
      }),
    });

    // Kick the claim worker
    fetch(`${SUPABASE_URL}/functions/v1/gd-claim-worker`, {
      method: "POST",
      headers: sbHeaders(),
      body: JSON.stringify({ trigger: "retry", job_id: j.id }),
    }).catch(() => {});
    kicked++;
  }
  return kicked;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const [advanced, kicked] = await Promise.all([handleRequesting(), handleRetryDue()]);
    return new Response(JSON.stringify({ ok: true, advanced, kicked }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    console.error("gd-claim-orchestrator error", e?.message || e);
    return new Response(JSON.stringify({ ok: false, error: e?.message || String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
