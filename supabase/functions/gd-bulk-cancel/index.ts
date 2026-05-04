import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  try {
    const body = await req.json().catch(() => ({}));
    const jobId = String(body?.job_id || "").trim();
    if (!/^[0-9a-fA-F-]{36}$/.test(jobId)) return json({ error: "Invalid job_id" }, 400);

    const sb = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });
    const now = new Date().toISOString();

    const { data: job, error: jobErr } = await sb
      .from("gd_bulk_jobs")
      .select("id, status")
      .eq("id", jobId)
      .single();
    if (jobErr || !job) return json({ error: "Job not found" }, 404);

    const { error: recErr } = await sb
      .from("gd_bulk_recipients")
      .update({
        status: "skipped",
        error_message: "Cancelled by user before transfer",
        processed_at: now,
      })
      .eq("job_id", jobId)
      .eq("status", "pending");
    if (recErr) return json({ error: recErr.message }, 500);

    const { count: skippedCount } = await sb
      .from("gd_bulk_recipients")
      .select("id", { count: "exact", head: true })
      .eq("job_id", jobId)
      .eq("status", "skipped");

    const { count: sentCount } = await sb
      .from("gd_bulk_recipients")
      .select("id", { count: "exact", head: true })
      .eq("job_id", jobId)
      .eq("status", "sent");

    const { count: failedCount } = await sb
      .from("gd_bulk_recipients")
      .select("id", { count: "exact", head: true })
      .eq("job_id", jobId)
      .eq("status", "failed");

    const { error: updErr } = await sb
      .from("gd_bulk_jobs")
      .update({
        status: "stopped",
        sent: sentCount || 0,
        failed: failedCount || 0,
        skipped: skippedCount || 0,
        last_error: "Cancelled by user",
        finished_at: now,
      })
      .eq("id", jobId);
    if (updErr) return json({ error: updErr.message }, 500);

    return json({ ok: true, sent: sentCount || 0, failed: failedCount || 0, skipped: skippedCount || 0 });
  } catch (e: any) {
    return json({ error: e?.message || String(e) }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
