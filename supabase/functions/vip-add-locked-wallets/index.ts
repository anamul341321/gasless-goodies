// Add wallet addresses to a membership's locked list.
// Enforces: must own the membership, must be active, total ≤ wallet_slots (350).
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

  // GET = list locked wallets for a membership
  if (req.method === "GET") {
    const u = new URL(req.url);
    const membershipId = (u.searchParams.get("membership_id") || "").trim();
    const wallet = (u.searchParams.get("wallet") || "").trim();
    if (!membershipId || !/^0x[a-fA-F0-9]{40}$/.test(wallet)) {
      return new Response(JSON.stringify({ error: "Missing membership_id or wallet" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const r = await sb("/rest/v1/rpc/get_user_locked_wallets", {
      method: "POST",
      body: JSON.stringify({ p_membership_id: membershipId, p_wallet: wallet }),
    });
    const list = r.ok ? await r.json() : [];
    return new Response(JSON.stringify({ wallets: list }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let body: any;
  try { body = await req.json(); } catch {
    return new Response(JSON.stringify({ error: "invalid json" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const userWallet = String(body?.user_wallet || "").trim();
  const membershipId = String(body?.membership_id || "").trim();
  const wallets: string[] = Array.isArray(body?.wallets) ? body.wallets : [];

  if (!/^0x[a-fA-F0-9]{40}$/.test(userWallet)) {
    return new Response(JSON.stringify({ error: "Invalid user wallet" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  if (!membershipId) {
    return new Response(JSON.stringify({ error: "membership_id required" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Validate ownership + active
  const memRes = await sb(
    `/rest/v1/user_memberships?id=eq.${membershipId}&select=id,user_wallet,status,expires_at,package_id,vip_packages(wallet_slots)`,
  );
  const mems = await memRes.json();
  const mem = Array.isArray(mems) ? mems[0] : null;
  if (!mem) {
    return new Response(JSON.stringify({ error: "Membership not found" }), {
      status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  if (mem.user_wallet.toLowerCase() !== userWallet.toLowerCase()) {
    return new Response(JSON.stringify({ error: "Not your membership" }), {
      status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  if (mem.status !== "active") {
    return new Response(JSON.stringify({ error: `Membership is ${mem.status}` }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  if (mem.expires_at && new Date(mem.expires_at) < new Date()) {
    return new Response(JSON.stringify({ error: "Membership has expired" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const slots = Number(mem.vip_packages?.wallet_slots) || 350;

  // Dedupe + validate wallets
  const seen = new Set<string>();
  const valid: string[] = [];
  let invalid = 0;
  for (const w of wallets) {
    if (typeof w !== "string") { invalid++; continue; }
    const t = w.trim();
    if (!/^0x[a-fA-F0-9]{40}$/.test(t)) { invalid++; continue; }
    const k = t.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    valid.push(t);
  }
  if (valid.length === 0) {
    return new Response(JSON.stringify({ error: "No valid wallets provided", invalid }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Check existing count
  const countRes = await sb(
    `/rest/v1/locked_wallets?membership_id=eq.${membershipId}&select=wallet_address`,
  );
  const existing = countRes.ok ? await countRes.json() : [];
  const existingSet = new Set<string>(
    (existing as any[]).map((r) => r.wallet_address.toLowerCase()),
  );
  const toInsert = valid.filter((w) => !existingSet.has(w.toLowerCase()));
  const remaining = slots - existing.length;

  if (toInsert.length === 0) {
    return new Response(
      JSON.stringify({
        ok: true,
        added: 0,
        skipped_existing: valid.length,
        invalid,
        total_locked: existing.length,
        slots_remaining: remaining,
        message: "All wallets are already locked.",
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  if (toInsert.length > remaining) {
    return new Response(
      JSON.stringify({
        error: `Slot limit exceeded. ${existing.length}/${slots} used, can add ${remaining} more, you sent ${toInsert.length} new wallets.`,
        slots_remaining: remaining,
        total_locked: existing.length,
        slots,
      }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  // Insert
  const rows = toInsert.map((w) => ({ membership_id: membershipId, wallet_address: w }));
  const insRes = await sb("/rest/v1/locked_wallets", {
    method: "POST",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify(rows),
  });
  if (!insRes.ok) {
    const t = await insRes.text();
    return new Response(JSON.stringify({ error: "Insert failed", detail: t }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  return new Response(
    JSON.stringify({
      ok: true,
      added: toInsert.length,
      skipped_existing: valid.length - toInsert.length,
      invalid,
      total_locked: existing.length + toInsert.length,
      slots_remaining: remaining - toInsert.length,
      slots,
    }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});
