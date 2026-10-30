import { historyUser, historyDenied } from "../_shared/historyAuth.ts";
// Returns status of a bulk G$ send job + per-recipient breakdown.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const requester = await historyUser(req);
  if (!requester) return historyDenied(corsHeaders);

  try {
    const url = new URL(req.url);
    let jobId = url.searchParams.get("job_id");
    if (!jobId && req.method === "POST") {
      const b = await req.json().catch(() => ({}));
      jobId = b?.job_id || null;
    }
    if (!jobId) return json({ error: "job_id required" }, 400);

    const sb = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

    const { data: job, error } = await sb
      .from("gd_bulk_jobs")
      .select("id, sender_address, amount_per_recipient, total, sent, failed, skipped, status, approve_tx, last_error, created_at, finished_at")
      .eq("id", jobId)
      .eq("owner_user_id", requester.id)
      .single();
    if (error || !job) return json({ error: "Job not found" }, 404);

    const { data: recips } = await sb
      .from("gd_bulk_recipients")
      .select("wallet_address, status, tx_hash, error_message, processed_at")
      .eq("job_id", jobId)
      .order("created_at", { ascending: true })
      .limit(5000);

    return json({ ok: true, job, recipients: recips || [] });
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
