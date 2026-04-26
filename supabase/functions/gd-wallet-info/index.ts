// Public endpoint: for a list of wallet addresses, returns
//   - GoodDollar Identity whitelisted status (KYC)
//   - G$ token balance (formatted)
//   - next-claim entitlement (UBIScheme.checkEntitlement) → if 0, already claimed today
//
// Uses Multicall3 to batch ALL reads into a few RPC calls (massive speedup
// vs per-wallet round-trips). 200 wallets → ~3 RPC requests instead of 600.

import {
  JsonRpcProvider,
  Contract,
  Interface,
  formatUnits,
  getAddress,
} from "https://esm.sh/ethers@6.13.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const CELO_RPC = "https://forno.celo.org";
const IDENTITY_ADDRESS = "0xC361A6E67822a0EDc17D899227dd9FC50BD62F42";
const G$_ADDRESS = "0x62B8B11039FcfE5aB0C56E502b1C372A3d2a9c7A";
const UBI_SCHEME_ADDRESS = "0x43d72Ff17701B2DA814620735C39C620Ce0ea4A1";
// Multicall3 has the same address on virtually every EVM chain incl. Celo
const MULTICALL3_ADDRESS = "0xcA11bde05977b3631167028862bE2a173976CA11";

const MULTICALL3_ABI = [
  "function tryAggregate(bool requireSuccess, tuple(address target, bytes callData)[] calls) returns (tuple(bool success, bytes returnData)[])",
];

// Encoders for each call type
const identityIface = new Interface([
  "function isWhitelisted(address account) view returns (bool)",
]);
const erc20Iface = new Interface([
  "function balanceOf(address) view returns (uint256)",
]);
const ubiIface = new Interface([
  "function checkEntitlement(address member) view returns (uint256)",
]);

const provider = new JsonRpcProvider(CELO_RPC, 42220);
const multicall = new Contract(MULTICALL3_ADDRESS, MULTICALL3_ABI, provider);

const GD_DECIMALS = 18;

// Multicall3 chunk size — keep response size reasonable. With kyc_only mode
// (1 call/wallet) we can pack many more wallets per RPC. Run chunks in parallel.
const WALLETS_PER_MULTICALL_FULL = 60;
const WALLETS_PER_MULTICALL_LIGHT = 180;

type Result = {
  address: string;
  whitelisted: boolean;
  balance: string;
  balanceWei: string;
  entitlement: string;
  canClaim: boolean;
  error?: string;
};

type Call = { target: string; callData: string };
type Mode = "full" | "kyc_only" | "balance_only";

function buildCallsForWallet(addr: string, mode: Mode): Call[] {
  if (mode === "kyc_only") {
    return [
      {
        target: IDENTITY_ADDRESS,
        callData: identityIface.encodeFunctionData("isWhitelisted", [addr]),
      },
    ];
  }
  if (mode === "balance_only") {
    return [
      {
        target: G$_ADDRESS,
        callData: erc20Iface.encodeFunctionData("balanceOf", [addr]),
      },
    ];
  }
  return [
    {
      target: IDENTITY_ADDRESS,
      callData: identityIface.encodeFunctionData("isWhitelisted", [addr]),
    },
    {
      target: G$_ADDRESS,
      callData: erc20Iface.encodeFunctionData("balanceOf", [addr]),
    },
    {
      target: UBI_SCHEME_ADDRESS,
      callData: ubiIface.encodeFunctionData("checkEntitlement", [addr]),
    },
  ];
}

function callsPerWallet(mode: Mode): number {
  return mode === "full" ? 3 : 1;
}

function decodeBool(data: string): boolean {
  try {
    const [v] = identityIface.decodeFunctionResult("isWhitelisted", data);
    return Boolean(v);
  } catch {
    return false;
  }
}
function decodeUint(iface: Interface, fn: string, data: string): bigint {
  try {
    const [v] = iface.decodeFunctionResult(fn, data);
    return BigInt(v);
  } catch {
    return 0n;
  }
}

