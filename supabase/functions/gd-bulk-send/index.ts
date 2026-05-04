// Bulk-send G$ on Celo using the Disperse contract.
// G$ is fee-on-transfer, so use direct transferFrom batches instead of the
// pooled Disperse path that can run short on large recipient lists.
// Stateless: receives sender private key + recipients, returns tx hashes.

import { ethers } from "https://esm.sh/ethers@6.13.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Multiple RPCs for fallback when one is down (503, etc.)
const CELO_RPCS = [
  "https://forno.celo.org",
  "https://rpc.ankr.com/celo",
  "https://1rpc.io/celo",
  "https://celo.drpc.org",
];

async function getWorkingProvider(): Promise<ethers.JsonRpcProvider> {
  let lastErr: any = null;
  for (const url of CELO_RPCS) {
    try {
      const p = new ethers.JsonRpcProvider(url, 42220, { staticNetwork: true });
      // Quick health check
      await p.getBlockNumber();
      return p;
    } catch (e) {
      lastErr = e;
      console.log(`RPC ${url} failed: ${e?.message || e}`);
    }
  }
  throw new Error(`All Celo RPCs unavailable: ${lastErr?.message || lastErr}`);
}
const GD_TOKEN = "0x62B8B11039FcfE5aB0C56E502b1C372A3d2a9c7A"; // G$ on Celo
const DISPERSE = "0xD152f549545093347A162Dce210e7293f1452150"; // disperse.app
const MAX_PER_TX = 75;

const ERC20_ABI = [
  "function allowance(address,address) view returns (uint256)",
  "function approve(address,uint256) returns (bool)",
  "function balanceOf(address) view returns (uint256)",
  "function decimals() view returns (uint8)",
];
const DISPERSE_ABI = [
  "function disperseTokenSimple(address token, address[] recipients, uint256[] values)",
];

type Result = {
  ok: boolean;
  batches: { tx?: string; recipients: number; error?: string }[];
  approve_tx?: string;
  total_sent: string;
  recipient_count: number;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const body = await req.json();
    let senderKeyRaw = String(body?.sender_key || "").trim();
    // Auto-prepend 0x if missing
    if (/^[a-fA-F0-9]{64}$/.test(senderKeyRaw)) {
      senderKeyRaw = "0x" + senderKeyRaw;
    }
    const recipientsRaw: string[] = Array.isArray(body?.recipients) ? body.recipients : [];
    const amountStr = String(body?.amount || "0.5").trim();

    if (!/^0x[a-fA-F0-9]{64}$/.test(senderKeyRaw)) {
      return json({ error: "Invalid sender private key" }, 400);
    }
    const amountNum = Number(amountStr);
    if (!Number.isFinite(amountNum) || amountNum <= 0) {
      return json({ error: "Invalid amount" }, 400);
    }

    // Normalize / dedupe recipients
    const seen = new Set<string>();
    const recipients: string[] = [];
    for (const r of recipientsRaw) {
      const s = String(r || "").trim().toLowerCase();
      if (!/^0x[a-f0-9]{40}$/.test(s)) continue;
      if (seen.has(s)) continue;
      seen.add(s);
      recipients.push(ethers.getAddress(s));
    }
    if (recipients.length === 0) return json({ error: "No valid recipients" }, 400);
    if (recipients.length > 5000) return json({ error: "Max 5000 recipients per request" }, 400);

    const provider = await getWorkingProvider();
    const wallet = new ethers.Wallet(senderKeyRaw, provider);
    const token = new ethers.Contract(GD_TOKEN, ERC20_ABI, wallet);
    const disperse = new ethers.Contract(DISPERSE, DISPERSE_ABI, wallet);

    const decimals: number = Number(await token.decimals());
    const perRecipient = ethers.parseUnits(amountStr, decimals);
    const totalNeeded = perRecipient * BigInt(recipients.length);

    // Balance check. disperseTokenSimple calls transferFrom(sender -> recipient)
    // for each recipient, which works with G$ fee-on-transfer behavior. The
    // recipient may receive slightly less after the protocol fee, but the sender
    // only needs the nominal sent amount.
    const gdBalance: bigint = await token.balanceOf(wallet.address);
    if (gdBalance < totalNeeded) {
      return json({
        error: `Insufficient G$ — need ${ethers.formatUnits(totalNeeded, decimals)}, have ${ethers.formatUnits(gdBalance, decimals)}`,
      }, 400);
    }

    const celoBalance = await provider.getBalance(wallet.address);
    if (celoBalance < ethers.parseEther("0.005")) {
      return json({
        error: `Insufficient CELO for gas — need at least 0.005, have ${ethers.formatEther(celoBalance)}`,
      }, 400);
    }

    const result: Result = {
      ok: true,
      batches: [],
      total_sent: "0",
      recipient_count: recipients.length,
    };

    // Approve once if needed — let ethers/RPC pick gas price automatically
    const allowance: bigint = await token.allowance(wallet.address, DISPERSE);
    if (allowance < totalNeeded) {
      const approveTx = await token.approve(DISPERSE, ethers.MaxUint256);
      result.approve_tx = approveTx.hash;
      await approveTx.wait();
    }

    // Chunk and send
    let sentTotal = 0n;
    for (let i = 0; i < recipients.length; i += MAX_PER_TX) {
      const chunk = recipients.slice(i, i + MAX_PER_TX);
      const values = chunk.map(() => perRecipient);
      try {
        const est = await disperse.disperseToken.estimateGas(GD_TOKEN, chunk, values);
        const gasLimit = (est * 125n) / 100n;
        const tx = await disperse.disperseToken(GD_TOKEN, chunk, values, { gasLimit });
        await tx.wait();
        result.batches.push({ tx: tx.hash, recipients: chunk.length });
        sentTotal += perRecipient * BigInt(chunk.length);
      } catch (e: any) {
        result.ok = false;
        result.batches.push({
          recipients: chunk.length,
          error: e?.shortMessage || e?.message || String(e),
        });
        // Stop on first failure — likely OOG / out of CELO / out of G$
        break;
      }
    }
    result.total_sent = ethers.formatUnits(sentTotal, decimals);

    return json(result);
  } catch (e: any) {
    return json({ error: e?.shortMessage || e?.message || String(e) }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
