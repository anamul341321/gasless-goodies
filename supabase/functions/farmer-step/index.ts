// Single iteration of the G$ Faucet Farmer.
// 1. Verifies caller JWT and decodes user_id.
// 2. Creates a brand new wallet.
// 3. Sends a fixed amount of G$ from the user-supplied funder key to the new wallet.
// 4. Calls the GoodDollar faucet (topWallet) for the new wallet.
// 5. Records the row in farmer_wallets.

import { Wallet, JsonRpcProvider, Contract, parseUnits } from "npm:ethers@6.13.4";
import { createClient } from "npm:@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const PROXY_USER = Deno.env.get("WEBSHARE_PROXY_USERNAME") || "";
const PROXY_PASS = Deno.env.get("WEBSHARE_PROXY_PASSWORD") || "";

const CELO_RPC = "https://forno.celo.org";
const G_DOLLAR_ADDRESS = "0x62B8B11039FcfE5aB0C56E502b1C372A3d2a9c7A"; // G$ on Celo (18 decimals)
const G_DOLLAR_ABI = [
  "function transfer(address to, uint256 amount) returns (bool)",
  "function balanceOf(address owner) view returns (uint256)",
  "function decimals() view returns (uint8)",
];
const GD_FAUCET_URL = "https://goodserver.gooddollar.org/verify/topWallet";
const FAUCET_SETTLE_WAIT_MS = 60_000;
const FAUCET_RETRY_WAIT_MS = 15_000;
const FAUCET_MAX_ATTEMPTS = 3;

const provider = new JsonRpcProvider(CELO_RPC, 42220);

