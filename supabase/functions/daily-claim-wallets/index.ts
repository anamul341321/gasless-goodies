// CRUD for the user's saved daily-claim wallets and their claim groups.
// All endpoints require an authenticated user.

import { Wallet } from "npm:ethers@6.13.4";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { encryptKey } from "../_shared/dailyCrypto.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

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

function json(body: any, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const admin = createClient(SUPABASE_URL, SERVICE_KEY);

// Ensure user has at least one group per (network) they're working with.
// Returns the default group id for that network.
async function ensureDefaultGroup(userId: string, network: "celo" | "xdc"): Promise<string> {
  const { data: existing } = await admin
    .from("daily_claim_groups")
    .select("id")
    .eq("owner_user_id", userId)
    .eq("network", network)
    .order("created_at", { ascending: true })
    .limit(1);
  if (existing && existing.length > 0) return existing[0].id as string;
  const { data: inserted, error } = await admin
    .from("daily_claim_groups")
    .insert({
      owner_user_id: userId,
      network,
      name: `Default — ${network.toUpperCase()}`,
      start_hour_bd: 0,
      start_minute_bd: 0,
      retry_wait_minutes: 30,
      enabled: true,
    })
    .select("id")
    .single();
  if (error || !inserted) throw error || new Error("could not create default group");
  return inserted.id as string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const user = await getUser(req);
  if (!user) return json({ error: "unauthorized" }, 401);

  const url = new URL(req.url);
  const action = url.searchParams.get("action") || (req.method === "GET" ? "list" : "");

  try {
    // -------- Wallet list --------
    if (req.method === "GET" || action === "list") {
      const network = url.searchParams.get("network");
      let q = admin
        .from("daily_claim_wallets")
        .select("id, wallet_address, label, is_active, network, group_id, created_at")
        .eq("owner_user_id", user.id);
      if (network === "celo" || network === "xdc") q = q.eq("network", network);
      const { data, error } = await q.order("created_at", { ascending: true });
      if (error) throw error;
      return json({ wallets: data || [] });
    }

    const body = await req.json().catch(() => ({}));

    // -------- Groups --------
    if (action === "list_groups") {
      const { data, error } = await admin
        .from("daily_claim_groups")
        .select("id, name, network, start_hour_bd, start_minute_bd, retry_wait_minutes, enabled, created_at")
        .eq("owner_user_id", user.id)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return json({ groups: data || [] });
    }

    if (action === "create_group") {
      const network: "celo" | "xdc" = body?.network === "xdc" ? "xdc" : "celo";
      const name = String(body?.name || "Group").slice(0, 80);
      const h = Number(body?.start_hour_bd ?? 0);
      const m = Number(body?.start_minute_bd ?? 0);
      const wait = Number(body?.retry_wait_minutes ?? 30);
      const enabled = body?.enabled === false ? false : true;
      if (!Number.isInteger(h) || h < 0 || h > 23) return json({ error: "invalid hour" }, 400);
      if (!Number.isInteger(m) || m < 0 || m > 59) return json({ error: "invalid minute" }, 400);
      if (!Number.isInteger(wait) || wait < 1 || wait > 240) return json({ error: "invalid wait (1-240)" }, 400);
      const { data, error } = await admin
        .from("daily_claim_groups")
        .insert({
          owner_user_id: user.id,
          network, name,
          start_hour_bd: h, start_minute_bd: m,
          retry_wait_minutes: wait, enabled,
        })
        .select("id")
        .single();
      if (error) throw error;
      return json({ id: data?.id });
    }

    if (action === "update_group") {
      const id = body?.id;
      if (!id) return json({ error: "id required" }, 400);
      const patch: any = {};
      if (body?.name !== undefined) patch.name = String(body.name).slice(0, 80);
      if (body?.start_hour_bd !== undefined) {
        const h = Number(body.start_hour_bd);
        if (!Number.isInteger(h) || h < 0 || h > 23) return json({ error: "invalid hour" }, 400);
        patch.start_hour_bd = h;
      }
      if (body?.start_minute_bd !== undefined) {
        const m = Number(body.start_minute_bd);
        if (!Number.isInteger(m) || m < 0 || m > 59) return json({ error: "invalid minute" }, 400);
        patch.start_minute_bd = m;
      }
      if (body?.retry_wait_minutes !== undefined) {
        const w = Number(body.retry_wait_minutes);
        if (!Number.isInteger(w) || w < 1 || w > 240) return json({ error: "invalid wait (1-240)" }, 400);
        patch.retry_wait_minutes = w;
      }
      if (body?.enabled !== undefined) patch.enabled = !!body.enabled;
      patch.updated_at = new Date().toISOString();
      const { error } = await admin
        .from("daily_claim_groups")
        .update(patch).eq("id", id).eq("owner_user_id", user.id);
      if (error) throw error;
      return json({ ok: true });
    }

    if (action === "delete_group") {
      const id = body?.id;
      if (!id) return json({ error: "id required" }, 400);
      // Detach wallets, then delete group
      await admin.from("daily_claim_wallets")
        .update({ group_id: null }).eq("group_id", id).eq("owner_user_id", user.id);
      const { error } = await admin
        .from("daily_claim_groups")
        .delete().eq("id", id).eq("owner_user_id", user.id);
      if (error) throw error;
      return json({ ok: true });
    }

    if (action === "assign_group") {
      // Assign one or many wallets to a group (or null to detach).
      const ids: string[] = Array.isArray(body?.wallet_ids) ? body.wallet_ids : (body?.id ? [body.id] : []);
      const groupId: string | null = body?.group_id || null;
      if (ids.length === 0) return json({ error: "wallet_ids required" }, 400);
      if (groupId) {
        const { data: g } = await admin
          .from("daily_claim_groups")
          .select("id").eq("id", groupId).eq("owner_user_id", user.id).maybeSingle();
        if (!g) return json({ error: "group not found" }, 404);
      }
      const { error } = await admin
        .from("daily_claim_wallets")
        .update({ group_id: groupId })
        .in("id", ids)
        .eq("owner_user_id", user.id);
      if (error) throw error;
      return json({ ok: true, updated: ids.length });
    }

    // -------- Wallet add --------
    if (req.method === "POST" && action === "add") {
      const rawKeys: string[] = Array.isArray(body?.private_keys) ? body.private_keys : [];
      const network: "celo" | "xdc" = body?.network === "xdc" ? "xdc" : "celo";
      let groupId: string | null = body?.group_id || null;
      if (rawKeys.length === 0) return json({ error: "no keys provided" }, 400);
      if (rawKeys.length > 5000) return json({ error: "max 5000 keys per request" }, 400);

      // Validate group ownership if specified, else ensure default
      if (groupId) {
        const { data: g } = await admin
          .from("daily_claim_groups")
          .select("id").eq("id", groupId).eq("owner_user_id", user.id).maybeSingle();
        if (!g) return json({ error: "group not found" }, 404);
      } else {
        groupId = await ensureDefaultGroup(user.id, network);
      }

      const seen = new Set<string>();
      const valid: { address: string; pk: string }[] = [];
      let invalid = 0;
      for (const raw of rawKeys) {
        if (typeof raw !== "string") { invalid++; continue; }
        let pk = raw.trim();
        if (!pk) continue;
        if (!pk.startsWith("0x")) pk = "0x" + pk;
        if (!/^0x[a-fA-F0-9]{64}$/.test(pk)) { invalid++; continue; }
        try {
          const w = new Wallet(pk);
          const addr = w.address.toLowerCase();
          if (seen.has(addr)) continue;
          seen.add(addr);
          valid.push({ address: w.address, pk });
        } catch { invalid++; }
      }
      if (valid.length === 0) return json({ error: "no valid keys", invalid }, 400);

      const rows = await Promise.all(valid.map(async (v) => ({
        owner_user_id: user.id,
        wallet_address: v.address,
        encrypted_key: await encryptKey(v.pk),
        is_active: true,
        network,
        group_id: groupId,
      })));
      const { error } = await admin
        .from("daily_claim_wallets")
        .upsert(rows, { onConflict: "owner_user_id,wallet_address,network", ignoreDuplicates: true });
      if (error) throw error;
      return json({ added: valid.length, invalid, network, group_id: groupId });
    }

    if (req.method === "PATCH" && action === "toggle") {
      const id = body?.id;
      const is_active = !!body?.is_active;
      if (!id) return json({ error: "id required" }, 400);
      const { error } = await admin
        .from("daily_claim_wallets")
        .update({ is_active })
        .eq("id", id)
        .eq("owner_user_id", user.id);
      if (error) throw error;
      return json({ ok: true });
    }

    if (req.method === "DELETE" || action === "delete") {
      const id = body?.id || url.searchParams.get("id");
      const all = body?.all === true;
      const netFilter = body?.network === "celo" || body?.network === "xdc" ? body.network : null;
      const groupFilter = body?.group_id || null;
      if (all) {
        let q = admin.from("daily_claim_wallets").delete().eq("owner_user_id", user.id);
        if (netFilter) q = q.eq("network", netFilter);
        if (groupFilter) q = q.eq("group_id", groupFilter);
        const { error } = await q;
        if (error) throw error;
        return json({ ok: true });
      }
      if (!id) return json({ error: "id required" }, 400);
      const { error } = await admin
        .from("daily_claim_wallets")
        .delete()
        .eq("id", id)
        .eq("owner_user_id", user.id);
      if (error) throw error;
      return json({ ok: true });
    }

    // -------- Legacy settings (kept for back-compat; UI now uses groups) --------
    if (action === "get_settings") {
      const { data, error } = await admin
        .from("daily_claim_settings")
        .select("network, start_hour_bd, start_minute_bd, enabled, retry_wait_minutes")
        .eq("owner_user_id", user.id);
      if (error) throw error;
      return json({ settings: data || [] });
    }

    if (action === "set_settings") {
      const network: "celo" | "xdc" = body?.network === "xdc" ? "xdc" : "celo";
      const h = Number(body?.start_hour_bd);
      const m = Number(body?.start_minute_bd);
      const enabled = body?.enabled === false ? false : true;
      if (!Number.isInteger(h) || h < 0 || h > 23) return json({ error: "invalid hour" }, 400);
      if (!Number.isInteger(m) || m < 0 || m > 59) return json({ error: "invalid minute" }, 400);
      const rawWait = body?.retry_wait_minutes;
      const wait = rawWait === undefined || rawWait === null ? 30 : Number(rawWait);
      if (!Number.isInteger(wait) || wait < 1 || wait > 240) return json({ error: "invalid retry_wait_minutes (1-240)" }, 400);
      const { error } = await admin
        .from("daily_claim_settings")
        .upsert({
          owner_user_id: user.id,
          network,
          start_hour_bd: h,
          start_minute_bd: m,
          enabled,
          retry_wait_minutes: wait,
          updated_at: new Date().toISOString(),
        }, { onConflict: "owner_user_id,network" });
      if (error) throw error;
      return json({ ok: true });
    }

    return json({ error: "unknown action" }, 400);
  } catch (e: any) {
    return json({ error: e?.message || String(e) }, 500);
  }
});
