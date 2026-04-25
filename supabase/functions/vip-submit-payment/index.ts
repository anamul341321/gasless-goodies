// Submit a USDT payment TX hash → auto-verify on Celo → activate membership.
// Falls back to manual review if auto-verify can't confirm yet.
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RECEIVER = (Deno.env.get("CELO_RECEIVER_ADDRESS") || "").toLowerCase().trim();

const CELO_RPC = "https://forno.celo.org";
const USDT_CELO = "0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e".toLowerCase();
const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const MIN_CONFIRMATIONS = 3;

// Pricing economics — must match frontend (src/pages/Vip.tsx)
const GAS_PER_WALLET_PER_DAY_CELO = 0.032;
const FALLBACK_CELO_USD = 0.30;
const PRICE_TOLERANCE = 0.10; // accept on-chain amount within 10% of expected (CELO price drift)

const MAX_DISCOUNT = 0.40;
const tierDiscount = (slots: number): number => {
  if (slots >= 500) return 0.20;
  if (slots >= 400) return 0.18;
  if (slots >= 300) return 0.15;
  return 0.12;
};
const durationDiscount = (m: number): number => {
  if (m >= 4) return 0.20;
  if (m >= 3) return 0.15;
  if (m >= 2) return 0.12;
  return 0.05;
};
const combinedDiscount = (slots: number, m: number): number =>
  Math.min(MAX_DISCOUNT, tierDiscount(slots) + durationDiscount(m));

async function fetchCeloUsd(): Promise<number> {
  try {
    const r = await fetch(
      "https://api.coingecko.com/api/v3/simple/price?ids=celo&vs_currencies=usd",
      { headers: { Accept: "application/json" } },
    );
    if (!r.ok) throw new Error(`coingecko ${r.status}`);
    const j = await r.json();
    const p = Number(j?.celo?.usd);
    if (!isFinite(p) || p <= 0) throw new Error("invalid price");
    return p;
  } catch (e) {
    console.warn("celo price fetch failed, using fallback", (e as Error).message);
    return FALLBACK_CELO_USD;
  }
}

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

