// Verifies a SIWE signature, then signs the user in.
// Strategy: each wallet maps to a deterministic synthetic email
//   <wallet>@wallet.celo-sponsor.local
// On first sign-in we create the auth.users row with a random server-only
// password; on every sign-in we mint an access token via password grant.
//
// The password is derived deterministically from the wallet + a server-only
// secret (SUPABASE_SERVICE_ROLE_KEY) using HMAC-SHA256 so we never need to
// store it. This makes the wallet sign-in fully passwordless to the user.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { verifyMessage } from "https://esm.sh/ethers@6.13.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

function sbHeaders(extra: Record<string, string> = {}) {
  return {
    "Content-Type": "application/json",
    apikey: SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    ...extra,
  };
}

function syntheticEmail(wallet: string): string {
  return `${wallet.toLowerCase()}@wallet.celo-sponsor.local`;
}

async function derivedPassword(wallet: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(SUPABASE_SERVICE_ROLE_KEY),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(`siwe:${wallet.toLowerCase()}`));
  const bytes = new Uint8Array(sig);
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  let body: any;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "invalid json" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const wallet = String(body?.wallet_address || "").toLowerCase();
  const nonce = String(body?.nonce || "");
  const message = String(body?.message || "");
  const signature = String(body?.signature || "");

  if (!/^0x[a-f0-9]{40}$/.test(wallet) || !nonce || !message || !signature) {
    return new Response(JSON.stringify({ error: "missing fields" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // 1. Validate nonce: must exist, match wallet, not expired, not used
  const nonceRes = await fetch(
    `${SUPABASE_URL}/rest/v1/siwe_nonces?nonce=eq.${nonce}&select=nonce,wallet_address,expires_at,used`,
    { headers: sbHeaders() }
  );
  if (!nonceRes.ok) {
    return new Response(JSON.stringify({ error: "nonce lookup failed" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  const nrows = await nonceRes.json();
  const nrow = Array.isArray(nrows) ? nrows[0] : null;
  if (!nrow || nrow.used || nrow.wallet_address !== wallet || new Date(nrow.expires_at).getTime() < Date.now()) {
    return new Response(JSON.stringify({ error: "invalid or expired nonce" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // 2. Verify signature
  let signer: string;
  try {
    signer = verifyMessage(message, signature).toLowerCase();
  } catch {
    return new Response(JSON.stringify({ error: "signature verify failed" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  if (signer !== wallet) {
    return new Response(JSON.stringify({ error: "signature does not match wallet" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  // Make sure the signed message includes the nonce (anti-replay)
  if (!message.includes(nonce) || !message.toLowerCase().includes(wallet)) {
    return new Response(JSON.stringify({ error: "message did not include nonce or wallet" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // 3. Mark nonce used
  await fetch(`${SUPABASE_URL}/rest/v1/siwe_nonces?nonce=eq.${nonce}`, {
    method: "PATCH",
    headers: sbHeaders({ Prefer: "return=minimal" }),
    body: JSON.stringify({ used: true }),
  });

  // 4. Provision auth.users via admin API if needed
  const email = syntheticEmail(wallet);
  const password = await derivedPassword(wallet);
  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Try to find existing user
  const { data: list } = await admin.auth.admin.listUsers({ page: 1, perPage: 1 });
  // listUsers can't filter by email reliably; use a direct create-or-ignore approach.
  // Try create — if it errors with already exists, fall through.
  let userId: string | null = null;
  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: {
      auth_method: "wallet",
      wallet_address: wallet,
    },
  });
  if (created?.user) {
    userId = created.user.id;
  } else if (createErr && /already.*registered|exists/i.test(createErr.message || "")) {
    // Look up by email via REST since admin SDK lacks getByEmail
    const lookupRes = await fetch(
      `${SUPABASE_URL}/auth/v1/admin/users?filter=${encodeURIComponent(`email.eq.${email}`)}`,
      { headers: { apikey: SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` } }
    );
    if (lookupRes.ok) {
      const lookupJson = await lookupRes.json();
      const arr = lookupJson?.users || lookupJson || [];
      const found = Array.isArray(arr) ? arr.find((u: any) => (u.email || "").toLowerCase() === email) : null;
      userId = found?.id || null;
    }
  } else if (createErr) {
    return new Response(JSON.stringify({ error: createErr.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // 5. Make sure profile reflects wallet linkage
  if (userId) {
    await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${userId}`, {
      method: "PATCH",
      headers: sbHeaders({ Prefer: "return=minimal" }),
      body: JSON.stringify({
        wallet_address: wallet,
        auth_method: "wallet",
        display_name: `${wallet.slice(0, 6)}…${wallet.slice(-4)}`,
      }),
    }).catch(() => {});
  }

  // 6. Sign in via password grant to mint a session
  const anon = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: signInData, error: signInErr } = await anon.auth.signInWithPassword({ email, password });
  if (signInErr || !signInData?.session) {
    return new Response(JSON.stringify({ error: signInErr?.message || "sign-in failed" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  return new Response(
    JSON.stringify({
      access_token: signInData.session.access_token,
      refresh_token: signInData.session.refresh_token,
      expires_in: signInData.session.expires_in,
      token_type: signInData.session.token_type,
      user: signInData.user,
    }),
    { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
});
