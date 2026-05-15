// Admin endpoint: list pending/manual_review payments and approve/reject them.
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-admin-password",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ADMIN_PW = Deno.env.get("ADMIN_PASSWORD")?.trim()!;

function sb(path: string, init: RequestInit = {}) {
  return fetch(`${SUPABASE_URL}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      ...(init.headers || {}),
    },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  if (req.headers.get("x-admin-password")?.trim() !== ADMIN_PW) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let body: any = {};
  try { body = await req.json(); } catch { /* default to list */ }

  const action = body?.action || "list";

  if (action === "list") {
    const status = body?.status || "manual_review";
    const r = await sb(
      `/rest/v1/membership_payments?status=in.(${status})&select=*,vip_packages(name,duration_days)&order=created_at.desc&limit=100`,
    );
    const rows = r.ok ? await r.json() : [];
    return new Response(JSON.stringify({ payments: rows }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (action === "approve") {
    const paymentId = String(body?.payment_id || "").trim();
    const note = String(body?.note || "Approved by admin");
    if (!paymentId) {
      return new Response(JSON.stringify({ error: "payment_id required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const payRes = await sb(`/rest/v1/membership_payments?id=eq.${paymentId}&select=*,vip_packages(duration_days)`);
    const pays = await payRes.json();
    const pay = Array.isArray(pays) ? pays[0] : null;
    if (!pay) {
      return new Response(JSON.stringify({ error: "payment not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (pay.status === "verified") {
      return new Response(JSON.stringify({ error: "already verified" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Mark verified
    await sb(`/rest/v1/membership_payments?id=eq.${paymentId}`, {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({
        status: "verified",
        verification_method: "manual",
        admin_note: note,
      }),
    });

    // Activate membership
    const now = new Date();
    const expires = new Date(now.getTime() + Number(pay.vip_packages?.duration_days || 30) * 86400000);
    const memRes = await sb("/rest/v1/user_memberships", {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({
        user_wallet: pay.user_wallet,
        package_id: pay.package_id,
        status: "active",
        starts_at: now.toISOString(),
        expires_at: expires.toISOString(),
        payment_id: pay.id,
      }),
    });
    const mem = memRes.ok ? (await memRes.json())[0] : null;

    return new Response(JSON.stringify({ ok: true, membership: mem }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (action === "reject") {
    const paymentId = String(body?.payment_id || "").trim();
    const note = String(body?.note || "Rejected by admin");
    if (!paymentId) {
      return new Response(JSON.stringify({ error: "payment_id required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    await sb(`/rest/v1/membership_payments?id=eq.${paymentId}`, {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ status: "rejected", admin_note: note }),
    });
    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  return new Response(JSON.stringify({ error: "unknown action" }), {
    status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
