// Public endpoint: check CELO balance for a list of addresses or private keys.
// Uses Multicall3 (getEthBalance) to batch native CELO balance reads in a
// single RPC per chunk. Massively faster than per-wallet getBalance calls.

import { JsonRpcProvider, Contract, Interface, getAddress, formatEther, Wallet } from "npm:ethers@6.13.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const CELO_RPC = "https://forno.celo.org";
const MULTICALL3_ADDRESS = "0xcA11bde05977b3631167028862bE2a173976CA11";
const MULTICALL3_ABI = [
  "function getEthBalance(address addr) view returns (uint256)",
  "function tryAggregate(bool requireSuccess, tuple(address target, bytes callData)[] calls) view returns (tuple(bool success, bytes returnData)[])",
];

const provider = new JsonRpcProvider(CELO_RPC, 42220, { staticNetwork: true });
const multicall = new Contract(MULTICALL3_ADDRESS, MULTICALL3_ABI, provider);
const mcIface = new Interface(MULTICALL3_ABI);

// Pack many wallets per multicall — single RPC per chunk.
const CHUNK = 250;

type Item = { input: string; address?: string; balance?: string; error?: string };

async function checkChunk(items: Item[]): Promise<void> {
  const valid = items.filter((i) => i.address && !i.error);
  if (valid.length === 0) return;
  const calls = valid.map((i) => ({
    target: MULTICALL3_ADDRESS,
    callData: mcIface.encodeFunctionData("getEthBalance", [i.address!]),
  }));
  try {
    const returns: { success: boolean; returnData: string }[] =
      await multicall.tryAggregate.staticCall(false, calls);
    valid.forEach((i, idx) => {
      const r = returns[idx];
      if (!r || !r.success) { i.error = "rpc error"; return; }
      try {
        const [v] = mcIface.decodeFunctionResult("getEthBalance", r.returnData);
        i.balance = formatEther(BigInt(v));
      } catch {
        i.error = "decode error";
      }
    });
  } catch (e: any) {
    // Fallback: per-wallet getBalance in parallel for this chunk only
    const results = await Promise.all(
      valid.map((i) => provider.getBalance(i.address!).catch(() => null as any))
    );
    valid.forEach((i, idx) => {
      const v = results[idx];
      if (v === null || v === undefined) i.error = (e?.message || "rpc error").slice(0, 120);
      else i.balance = formatEther(v);
    });
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  let body: any;
  try { body = await req.json(); } catch {
    return new Response(JSON.stringify({ error: "invalid json" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const raw: unknown = body?.inputs;
  if (!Array.isArray(raw) || raw.length === 0) {
    return new Response(JSON.stringify({ error: "inputs[] required" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  if (raw.length > 2000) {
    return new Response(JSON.stringify({ error: "max 2000 items per request" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Normalize: detect address vs private key, derive address from key
  const seen = new Set<string>();
  const items: Item[] = [];
  for (const r of raw) {
    if (typeof r !== "string") continue;
    const t = r.trim();
    if (!t) continue;
    const item: Item = { input: t };
    try {
      if (/^0x[a-fA-F0-9]{40}$/.test(t)) {
        item.address = getAddress(t);
      } else if (/^(0x)?[a-fA-F0-9]{64}$/.test(t)) {
        const pk = t.startsWith("0x") ? t : "0x" + t;
        item.address = new Wallet(pk).address;
      } else {
        item.error = "invalid format";
      }
    } catch {
      item.error = "invalid";
    }
    if (item.address) {
      const lower = item.address.toLowerCase();
      if (seen.has(lower)) continue;
      seen.add(lower);
    }
    items.push(item);
  }

  // Chunk and run all multicalls in parallel
  const chunks: Item[][] = [];
  for (let i = 0; i < items.length; i += CHUNK) chunks.push(items.slice(i, i + CHUNK));
  await Promise.all(chunks.map((c) => checkChunk(c)));

  const totalCelo = items.reduce((sum, i) => sum + (i.balance ? Number(i.balance) : 0), 0);
  const okCount = items.filter((i) => i.balance !== undefined).length;
  const errCount = items.filter((i) => i.error).length;

  return new Response(
    JSON.stringify({
      checked_at: new Date().toISOString(),
      total_celo: totalCelo,
      ok: okCount,
      errors: errCount,
      results: items,
    }),
    { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
});