function buildProxyUrl(): string | null {
  if (!PROXY_USER || !PROXY_PASS) return null;
  // Webshare rotating residential
  return `http://${encodeURIComponent(PROXY_USER)}:${encodeURIComponent(
    PROXY_PASS
  )}@p.webshare.io:80`;
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function shouldRetryFaucet(error?: string) {
  const text = (error || "").toLowerCase();
  return (
    text.includes("not whitelisted") ||
    text.includes("whitelist") ||
    text.includes("timeout") ||
    text.includes("network") ||
    text.includes("fetch") ||
    text.includes("429") ||
    text.includes("5")
  );
}

async function callFaucet(account: string): Promise<{
  ok: boolean;
  txHash?: string;
  error?: string;
  ip?: string;
}> {
  const ac = new AbortController();
  const timeout = setTimeout(() => ac.abort(), 35_000);
  const proxyUrl = buildProxyUrl();
  // @ts-ignore Deno API
  const createHttp = (Deno as any).createHttpClient;
  let client: any = null;
  if (proxyUrl && typeof createHttp === "function") {
    try {
      client = createHttp({ proxy: { url: proxyUrl } });
    } catch (_) {
      client = null;
    }
  }
  const opts = (extra: RequestInit = {}): RequestInit => ({
    ...extra,
    // @ts-ignore
    ...(client ? { client } : {}),
    signal: ac.signal,
  });

  let ip: string | undefined;
  try {
    const ipRes = await fetch("https://api.ipify.org?format=json", opts());
    if (ipRes.ok) ip = (await ipRes.json()).ip;
  } catch (_) {}

  try {
    const res = await fetch(
      GD_FAUCET_URL,
      opts({
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          "User-Agent":
            "Mozilla/5.0 (Linux; Android 13; SM-A536B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36",
          Origin: "https://wallet.gooddollar.org",
          Referer: "https://wallet.gooddollar.org/",
        },
        body: JSON.stringify({ account }),
      })
    );
    const text = await res.text();
    let body: any = null;
    try { body = JSON.parse(text); } catch { body = { raw: text }; }
    if (!res.ok) {
      return {
        ok: false, ip,
        error: body?.error || body?.message || `HTTP ${res.status}: ${text.slice(0, 160)}`,
      };
    }
    const txHash =
      body?.hash || body?.transactionHash || body?.txHash ||
      body?.result?.transactionHash || body?.result?.hash || null;
    if (!txHash && (body?.ok === false || body?.error)) {
      return {
        ok: false, ip,
        error: body?.error || body?.message || `faucet rejected: ${text.slice(0, 160)}`,
      };
    }
    return { ok: true, ip, txHash: txHash || undefined };
  } catch (e: any) {
    return { ok: false, ip, error: e?.message || String(e) };
  } finally {
    clearTimeout(timeout);
    try { client?.close?.(); } catch (_) {}
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "method not allowed" }), {
      status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Auth — must be a logged-in user
  const authHeader = req.headers.get("Authorization") || "";
  const token = authHeader.replace(/^Bearer\s+/i, "");
  if (!token) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data: userRes, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userRes?.user) {
    return new Response(JSON.stringify({ error: "invalid session" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  const userId = userRes.user.id;

  let body: any;
  try { body = await req.json(); } catch {
    return new Response(JSON.stringify({ error: "invalid json" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const funderKey: string = typeof body?.funder_key === "string" ? body.funder_key.trim() : "";
  const gAmountStr: string = typeof body?.g_amount === "string" || typeof body?.g_amount === "number"
    ? String(body.g_amount) : "0.5";

  if (!/^0x[a-fA-F0-9]{64}$/.test(funderKey)) {
    return new Response(JSON.stringify({ error: "funder_key must be 0x + 64 hex chars" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  let gAmountWei: bigint;
  try {
    gAmountWei = parseUnits(gAmountStr, 18);
    if (gAmountWei <= 0n) throw new Error("amount must be > 0");
  } catch (e: any) {
    return new Response(JSON.stringify({ error: `invalid g_amount: ${e?.message || e}` }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // 1. New wallet
  const newWallet = Wallet.createRandom();
  const newAddress = newWallet.address;
  const newPrivKey = newWallet.privateKey;

  // 2. Send G$ from funder
  let gdTxHash: string | null = null;
  let gdStatus = "failed";
  let gdError: string | null = null;
  try {
    const funderSigner = new Wallet(funderKey, provider);
    const gd = new Contract(G_DOLLAR_ADDRESS, G_DOLLAR_ABI, funderSigner);
    const tx = await gd.transfer(newAddress, gAmountWei);
    gdTxHash = tx.hash;
    gdStatus = "submitted";
    // Wait for inclusion (1 confirmation) so the new wallet really has G$
    try {
      const rcpt = await tx.wait(1);
      gdStatus = rcpt && rcpt.status === 1 ? "success" : "failed";
    } catch (e: any) {
      gdStatus = "submitted"; // tx is in mempool; treat as best-effort
      gdError = e?.message || String(e);
    }
  } catch (e: any) {
    gdError = e?.shortMessage || e?.message || String(e);
  }

  // 3. Faucet request from new wallet
  let faucetTx: string | null = null;
  let faucetStatus = "failed";
  let faucetError: string | null = null;
  let faucetIp: string | null = null;
  if (gdStatus === "success" || gdStatus === "submitted") {
    // Give GoodDollar's backend/indexer a short window to see the fresh G$ balance.
    await wait(3000);
    const r = await callFaucet(newAddress);
    faucetIp = r.ip || null;
    if (r.ok) {
      faucetStatus = "success";
      faucetTx = r.txHash || null;
    } else {
      faucetError = r.error || "unknown error";
    }
  } else {
    faucetError = "skipped — G$ transfer failed";
    faucetStatus = "skipped";
  }

  // 4. Save row
  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const { error: insErr } = await admin.from("farmer_wallets").insert({
    owner_user_id: userId,
    wallet_address: newAddress,
    private_key: newPrivKey,
    gd_tx_hash: gdTxHash,
    gd_status: gdStatus,
    gd_error: gdError,
    faucet_tx_hash: faucetTx,
    faucet_status: faucetStatus,
    faucet_error: faucetError,
    faucet_ip: faucetIp,
  });
  if (insErr) {
    return new Response(JSON.stringify({
      error: "db insert failed", detail: insErr.message,
      wallet_address: newAddress, private_key: newPrivKey,
    }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  return new Response(JSON.stringify({
    ok: true,
    wallet_address: newAddress,
    private_key: newPrivKey,
    gd: { status: gdStatus, tx: gdTxHash, error: gdError },
    faucet: { status: faucetStatus, tx: faucetTx, ip: faucetIp, error: faucetError },
  }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
});
