// Sweep native CELO from many wallets to a single receiver.
// Sequential to keep node-side rate friendly. Each wallet:
//   balance - (gas_estimate * gas_price * 1.2)  → transfer to receiver.

import { Wallet, JsonRpcProvider, formatEther } from "npm:ethers@6.13.4";
import { createClient } from "npm:@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const CELO_RPC = "https://forno.celo.org";

const provider = new JsonRpcProvider(CELO_RPC, 42220);

type Result = {
  wallet: string;
  ok: boolean;
  tx?: string;
  amount?: string;
  error?: string;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "method not allowed" }), {
      status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Require login
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
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

  let body: any;
  try { body = await req.json(); } catch {
    return new Response(JSON.stringify({ error: "invalid json" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const keys: string[] = Array.isArray(body?.keys) ? body.keys : [];
  const receiver: string = typeof body?.receiver === "string" ? body.receiver.trim() : "";

  if (!/^0x[a-fA-F0-9]{40}$/.test(receiver)) {
    return new Response(JSON.stringify({ error: "invalid receiver address" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Validate + dedupe keys
  const seen = new Set<string>();
  const validKeys: string[] = [];
  for (const k of keys) {
    if (typeof k !== "string") continue;
    const t = k.trim();
    if (!/^0x[a-fA-F0-9]{64}$/.test(t)) continue;
    if (seen.has(t.toLowerCase())) continue;
    seen.add(t.toLowerCase());
    validKeys.push(t);
  }
  if (validKeys.length === 0) {
    return new Response(JSON.stringify({ error: "no valid private keys provided" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  if (validKeys.length > 10000) {
    return new Response(JSON.stringify({ error: "max 10000 keys per request" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const fee = await provider.getFeeData();
  const gasPrice = (fee.gasPrice ?? fee.maxFeePerGas ?? 25_000_000_000n) as bigint;
  const GAS_LIMIT = 21000n;
  // 20% buffer to absorb fee fluctuations
  const reserve = (gasPrice * GAS_LIMIT * 120n) / 100n;

  const results: Result[] = [];
  let totalSwept = 0n;

  // Process in parallel chunks of 50 (each wallet has its own nonce — safe)
  const CHUNK = 50;
  const sweepOne = async (key: string): Promise<Result> => {
    let address = "";
    try {
      const wallet = new Wallet(key, provider);
      address = wallet.address;
      const bal = await provider.getBalance(address);
      if (bal <= reserve) {
        return { wallet: address, ok: false, error: "balance too low to cover gas" };
      }
      const value = bal - reserve;
      const tx = await wallet.sendTransaction({
        to: receiver,
        value,
        gasLimit: GAS_LIMIT,
        gasPrice,
      });
      totalSwept += value;
      return { wallet: address, ok: true, tx: tx.hash, amount: formatEther(value) };
    } catch (e: any) {
      return {
        wallet: address || "unknown",
        ok: false,
        error: e?.shortMessage || e?.message || String(e),
      };
    }
  };

  for (let i = 0; i < validKeys.length; i += CHUNK) {
    const slice = validKeys.slice(i, i + CHUNK);
    const part = await Promise.all(slice.map(sweepOne));
    results.push(...part);
  }

  return new Response(JSON.stringify({
    ok: true,
    receiver,
    total_wallets: validKeys.length,
    success: results.filter(r => r.ok).length,
    failed: results.filter(r => !r.ok).length,
    total_swept_celo: formatEther(totalSwept),
    results,
  }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
});
