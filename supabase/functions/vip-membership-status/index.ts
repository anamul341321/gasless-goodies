// Returns memberships, payments and active package summary for a wallet.
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

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

  let wallet = "";
  if (req.method === "POST") {
    try {
      const b = await req.json();
      wallet = String(b?.wallet || "").trim();
    } catch { /* ignore */ }
  } else {
    const u = new URL(req.url);
    wallet = (u.searchParams.get("wallet") || "").trim();
  }

  if (!/^0x[a-fA-F0-9]{40}$/.test(wallet)) {
    return new Response(JSON.stringify({ error: "Invalid wallet address" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Mark expired memberships
  await sb(`/rest/v1/user_memberships?status=eq.active&expires_at=lt.${new Date().toISOString()}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ status: "expired" }),
  }).catch(() => {});

  const memRes = await sb(
    `/rest/v1/rpc/get_user_memberships`,
    {
      method: "POST",
      body: JSON.stringify({ p_wallet: wallet }),
    },
  );
  const memberships = memRes.ok ? await memRes.json() : [];

  const payRes = await sb(
    `/rest/v1/rpc/get_user_payments`,
    {
      method: "POST",
      body: JSON.stringify({ p_wallet: wallet }),
    },
  );
  const payments = payRes.ok ? await payRes.json() : [];

  return new Response(
    JSON.stringify({ wallet, memberships, payments }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});
