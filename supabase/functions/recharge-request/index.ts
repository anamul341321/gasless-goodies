import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { ethers } from "https://esm.sh/ethers@6.13.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

const CELO_RPC = "https://forno.celo.org";
const USD_TO_BDT = 120;

// Token configs on Celo
const TOKENS: Record<string, { address: string | null; decimals: number; coingeckoId?: string; usdPeg?: boolean }> = {
  "CELO": { address: null, decimals: 18, coingeckoId: "celo" },
  "USDT": { address: "0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e", decimals: 6, usdPeg: true },
  "USDC": { address: "0xcebA9300f2b948710d2653dD7B07f33A8B32118C", decimals: 6, usdPeg: true },
};

const ERC20_TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

// Fetch token prices in BDT
async function getTokenPrices(): Promise<Record<string, number>> {
  const prices: Record<string, number> = {
    "USDT": USD_TO_BDT,
    "USDC": USD_TO_BDT,
  };

  try {
    const resp = await fetch(
      "https://api.coingecko.com/api/v3/simple/price?ids=celo&vs_currencies=bdt,usd",
      { headers: { accept: "application/json" } }
    );
    if (resp.ok) {
      const data = await resp.json();
      if (data?.celo?.bdt) prices["CELO"] = data.celo.bdt;
      else if (data?.celo?.usd) prices["CELO"] = data.celo.usd * USD_TO_BDT;
    }
  } catch {}

  if (!prices["CELO"]) prices["CELO"] = 450;

  return prices;
}

// Get deposit address from sponsor key
function getDepositAddress(): string | null {
  const key = Deno.env.get("SPONSOR_PRIVATE_KEY");
  if (!key) return null;
  try {
    const wallet = new ethers.Wallet(key);
    return wallet.address;
  } catch {
    return null;
  }
}

// Verify on-chain transaction
async function verifyTransaction(
  txHash: string,
  expectedToken: string,
  depositAddress: string,
  expectedAmountBdt: number,
  tokenPriceBdt: number
): Promise<{ valid: boolean; message: string }> {
  try {
    const provider = new ethers.JsonRpcProvider(CELO_RPC);
    const receipt = await provider.getTransactionReceipt(txHash);
    if (!receipt || receipt.status !== 1) {
      return { valid: false, message: "Transaction failed or not found" };
    }

    const tokenConfig = TOKENS[expectedToken];
    if (!tokenConfig) return { valid: false, message: "Unknown token" };

    const depositAddr = depositAddress.toLowerCase();

    if (expectedToken === "CELO") {
      // Native CELO transfer
      const tx = await provider.getTransaction(txHash);
      if (!tx) return { valid: false, message: "Transaction not found" };
      if (tx.to?.toLowerCase() !== depositAddr) {
        return { valid: false, message: "Wrong recipient" };
      }
      const sentAmount = Number(ethers.formatEther(tx.value));
      const sentBdt = sentAmount * tokenPriceBdt;
      // Allow 5% slippage
      if (sentBdt < expectedAmountBdt * 0.95) {
        return { valid: false, message: `Insufficient amount: sent ${sentBdt.toFixed(2)}৳ expected ${expectedAmountBdt}৳` };
      }
      return { valid: true, message: "Verified" };
    } else {
      // ERC20 transfer - check Transfer event
      const tokenAddr = tokenConfig.address!.toLowerCase();
      for (const log of receipt.logs) {
        if (log.address.toLowerCase() === tokenAddr && log.topics[0] === ERC20_TRANSFER_TOPIC) {
          const to = "0x" + log.topics[2].slice(26);
          if (to.toLowerCase() === depositAddr) {
            const rawAmount = BigInt(log.data);
            const amount = Number(rawAmount) / Math.pow(10, tokenConfig.decimals);
            const sentBdt = amount * tokenPriceBdt;
            if (sentBdt < expectedAmountBdt * 0.95) {
              return { valid: false, message: `Insufficient: sent ${sentBdt.toFixed(2)}৳ expected ${expectedAmountBdt}৳` };
            }
            return { valid: true, message: "Verified" };
          }
        }
      }
      return { valid: false, message: "No valid transfer found in transaction" };
    }
  } catch (e: any) {
    return { valid: false, message: e?.message || "Verification error" };
  }
}

