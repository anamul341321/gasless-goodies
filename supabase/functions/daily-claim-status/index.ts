// Returns the user's saved-wallet count, today's run summary, and items
// (failed wallets include their decrypted private key for the owner only).

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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const user = await getUser(req);
  if (!user) return json({ error: "unauthorized" }, 401);

  try {
    const { count: walletCount } = await admin
      .from("daily_claim_wallets")
      .select("id", { count: "exact", head: true })
      .eq("owner_user_id", user.id)
      .eq("is_active", true);

    // Latest run (any date)
    const { data: runs } = await admin
      .from("daily_claim_runs")
      .select("*")
      .eq("owner_user_id", user.id)
      .order("run_date", { ascending: false })
      .limit(1);
    const run = runs && runs[0] ? runs[0] : null;

    let items: any[] = [];
    let failedKeys: { wallet_address: string; private_key: string; status: string; error?: string }[] = [];
    let progress = { phase1_done: 0, gas_requested: 0, retried: 0 };

    if (run) {
      const { data: rows } = await admin
        .from("daily_claim_run_items")
        .select("wallet_address, phase1_status, phase1_error, gas_request_status, phase2_status, phase2_error, final_status, encrypted_key")
        .eq("run_id", run.id)
        .order("wallet_address", { ascending: true });
      items = rows || [];
      for (const r of items) {
        if (r.phase1_status && r.phase1_status !== "pending" && r.phase1_status !== "claiming") progress.phase1_done++;
        if (r.gas_request_status === "done" || r.gas_request_status === "skipped" || r.gas_request_status === "error") progress.gas_requested++;
        if (r.phase2_status && r.phase2_status !== "pending" && r.phase2_status !== "claiming") progress.retried++;
      }
      // Decrypt failed keys
      const failed = items.filter((r) =>
        r.encrypted_key && r.final_status !== "success" && r.final_status !== "pending"
      );
      for (const r of failed) {
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
    }

    // Hide encrypted_key from items
    const safeItems = items.map(({ encrypted_key, ...rest }) => rest);

    return json({
      wallet_count: walletCount || 0,
      run,
      items: safeItems,
      progress,
      failed_keys: failedKeys,
      server_time: new Date().toISOString(),
    });
  } catch (e: any) {
    return json({ error: e?.message || String(e) }, 500);
  }
});
