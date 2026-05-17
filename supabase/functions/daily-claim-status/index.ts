// Returns the user's groups (each with its schedule, wallet count, today's run,
// items, and failed-key reveals), plus aggregate wallet counts per network.

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

async function summarizeRun(runId: string) {
  const { data: rows } = await admin
    .from("daily_claim_run_items")
    .select("wallet_address, phase1_status, phase1_error, gas_request_status, phase2_status, phase2_error, final_status, encrypted_key")
    .eq("run_id", runId)
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
    // Wallets (for counts and per-group counts)
    const { data: walletRows } = await admin
      .from("daily_claim_wallets")
      .select("network, is_active, group_id")
      .eq("owner_user_id", user.id);
    const walletCounts: Record<string, number> = { celo: 0, xdc: 0 };
    const perGroupCount = new Map<string, number>();
    for (const w of walletRows || []) {
      if (!w.is_active) continue;
      const net = w.network || "celo";
      walletCounts[net] = (walletCounts[net] || 0) + 1;
      if (w.group_id) perGroupCount.set(w.group_id, (perGroupCount.get(w.group_id) || 0) + 1);
    }

    // Groups
    const { data: groups } = await admin
      .from("daily_claim_groups")
      .select("id, name, network, start_hour_bd, start_minute_bd, retry_wait_minutes, enabled, created_at")
      .eq("owner_user_id", user.id)
      .order("created_at", { ascending: true });

    // Latest run per group (today or most recent)
    const groupIds = (groups || []).map((g: any) => g.id);
    const runByGroup = new Map<string, any>();
    if (groupIds.length > 0) {
      const { data: runs } = await admin
        .from("daily_claim_runs")
        .select("*")
        .in("group_id", groupIds)
        .order("run_date", { ascending: false })
        .order("started_at", { ascending: false })
        .limit(500);
      for (const r of runs || []) {
        const gid = r.group_id;
        if (gid && !runByGroup.has(gid)) runByGroup.set(gid, r);
      }
    }

    const groupResults = [];
    for (const g of groups || []) {
      const run = runByGroup.get(g.id) || null;
      let items: any[] = [];
      let failed_keys: any[] = [];
      if (run) {
        const s = await summarizeRun(run.id);
        items = s.items;
        failed_keys = s.failed_keys;
      }
      groupResults.push({
        ...g,
        wallet_count: perGroupCount.get(g.id) || 0,
        run, items, failed_keys,
      });
    }

    return json({
      wallet_counts: walletCounts,
      groups: groupResults,
      server_time: new Date().toISOString(),
    });
  } catch (e: any) {
    return json({ error: e?.message || String(e) }, 500);
  }
});
