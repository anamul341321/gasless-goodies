// Issues a one-time nonce for SIWE (Sign-In With Ethereum) login.
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

function randomNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
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
  if (!/^0x[a-f0-9]{40}$/.test(wallet)) {
    return new Response(JSON.stringify({ error: "invalid wallet_address" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const nonce = randomNonce();
  const ins = await fetch(`${SUPABASE_URL}/rest/v1/siwe_nonces`, {
    method: "POST",
    headers: sbHeaders({ Prefer: "return=minimal" }),
    body: JSON.stringify({ nonce, wallet_address: wallet }),
  });
  if (!ins.ok) {
    return new Response(JSON.stringify({ error: "failed to issue nonce" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const message = `Sign in to Celo Gas Sponsor

Wallet: ${wallet}
Nonce: ${nonce}
Issued: ${new Date().toISOString()}

This signature does not authorize any transaction.`;

  return new Response(JSON.stringify({ nonce, message }), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
