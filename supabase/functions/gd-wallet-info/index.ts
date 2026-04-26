// Public endpoint: for a list of wallet addresses, returns
//   - GoodDollar Identity whitelisted status (KYC)
//   - G$ token balance (formatted)
//   - next-claim entitlement (UBIScheme.checkEntitlement) → if 0, already claimed today
// All RPC calls are made server-side (Forno) and batched in parallel.

import { JsonRpcProvider, Contract, formatUnits, getAddress } from "https://esm.sh/ethers@6.13.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const CELO_RPC = "https://forno.celo.org";
const IDENTITY_ADDRESS = "0xC361A6E67822a0EDc17D899227dd9FC50BD62F42";
const G$_ADDRESS = "0x62B8B11039FcfE5aB0C56E502b1C372A3d2a9c7A";
const UBI_SCHEME_ADDRESS = "0x43d72Ff17701B2DA814620735C39C620Ce0ea4A1";

const IDENTITY_ABI = [
  "function isWhitelisted(address account) view returns (bool)",
  "function lastAuthenticated(address account) view returns (uint256)",
];
const ERC20_ABI = ["function balanceOf(address) view returns (uint256)"];
const UBI_ABI = [
  "function checkEntitlement(address member) view returns (uint256)",
  "function periodStart() view returns (uint256)",
  "function currentDay() view returns (uint256)",
];

const provider = new JsonRpcProvider(CELO_RPC, 42220);
const identity = new Contract(IDENTITY_ADDRESS, IDENTITY_ABI, provider);
const gd = new Contract(G$_ADDRESS, ERC20_ABI, provider);
const ubi = new Contract(UBI_SCHEME_ADDRESS, UBI_ABI, provider);

// G$ has 18 decimals on Celo (ERC20 wrapper)
const GD_DECIMALS = 18;

type Result = {
  address: string;
  whitelisted: boolean;
  balance: string;          // formatted G$
  balanceWei: string;       // raw
  entitlement: string;      // formatted G$ amount claimable now ("0" if already claimed)
  canClaim: boolean;        // entitlement > 0 AND whitelisted
  error?: string;
};

async function inspectWallet(addr: string): Promise<Result> {
  const out: Result = {
    address: addr,
    whitelisted: false,
    balance: "0",
    balanceWei: "0",
    entitlement: "0",
    canClaim: false,
  };
  try {
    const [wl, bal, ent] = await Promise.all([
      identity.isWhitelisted(addr).catch(() => false),
      gd.balanceOf(addr).catch(() => 0n),
      ubi.checkEntitlement(addr).catch(() => 0n),
    ]);
    out.whitelisted = Boolean(wl);
    out.balanceWei = String(bal);
    out.balance = formatUnits(bal as bigint, GD_DECIMALS);
    out.entitlement = formatUnits(ent as bigint, GD_DECIMALS);
    out.canClaim = out.whitelisted && (ent as bigint) > 0n;
  } catch (e: any) {
    out.error = (e?.message || String(e)).slice(0, 200);
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
  if (rawList.length > 200) {
    return new Response(JSON.stringify({ error: "max 200 addresses per request" }), {
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

  // Process in chunks of 25 to avoid hammering RPC
  const CHUNK = 25;
  const results: Result[] = [];
  for (let i = 0; i < addresses.length; i += CHUNK) {
    const slice = addresses.slice(i, i + CHUNK);
    const part = await Promise.all(slice.map((a) => inspectWallet(a)));
    results.push(...part);
  }

  // GoodDollar UBI cycle is 1 calendar day in UTC. Next-claim time for an
  // already-claimed wallet is the next UTC midnight (approx).
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
