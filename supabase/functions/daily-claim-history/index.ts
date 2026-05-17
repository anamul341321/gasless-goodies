// Returns past runs for a single group (history). Each run includes summary
// counts, per-wallet items, and decrypted failed keys for the owner.

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
    let groupId = "";
    let limit = 30;
    if (req.method === "POST") {
      const b = await req.json().catch(() => ({}));
      groupId = b?.group_id || "";
      limit = Math.max(1, Math.min(100, Number(b?.limit) || 30));
    } else {
      const u = new URL(req.url);
      groupId = u.searchParams.get("group_id") || "";
      limit = Math.max(1, Math.min(100, Number(u.searchParams.get("limit")) || 30));
    }
    if (!groupId) return json({ error: "group_id required" }, 400);

    // Verify ownership
    const { data: g } = await admin.from("daily_claim_groups")
      .select("id, owner_user_id, name, network")
      .eq("id", groupId).maybeSingle();
    if (!g || g.owner_user_id !== user.id) return json({ error: "not found" }, 404);

    const { data: runs } = await admin.from("daily_claim_runs")
      .select("*").eq("group_id", groupId)
      .order("run_date", { ascending: false })
      .order("started_at", { ascending: false })
      .limit(limit);

    const runIds = (runs || []).map((r: any) => r.id);
    const itemsByRun = new Map<string, any[]>();
    if (runIds.length > 0) {
      const { data: items } = await admin.from("daily_claim_run_items")
        .select("run_id, wallet_address, phase1_status, phase1_error, gas_request_status, phase2_status, phase2_error, final_status, encrypted_key")
        .in("run_id", runIds);
      for (const it of items || []) {
        const arr = itemsByRun.get(it.run_id) || [];
        arr.push(it);
        itemsByRun.set(it.run_id, arr);
      }
    }

    const result = [];
    for (const r of runs || []) {
      const its = itemsByRun.get(r.id) || [];
      const failed_keys: any[] = [];
      for (const it of its) {
        if (it.encrypted_key && it.final_status !== "success" && it.final_status !== "pending") {
          try {
            const pk = await decryptKey(it.encrypted_key);
            failed_keys.push({
              wallet_address: it.wallet_address,
              private_key: pk,
              status: it.final_status,
              error: it.phase2_error || it.phase1_error || undefined,
            });
          } catch { /* skip */ }
        }
      }
      const safeItems = its.map(({ encrypted_key, ...rest }: any) => rest);
      result.push({ ...r, items: safeItems, failed_keys });
    }

    return json({ group: { id: g.id, name: g.name, network: g.network }, runs: result });
  } catch (e: any) {
    return json({ error: e?.message || String(e) }, 500);
  }
});
