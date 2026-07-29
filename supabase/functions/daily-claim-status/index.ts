// Returns the user's groups (schedule, wallet count, today's run summary).
//
// Two modes:
//  - light (default): counts only — safe to poll every few seconds even with
//    thousands of wallets. No per-item rows, no key decryption.
//  - detail: pass { detail_group_id } to get the per-wallet rows and the
//    decrypted failed keys for a SINGLE group (loaded on demand by the UI).

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

async function countFailedKeys(runId: string) {
  const { count } = await admin
    .from("daily_claim_run_items")
    .select("id", { count: "exact", head: true })
    .eq("run_id", runId)
    .not("encrypted_key", "is", null)
    .not("final_status", "in", "(success,pending)");
  return count || 0;
}

// Per-status breakdown so the UI can show a clear, human reason for every
// wallet instead of lumping everything into a single "other" bucket.
const BREAKDOWN_STATUSES = [
  "success",
  "already_claimed",
  "failed_kyc",
  "failed_gas",
  "failed_other",
  "pending",
] as const;

async function breakdownForRun(runId: string) {
  const out: Record<string, number> = {};
  await Promise.all(
    BREAKDOWN_STATUSES.map(async (s) => {
      const { count } = await admin
        .from("daily_claim_run_items")
        .select("id", { count: "exact", head: true })
        .eq("run_id", runId)
        .eq("final_status", s);
      out[s] = count || 0;
    }),
  );
  // Wallets still pending but already known to be out of gas.
  const { count: gasPending } = await admin
    .from("daily_claim_run_items")
    .select("id", { count: "exact", head: true })
    .eq("run_id", runId)
    .eq("final_status", "pending")
    .eq("phase1_status", "failed_gas");
  out.pending_gas = gasPending || 0;
  out.pending_other = Math.max(0, (out.pending || 0) - (gasPending || 0));
  return out;
}


async function detailForRun(runId: string) {
  const items: any[] = [];
  const PAGE = 1000;
  let from = 0;
  while (true) {
    const { data: rows } = await admin
      .from("daily_claim_run_items")
      .select("owner_user_id, network, wallet_address, phase1_status, phase1_tx, phase1_error, gas_request_status, phase2_status, phase2_tx, phase2_error, final_status, encrypted_key")
      .eq("run_id", runId)
      .order("wallet_address", { ascending: true })
      .range(from, from + PAGE - 1);
    const page = rows || [];
    items.push(...page);
    if (page.length < PAGE) break;
    from += PAGE;
  }

  const failedKeys: { wallet_address: string; private_key: string; status: string; error?: string }[] = [];
  const successKeys: { wallet_address: string; private_key: string; status: string; tx_hash?: string }[] = [];
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
  const successful = items.filter((r: any) => r.final_status === "success");
  const savedKeyByWallet = new Map<string, string>();
  const missingSaved = successful.filter((r: any) => !r.encrypted_key && r.owner_user_id && r.network);
  const grouped = new Map<string, any[]>();
  for (const r of missingSaved) {
    const key = `${r.owner_user_id}:${r.network}`;
    const list = grouped.get(key) || [];
    list.push(r);
    grouped.set(key, list);
  }
  for (const [key, rows] of grouped.entries()) {
    const [ownerUserId, network] = key.split(":");
    const wallets = rows.map((r: any) => r.wallet_address).filter(Boolean);
    for (let i = 0; i < wallets.length; i += 500) {
      const { data: saved } = await admin
        .from("daily_claim_wallets")
        .select("wallet_address, encrypted_key")
        .eq("owner_user_id", ownerUserId)
        .eq("network", network)
        .in("wallet_address", wallets.slice(i, i + 500));
      for (const s of saved || []) {
        if (s.encrypted_key) savedKeyByWallet.set(String(s.wallet_address).toLowerCase(), s.encrypted_key);
      }
    }
  }

  for (const r of successful as any[]) {
    const encrypted = r.encrypted_key || savedKeyByWallet.get(String(r.wallet_address || "").toLowerCase());
    if (!encrypted) continue;
    try {
      const pk = await decryptKey(encrypted);
      successKeys.push({
        wallet_address: r.wallet_address,
        private_key: pk,
        status: "success",
        tx_hash: r.phase2_tx || r.phase1_tx || undefined,
      });
    } catch { /* skip */ }
  }

  const safeItems = items.map(({ encrypted_key, owner_user_id, network, ...rest }: any) => rest);
  return { items: safeItems, failed_keys: failedKeys, success_keys: successKeys };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const user = await getUser(req);
  if (!user) return json({ error: "unauthorized" }, 401);

  const body = await req.json().catch(() => ({}));
  const detailGroupId: string | null = body?.detail_group_id || null;

  try {
    // ---- Detail mode: one group only ----
    if (detailGroupId) {
      const { data: g } = await admin
        .from("daily_claim_groups")
        .select("id")
        .eq("id", detailGroupId)
        .eq("owner_user_id", user.id)
        .maybeSingle();
      if (!g) return json({ error: "group not found" }, 404);
      const { data: run } = await admin
        .from("daily_claim_runs")
        .select("id")
        .eq("group_id", detailGroupId)
        .order("run_date", { ascending: false })
        .order("started_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!run) return json({ items: [], failed_keys: [] });
      const d = await detailForRun(run.id);
      return json(d);
    }

    // ---- Light mode ----
    const walletCounts: Record<string, number> = { celo: 0, xdc: 0 };
    const perGroupCount = new Map<string, number>();
    const PAGE = 1000;
    let from = 0;
    while (true) {
      const { data: page, error: pErr } = await admin
        .from("daily_claim_wallets")
        .select("network, is_active, group_id")
        .eq("owner_user_id", user.id)
        .range(from, from + PAGE - 1);
      if (pErr) throw pErr;
      const rows = page || [];
      for (const w of rows) {
        if (!w.is_active) continue;
        const net = w.network || "celo";
        walletCounts[net] = (walletCounts[net] || 0) + 1;
        if (w.group_id) perGroupCount.set(w.group_id, (perGroupCount.get(w.group_id) || 0) + 1);
      }
      if (rows.length < PAGE) break;
      from += PAGE;
    }

    const { data: groups } = await admin
      .from("daily_claim_groups")
      .select("id, name, network, start_hour_bd, start_minute_bd, retry_wait_minutes, enabled, created_at")
      .eq("owner_user_id", user.id)
      .order("created_at", { ascending: true });

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
      groupResults.push({
        ...g,
        wallet_count: perGroupCount.get(g.id) || 0,
        run,
        failed_key_count: run ? await countFailedKeys(run.id) : 0,
        breakdown: run ? await breakdownForRun(run.id) : null,

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