async function rpc(method: string, params: any[]) {
  const r = await fetch(CELO_RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const j = await r.json();
  if (j.error) throw new Error(j.error.message || "RPC error");
  return j.result;
}

function topicToAddress(topic: string): string {
  // 32-byte topic → last 20 bytes
  return ("0x" + topic.slice(-40)).toLowerCase();
}

function hexToBigInt(hex: string): bigint {
  return BigInt(hex);
}

async function verifyOnChain(txHash: string, expectedUsdt: number) {
  // 1. Get receipt
  const receipt = await rpc("eth_getTransactionReceipt", [txHash]);
  if (!receipt) return { ok: false, reason: "tx not found yet (try again in a minute)" };
  if (receipt.status !== "0x1") return { ok: false, reason: "tx failed on-chain" };

  // 2. Confirmations
  const latest = await rpc("eth_blockNumber", []);
  const txBlock = hexToBigInt(receipt.blockNumber);
  const latestBlock = hexToBigInt(latest);
  const confs = Number(latestBlock - txBlock) + 1;
  if (confs < MIN_CONFIRMATIONS) {
    return {
      ok: false,
      reason: `only ${confs} confirmations, need ${MIN_CONFIRMATIONS}`,
      pending: true,
      confirmations: confs,
      block: Number(txBlock),
    };
  }

  // 3. Find USDT Transfer log to receiver
  const logs = receipt.logs as Array<{ address: string; topics: string[]; data: string }>;
  let matched: { from: string; to: string; value: bigint } | null = null;
  for (const log of logs) {
    if (log.address.toLowerCase() !== USDT_CELO) continue;
    if (!log.topics || log.topics[0] !== TRANSFER_TOPIC) continue;
    const from = topicToAddress(log.topics[1]);
    const to = topicToAddress(log.topics[2]);
    if (to !== RECEIVER) continue;
    const value = hexToBigInt(log.data);
    matched = { from, to, value };
    break;
  }

  if (!matched) {
    return { ok: false, reason: `no USDT transfer to ${RECEIVER} found in this tx` };
  }

  // USDT on Celo has 6 decimals
  const sentUsdt = Number(matched.value) / 1e6;
  // Allow ±10% tolerance to absorb live CELO price drift between quote and tx confirmation
  const minAcceptable = expectedUsdt * (1 - PRICE_TOLERANCE);
  if (sentUsdt + 0.001 < minAcceptable) {
    return {
      ok: false,
      reason: `amount too low: sent ${sentUsdt.toFixed(2)} USDT, expected ~${expectedUsdt.toFixed(2)} (min ${minAcceptable.toFixed(2)})`,
      from: matched.from,
      amount: sentUsdt,
    };
  }

  return {
    ok: true,
    from: matched.from,
    amount: sentUsdt,
    confirmations: confs,
    block: Number(txBlock),
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "POST only" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (!RECEIVER || !/^0x[a-f0-9]{40}$/i.test(RECEIVER)) {
    return new Response(
      JSON.stringify({ error: "Receiver address not configured. Contact admin." }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  let body: any;
  try { body = await req.json(); } catch {
    return new Response(JSON.stringify({ error: "invalid json" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const userWallet = String(body?.user_wallet || "").trim();
  const packageId = String(body?.package_id || "").trim();
  const txHash = String(body?.tx_hash || "").trim().toLowerCase();
  const monthsRaw = Number(body?.months ?? 1);
  const months = Math.max(1, Math.min(4, Math.floor(monthsRaw)));

  if (!/^0x[a-fA-F0-9]{40}$/.test(userWallet)) {
    return new Response(JSON.stringify({ error: "Invalid wallet address" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  if (!/^0x[a-f0-9]{64}$/.test(txHash)) {
    return new Response(JSON.stringify({ error: "Invalid TX hash format" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  if (!packageId) {
    return new Response(JSON.stringify({ error: "package_id required" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Look up package
  const pkgRes = await sb(`/rest/v1/vip_packages?id=eq.${packageId}&select=*`);
  const pkgs = await pkgRes.json();
  if (!Array.isArray(pkgs) || !pkgs[0]) {
    return new Response(JSON.stringify({ error: "Unknown package" }), {
      status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  const pkg = pkgs[0];

  // Compute total = realGas × months × (1 - combinedDiscount)
  // tier (10/15/20%) + duration (0/10/15/20%), capped at 40%
  const celoUsd = await fetchCeloUsd();
  const slots = Number(pkg.wallet_slots) || 0;
  const tier = tierDiscount(slots);
  const dur = durationDiscount(months);
  const finalOff = combinedDiscount(slots, months);
  const monthlyGasUsd = GAS_PER_WALLET_PER_DAY_CELO * 30 * slots * celoUsd;
  const realTotal = monthlyGasUsd * months;
  const totalPrice = Math.round(realTotal * (1 - finalOff) * 100) / 100;
  const totalDays = Number(pkg.duration_days) * months;

  // Reject duplicate tx_hash
  const dupRes = await sb(`/rest/v1/membership_payments?tx_hash=eq.${txHash}&select=id,status`);
  const dups = await dupRes.json();
  if (Array.isArray(dups) && dups[0]) {
    return new Response(
      JSON.stringify({ error: "This TX hash is already submitted", existing_status: dups[0].status }),
      { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  // Try on-chain verify against discounted total
  let verify;
  try {
    verify = await verifyOnChain(txHash, totalPrice);
  } catch (e) {
    verify = { ok: false, reason: `RPC error: ${(e as Error).message}` };
  }

  // Insert payment record
  const paymentBody: any = {
    user_wallet: userWallet,
    package_id: packageId,
    tx_hash: txHash,
    expected_amount: totalPrice,
    admin_note: `${months}mo · ${slots} wallets · CELO $${celoUsd.toFixed(4)} · real $${realTotal.toFixed(2)} · tier +${(tier*100).toFixed(0)}% + duration +${(dur*100).toFixed(0)}% = −${(finalOff*100).toFixed(0)}% · total $${totalPrice.toFixed(2)}`,
  };

  if (verify.ok) {
    paymentBody.status = "verified";
    paymentBody.verification_method = "auto";
    paymentBody.from_address = (verify as any).from;
    paymentBody.amount_usdt = (verify as any).amount;
    paymentBody.bsc_block_number = (verify as any).block;
    paymentBody.bsc_confirmations = (verify as any).confirmations;
  } else {
    paymentBody.status = "manual_review";
    paymentBody.verification_method = "auto_failed";
    paymentBody.admin_note = `${paymentBody.admin_note} | ${(verify as any).reason || "auto-verify failed"}`;
    if ((verify as any).pending) {
      paymentBody.bsc_confirmations = (verify as any).confirmations;
    }
  }

  const payRes = await sb("/rest/v1/membership_payments", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify(paymentBody),
  });
  if (!payRes.ok) {
    const t = await payRes.text();
    return new Response(JSON.stringify({ error: "Failed to record payment", detail: t }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  const payRow = (await payRes.json())[0];

  if (verify.ok) {
    // Activate membership
    const now = new Date();
    const expires = new Date(now.getTime() + totalDays * 86400000);
    const memRes = await sb("/rest/v1/user_memberships", {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({
        user_wallet: userWallet,
        package_id: packageId,
        status: "active",
        starts_at: now.toISOString(),
        expires_at: expires.toISOString(),
        payment_id: payRow.id,
      }),
    });
    if (!memRes.ok) {
      const t = await memRes.text();
      return new Response(JSON.stringify({ error: "Payment OK but membership activation failed", detail: t }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const mem = (await memRes.json())[0];
    return new Response(
      JSON.stringify({
        ok: true,
        status: "verified",
        membership: mem,
        payment: payRow,
        message: "Payment verified! Your membership is active.",
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  return new Response(
    JSON.stringify({
      ok: true,
      status: "manual_review",
      payment: payRow,
      reason: (verify as any).reason,
      pending_chain: !!(verify as any).pending,
      message: (verify as any).pending
        ? "Transaction is pending on-chain. We'll auto-confirm shortly. Check back in a few minutes."
        : "We couldn't auto-verify this payment. Admin will review and approve manually within 24 hours.",
    }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});