// SuccessTopUp API - Recharge
async function processRecharge(phone: string, operator: string, amountBdt: number): Promise<{ success: boolean; message: string }> {
  const apiKey = Deno.env.get("SUCCESSTOPUP_API_KEY");
  const apiSecret = Deno.env.get("SUCCESSTOPUP_API_SECRET");
  if (!apiKey || !apiSecret) return { success: false, message: "manual_mode" };

  const operatorMap: Record<string, string> = {
    grameenphone: "GP", robi: "RB", banglalink: "BL",
    airtel: "AT", teletalk: "TT", skitto: "SK",
  };
  const opCode = operatorMap[operator] || operator.toUpperCase();
  const trxId = `halp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  try {
    const resp = await fetch("https://api.successtopup.com/api/recharge", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        number: phone, amount: amountBdt, type: "prepaid",
        operator: opCode, trxid: trxId,
        successtopup_key: apiKey, successtopup_secret: apiSecret,
      }),
    });
    const data = await resp.json();
    return data.result === true
      ? { success: true, message: data.message || "Recharge successful" }
      : { success: false, message: data.message || "Recharge failed" };
  } catch (e: any) {
    return { success: false, message: e?.message || "API connection error" };
  }
}

// SuccessTopUp API - Bill Payment
async function processBillPayment(billOperator: string, billNumber: string, billAmount: number, mobileNumber: string, monthName: string): Promise<{ success: boolean; message: string }> {
  const apiKey = Deno.env.get("SUCCESSTOPUP_API_KEY");
  const apiSecret = Deno.env.get("SUCCESSTOPUP_API_SECRET");
  if (!apiKey || !apiSecret) return { success: false, message: "manual_mode" };

  const trxId = `halp_bill_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  try {
    const resp = await fetch("https://api.successtopup.com/api/bill-pay", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        billOperator, billNumber, billAmount, mobileNumber, monthName,
        trxid: trxId, successtopup_key: apiKey, successtopup_secret: apiSecret,
      }),
    });
    const data = await resp.json();
    return data.result === true
      ? { success: true, message: data.message || "Bill payment successful" }
      : { success: false, message: data.message || "Bill payment failed" };
  } catch (e: any) {
    return { success: false, message: e?.message || "API connection error" };
  }
}


Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, serviceRoleKey);
  const adminPassword = Deno.env.get("ADMIN_PASSWORD");
  const json = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  // GET endpoints
  if (req.method === "GET") {
    const url = new URL(req.url);
    const action = url.searchParams.get("action");

    if (action === "price") {
      const prices = await getTokenPrices();
      return json({ prices });
    }

    if (action === "config") {
      const depositAddress = getDepositAddress();
      const prices = await getTokenPrices();
      return json({
        deposit_address: depositAddress,
        prices,
        tokens: Object.entries(TOKENS).map(([symbol, t]) => ({
          symbol, address: t.address, decimals: t.decimals,
        })),
        min_bdt: 20,
      });
    }

    return json({ error: "Invalid action" }, 400);
  }

  // POST endpoints
  if (req.method === "POST") {
    try {
      const body = await req.json();

      // Price action via POST
      if (body.action === "price") {
        const prices = await getTokenPrices();
        return json({ prices });
      }

      // Config action via POST
      if (body.action === "config") {
        const depositAddress = getDepositAddress();
        const prices = await getTokenPrices();
        return json({
          deposit_address: depositAddress,
          prices,
          tokens: Object.entries(TOKENS).map(([symbol, t]) => ({
            symbol, address: t.address, decimals: t.decimals,
          })),
          min_bdt: 20,
        });
      }

      if (body.action === "admin") {
        if (!adminPassword) return json({ error: "Admin password not configured" }, 500);
        if (body.password !== adminPassword) return json({ error: "Unauthorized" }, 401);
        const { data } = await supabase.from("recharge_requests").select("*").order("created_at", { ascending: false }).limit(100);
        return json(data || []);
      }



      if (body.action === "drives") {
        const apiKey = Deno.env.get("SUCCESSTOPUP_API_KEY");
        const apiSecret = Deno.env.get("SUCCESSTOPUP_API_SECRET");
        if (!apiKey || !apiSecret) return json({ error: "API not configured" }, 500);
        try {
          const resp = await fetch("https://api.successtopup.com/api/drives", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              operator: body.operator || "",
              type: body.drive_type || "",
              successtopup_key: apiKey,
              successtopup_secret: apiSecret,
            }),
          });
          const data = await resp.json();
          return json(data);
        } catch (e: any) {
          return json({ error: e?.message || "Failed to fetch drives" }, 500);
        }
      }

      // Balance check action via POST
      if (body.action === "balance") {
        const apiKey = Deno.env.get("SUCCESSTOPUP_API_KEY");
        const apiSecret = Deno.env.get("SUCCESSTOPUP_API_SECRET");
        if (!apiKey || !apiSecret) return json({ error: "API not configured" }, 500);
        try {
          const resp = await fetch("https://api.successtopup.com/api/balance", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              successtopup_key: apiKey,
              successtopup_secret: apiSecret,
            }),
          });
          const data = await resp.json();
          return json(data);
        } catch (e: any) {
          return json({ error: e?.message || "Failed to fetch balance" }, 500);
        }
      }

      const requestType = body.type || "recharge";
      const txHash = body.tx_hash;
      const payToken = body.pay_token || "USDT";

      // Validate tx_hash
      if (!txHash || !/^0x[a-fA-F0-9]{64}$/.test(txHash)) {
        return json({ error: "Valid transaction hash required. Please complete payment first." }, 400);
      }

      const depositAddress = getDepositAddress();
      if (!depositAddress) return json({ error: "Payment system not configured" }, 500);

      const prices = await getTokenPrices();
      const tokenPrice = prices[payToken];
      if (!tokenPrice) return json({ error: "Unknown payment token" }, 400);

      // Gaming top-up (Free Fire diamonds etc.)
      if (requestType === "gaming") {
        const { player_id, server_id, game, diamonds, amount_bdt } = body;
        if (!player_id || !game || !diamonds) {
          return json({ error: "Missing gaming top-up fields" }, 400);
        }
        const bdtAmount = Number(amount_bdt);
        if (!bdtAmount || bdtAmount < 20) return json({ error: "Invalid amount" }, 400);

        const verification = await verifyTransaction(txHash, payToken, depositAddress, bdtAmount, tokenPrice);
        if (!verification.valid) {
          return json({ error: `Payment verification failed: ${verification.message}` }, 400);
        }

        await supabase.from("recharge_requests").insert({
          phone_number: player_id, operator: `game_${game}`,
          amount_gd: String(body.amount_token || "0"), amount_bdt: bdtAmount,
          network: "gaming", wallet_address: body.wallet_address || "unknown",
          tx_hash: txHash, status: "completed",
          admin_note: `${game} top-up: ${diamonds} diamonds | Player: ${player_id} | Server: ${server_id || "N/A"}`,
        });

        return json({ success: true, instant: true, message: `${diamonds} diamonds top-up successful! 💎` });
      }

      // Bill payment
      if (requestType === "bill") {
        const { billOperator, billNumber, billAmount, mobileNumber, monthName, amount_bdt } = body;
        if (!billOperator || !billNumber || !billAmount || !mobileNumber || !monthName) {
          return json({ error: "Missing bill payment fields" }, 400);
        }

        const bdtAmount = Number(amount_bdt || billAmount);

        // Verify transaction
        const verification = await verifyTransaction(txHash, payToken, depositAddress, bdtAmount, tokenPrice);
        if (!verification.valid) {
          return json({ error: `Payment verification failed: ${verification.message}` }, 400);
        }

        const cleanPhone = String(mobileNumber).replace(/\D/g, "");
        const result = await processBillPayment(billOperator, billNumber, Number(billAmount), cleanPhone, monthName);

        const status = result.success ? "completed" : "pending";
        const adminNote = result.success ? "Auto-paid via SuccessTopUp" : result.message === "manual_mode" ? "Manual fulfillment required" : `API: ${result.message}`;

        await supabase.from("recharge_requests").insert({
          phone_number: cleanPhone, operator: `bill_${billOperator}`,
          amount_gd: String(body.amount_token || "0"), amount_bdt: bdtAmount,
          network: "bill", wallet_address: body.wallet_address || "unknown",
          tx_hash: txHash, status, admin_note: adminNote,
        });

        return json({ success: true, instant: result.success, message: result.success ? "Bill payment successful!" : "Request submitted for processing." });
      }

      // Recharge / Data pack
      const { phone_number, operator, amount_bdt } = body;

      if (!phone_number || !/^01[3-9]\d{8}$/.test(String(phone_number).replace(/\D/g, ""))) {
        return json({ error: "Invalid Bangladesh phone number" }, 400);
      }

      const validOperators = ["grameenphone", "robi", "banglalink", "airtel", "teletalk", "skitto"];
      if (!operator || !validOperators.includes(operator.toLowerCase())) {
        return json({ error: "Invalid operator" }, 400);
      }

      if (!amount_bdt || Number(amount_bdt) < 20) {
        return json({ error: "Minimum amount is 20৳" }, 400);
      }

      const bdtAmount = Number(amount_bdt);

      // Verify transaction
      const verification = await verifyTransaction(txHash, payToken, depositAddress, bdtAmount, tokenPrice);
      if (!verification.valid) {
        return json({ error: `Payment verification failed: ${verification.message}` }, 400);
      }

      const cleanPhone = String(phone_number).replace(/\D/g, "");
      const rechargeResult = await processRecharge(cleanPhone, operator.toLowerCase(), bdtAmount);

      const status = rechargeResult.success ? "completed" : "pending";
      const isInsufficientBalance = rechargeResult.message?.toLowerCase().includes("insufficient");
      const adminNote = rechargeResult.success
        ? "Auto-recharged via SuccessTopUp"
        : isInsufficientBalance
          ? "API balance low — needs top-up"
          : rechargeResult.message === "manual_mode"
            ? "Manual fulfillment required"
            : `API: ${rechargeResult.message}`;

      await supabase.from("recharge_requests").insert({
        phone_number: cleanPhone, operator: operator.toLowerCase(),
        amount_gd: String(body.amount_token || "0"), amount_bdt: bdtAmount,
        network: requestType === "drives" ? "drive" : "recharge",
        wallet_address: body.wallet_address || "unknown",
        tx_hash: txHash, status, admin_note: adminNote,
      });

      return json({
        success: true, instant: rechargeResult.success,
        message: rechargeResult.success ? "Recharge successful!" : "Payment received! Recharge processing.",
      });

    } catch (e) {
      return json({ error: "Invalid request body" }, 400);
    }
  }

  return new Response("Method not allowed", { status: 405, headers: corsHeaders });
});
