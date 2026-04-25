import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-admin-password",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

const ADMIN_PASSWORD = Deno.env.get("ADMIN_PASSWORD");
const SAFE_SETTINGS_SELECT = "id, notice_message, gas_loader_enabled, mobile_recharge_enabled, updated_at";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (!ADMIN_PASSWORD) {
    return new Response(JSON.stringify({ error: "Admin password not configured" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, serviceRoleKey);

  if (req.method === "GET") {
    const { data, error } = await supabase
      .from("admin_settings")
      .select(SAFE_SETTINGS_SELECT)
      .eq("id", "main")
      .maybeSingle();

    if (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify(data ?? { id: "main", notice_message: "", updated_at: null }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (req.method === "POST") {
    const password = req.headers.get("x-admin-password");
    if (password !== ADMIN_PASSWORD) {
      return new Response(JSON.stringify({ error: "Invalid admin password" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json().catch(() => ({}));
    const updates: Record<string, unknown> = {};

    if (typeof body.notice_message === "string") updates.notice_message = body.notice_message;
    if (typeof body.gas_loader_enabled === "boolean") updates.gas_loader_enabled = body.gas_loader_enabled;
    if (typeof body.mobile_recharge_enabled === "boolean") updates.mobile_recharge_enabled = body.mobile_recharge_enabled;

    if (Object.keys(updates).length === 0) {
      const { data, error } = await supabase
        .from("admin_settings")
        .select(SAFE_SETTINGS_SELECT)
        .eq("id", "main")
        .maybeSingle();

      if (error) {
        return new Response(JSON.stringify({ error: error.message }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      return new Response(JSON.stringify(data ?? { id: "main", notice_message: "", updated_at: null }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data, error } = await supabase
      .from("admin_settings")
      .upsert({ id: "main", ...updates, updated_at: new Date().toISOString() }, { onConflict: "id" })
      .select(SAFE_SETTINGS_SELECT)
      .maybeSingle();

    if (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify(data), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  return new Response("Method not allowed", { status: 405, headers: corsHeaders });
});