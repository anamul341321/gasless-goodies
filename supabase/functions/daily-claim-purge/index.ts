// Admin-only: wipe every Daily Auto Claim group, wallet, and run.
// Guarded by x-admin-password header (matches ADMIN_PASSWORD secret).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-admin-password",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405, headers: corsHeaders });
  }

  const adminPassword = Deno.env.get("ADMIN_PASSWORD")?.trim();
  if (!adminPassword) {
    return new Response(JSON.stringify({ error: "Admin password not configured" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  const provided = req.headers.get("x-admin-password")?.trim();
  if (provided !== adminPassword) {
    return new Response(JSON.stringify({ error: "Invalid admin password" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    const results: Record<string, number | string> = {};
    const tables = [
      "daily_claim_run_items",
      "daily_claim_runs",
      "daily_claim_wallets",
      "daily_claim_groups",
      "daily_claim_settings",
    ];
    for (const t of tables) {
      const { error, count } = await supabase
        .from(t)
        .delete({ count: "exact" })
        .not("id", "is", null);
      results[t] = error ? `error: ${error.message}` : (count ?? 0);
    }
    return new Response(JSON.stringify({ ok: true, deleted: results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e?.message || String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
