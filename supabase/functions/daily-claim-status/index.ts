// Returns the user's saved-wallet count, today's run summary (per network),
// and items (failed wallets include their decrypted private key for the owner only).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { decryptKey } from "../_shared/dailyCrypto.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const admin = createClient(SUPABASE_URL, SERVICE_KEY);

async function getUser(req: Request): Promise<{ id: string } | null> {
  const auth = req.headers.get("Authorization");
  if (!auth) return null;
  const token = auth.replace(/^Bearer\s+/i, "");
  if (!token || token === SUPABASE_ANON_KEY) return null;
  const supa = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data, error } = await supa.auth.getUser();
  if (error || !data?.user) return null;
  return { id: data.user.id };
}

function json(b: any, s = 200) {
  return new Response(JSON.stringify(b), {
    status: s, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function summarizeRun(run: any) {
  const { data: rows } = await admin
    .from("daily_claim_run_items")
    .select("wallet_address, phase1_status, phase1_error, gas_request_status, phase2_status, phase2_error, final_status, encrypted_key")
    .eq("run_id", run.id)
    .order("wallet_address", { ascending: true });
  const items = rows || [];
  const failedKeys: { wallet_address: string; private_key: string; status: string; error?: string }[] = [];
  const failed = items.filter((r: any) =>
    r.encrypted_key && r.final_status !== "success" && r.final_status !== "pending"
  );
  for (const r of failed as any[]) {
    try {
      const pk = await decryptKey(r.encrypted_key);
      failedKeys.push({
        wallet_address: r.wallet_address,
        private_key: pk,
        status: r.final_status,
        error: r.phase2_error || r.phase1_error || undefined,
      });
    } catch { /* skip */ }
  }
  const safeItems = items.map(({ encrypted_key, ...rest }: any) => rest);
  return { items: safeItems, failed_keys: failedKeys };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const user = await getUser(req);
  if (!user) return json({ error: "unauthorized" }, 401);

  try {
    // Wallet counts per network
    const { data: walletRows } = await admin
      .from("daily_claim_wallets")
      .select("network, is_active")
      .eq("owner_user_id", user.id);
    const walletCounts: Record<string, number> = { celo: 0, xdc: 0 };
    for (const w of walletRows || []) {
      if (w.is_active) walletCounts[w.network || "celo"] = (walletCounts[w.network || "celo"] || 0) + 1;
    }

    // Latest run per network
    const { data: runs } = await admin
      .from("daily_claim_runs")
      .select("*")
      .eq("owner_user_id", user.id)
      .order("run_date", { ascending: false })
      .limit(20);

    const latestByNet: Record<string, any> = {};
    for (const r of runs || []) {
      const net = r.network || "celo";
      if (!latestByNet[net]) latestByNet[net] = r;
    }

    const results: Record<string, any> = {};
    for (const net of ["celo", "xdc"]) {
      const r = latestByNet[net];
      if (r) {
        const detail = await summarizeRun(r);
        results[net] = { run: r, ...detail };
      } else {
        results[net] = { run: null, items: [], failed_keys: [] };
      }
    }

    return json({
      wallet_counts: walletCounts,
      networks: results,
      server_time: new Date().toISOString(),
    });
  } catch (e: any) {
    return json({ error: e?.message || String(e) }, 500);
  }
});