async function inspectChunk(addresses: string[], mode: Mode): Promise<Result[]> {
  const calls: Call[] = [];
  for (const a of addresses) calls.push(...buildCallsForWallet(a, mode));
  const stride = callsPerWallet(mode);

  let returns: { success: boolean; returnData: string }[] = [];
  try {
    // staticCall — no tx, pure read
    returns = await multicall.tryAggregate.staticCall(false, calls);
  } catch (e: any) {
    // Whole-batch failure → mark all wallets in this chunk as errored
    return addresses.map((a) => ({
      address: a,
      whitelisted: false,
      balance: "0",
      balanceWei: "0",
      entitlement: "0",
      canClaim: false,
      error: (e?.message || String(e)).slice(0, 200),
    }));
  }

  const out: Result[] = [];
  for (let i = 0; i < addresses.length; i++) {
    const base = i * stride;

    let whitelisted = false;
    let balWei = 0n;
    let ent = 0n;

    if (mode === "kyc_only") {
      const wlRet = returns[base];
      whitelisted = wlRet?.success ? decodeBool(wlRet.returnData) : false;
    } else if (mode === "balance_only") {
      const balRet = returns[base];
      balWei = balRet?.success ? decodeUint(erc20Iface, "balanceOf", balRet.returnData) : 0n;
    } else {
      const wlRet = returns[base];
      const balRet = returns[base + 1];
      const entRet = returns[base + 2];
      whitelisted = wlRet?.success ? decodeBool(wlRet.returnData) : false;
      balWei = balRet?.success ? decodeUint(erc20Iface, "balanceOf", balRet.returnData) : 0n;
      ent = entRet?.success ? decodeUint(ubiIface, "checkEntitlement", entRet.returnData) : 0n;
    }

    out.push({
      address: addresses[i],
      whitelisted,
      balance: formatUnits(balWei, GD_DECIMALS),
      balanceWei: String(balWei),
      entitlement: formatUnits(ent, GD_DECIMALS),
      canClaim: whitelisted && ent > 0n,
    });
  }
  return out;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "invalid json" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const rawList: unknown = body?.addresses;
  if (!Array.isArray(rawList) || rawList.length === 0) {
    return new Response(JSON.stringify({ error: "addresses[] required" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  if (rawList.length > 500) {
    return new Response(JSON.stringify({ error: "max 500 addresses per request" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Normalize / dedupe
  const seen = new Set<string>();
  const addresses: string[] = [];
  for (const a of rawList) {
    if (typeof a !== "string") continue;
    try {
      const checksum = getAddress(a.trim());
      const lower = checksum.toLowerCase();
      if (seen.has(lower)) continue;
      seen.add(lower);
      addresses.push(checksum);
    } catch {
      // skip invalid
    }
  }

  if (addresses.length === 0) {
    return new Response(JSON.stringify({ error: "no valid addresses" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Mode: "full" (default) | "kyc_only" | "balance_only"
  const mode: Mode =
    body?.mode === "kyc_only" || body?.mode === "balance_only" ? body.mode : "full";

  // Split into multicall chunks and run them in parallel
  const chunkSize =
    mode === "full" ? WALLETS_PER_MULTICALL_FULL : WALLETS_PER_MULTICALL_LIGHT;
  const chunks: string[][] = [];
  for (let i = 0; i < addresses.length; i += chunkSize) {
    chunks.push(addresses.slice(i, i + chunkSize));
  }
  const settled = await Promise.all(chunks.map((c) => inspectChunk(c, mode)));
  const results: Result[] = settled.flat();

  const now = new Date();
  const nextUtcMidnight = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 0)
  );

  return new Response(
    JSON.stringify({
      checked_at: now.toISOString(),
      next_claim_window_at: nextUtcMidnight.toISOString(),
      results,
    }),
    {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    }
  );
});
