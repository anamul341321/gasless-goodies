// Past runs for a group (history).
//
// Two modes — kept light so runs with thousands of wallets never time out:
//  - list   : { group_id }            -> run summaries + gas jobs + key counts
//  - detail : { run_id, kind }        -> paginated per-run detail
//             kind = "items" | "failed" | "gas_failed" | "success"

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
    status: s, headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

const PAGE = 1000;

async function pagedItems(runId: string, ownerUserId: string, select: string, apply?: (q: any) => any) {
  const out: any[] = [];
  let from = 0;
  while (true) {
    let q = admin
      .from("daily_claim_run_items")
      .select(select)
      .eq("run_id", runId)
      .eq("owner_user_id", ownerUserId)
      .order("wallet_address", { ascending: true })
      .range(from, from + PAGE - 1);
    if (apply) q = apply(q);
    const { data, error } = await q;
    if (error) throw error;
    const page = (data || []) as any[];
    out.push(...page);
    if (page.length < PAGE) break;
    from += PAGE;
    if (from > 30000) break;
  }
  return out;
}

async function countItems(runId: string, ownerUserId: string, apply?: (q: any) => any) {
  let q = admin
    .from("daily_claim_run_items")
    .select("id", { count: "exact", head: true })
    .eq("run_id", runId)
      .eq("owner_user_id", ownerUserId);
  if (apply) q = apply(q);
  const { count } = await q;
  return count || 0;
}

// A wallet is "gas-failed final" when it never claimed and the last known
// blocker was gas (phase1 or phase2 out of gas).
function applyGasFailed(q: any) {
  return q.eq("final_status", "failed_gas");
}

// Final failures for reasons other than gas or already-claimed.
function applyFailed(q: any) {
  return q.not("final_status", "in", "(success,pending,already_claimed,failed_gas)");
}

async function decryptRows(rows: any[]) {
  const out: any[] = [];
  for (const r of rows) {
    if (!r.encrypted_key) continue;
    try {
      out.push({
        wallet_address: r.wallet_address,
        private_key: await decryptKey(r.encrypted_key),
        status: r.final_status,
        error: r.phase2_error || r.phase1_error || undefined,
        tx_hash: r.phase2_tx || r.phase1_tx || undefined,
      });
    } catch { /* skip */ }
  }
  return out;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const user = await getUser(req);
  if (!user) return json({ error: "unauthorized" }, 401);

  try {
    let groupId = "", runId = "", kind = "";
    let limit = 30;
    if (req.method === "POST") {
      const b = await req.json().catch(() => ({}));
      groupId = b?.group_id || "";
      runId = b?.run_id || "";
      kind = b?.kind || "";
      limit = Math.max(1, Math.min(100, Number(b?.limit) || 30));
    } else {
      const u = new URL(req.url);
      groupId = u.searchParams.get("group_id") || "";
      runId = u.searchParams.get("run_id") || "";
      kind = u.searchParams.get("kind") || "";
      limit = Math.max(1, Math.min(100, Number(u.searchParams.get("limit")) || 30));
    }

    // ---------- Detail mode ----------
    if (runId) {
      const { data: run } = await admin.from("daily_claim_runs")
        .select("id, owner_user_id").eq("id", runId).maybeSingle();
      if (!run || run.owner_user_id !== user.id) return json({ error: "not found" }, 404);

      if (kind === "items") {
        const items = await pagedItems(
          runId, user.id,
          "wallet_address, phase1_status, phase1_tx, phase1_error, gas_request_status, phase2_status, phase2_tx, phase2_error, final_status",
        );
        return json({ items });
      }
      if (kind === "success") {
        const rows = await pagedItems(
          runId, user.id,
          "wallet_address, final_status, phase1_tx, phase2_tx, phase1_error, phase2_error, encrypted_key",
          (q) => q.eq("final_status", "success").not("encrypted_key", "is", null),
        );
        return json({ success_keys: await decryptRows(rows) });
      }
      if (kind === "already") {
        const rows = await pagedItems(
          runId, user.id,
          "wallet_address, final_status, phase1_tx, phase2_tx, phase1_error, phase2_error, encrypted_key",
          (q) => q.eq("final_status", "already_claimed").not("encrypted_key", "is", null),
        );
        return json({ already_keys: await decryptRows(rows) });
      }
      if (kind === "gas_failed") {
        const rows = await pagedItems(
          runId, user.id,
          "wallet_address, final_status, phase1_status, phase2_status, phase1_tx, phase2_tx, phase1_error, phase2_error, encrypted_key",
          (q) => applyGasFailed(q.not("encrypted_key", "is", null)),
        );
        return json({ gas_failed_keys: await decryptRows(rows) });
      }
      // default: failed
      const rows = await pagedItems(
        runId, user.id,
        "wallet_address, final_status, phase1_tx, phase2_tx, phase1_error, phase2_error, encrypted_key",
        (q) => applyFailed(q.not("encrypted_key", "is", null)),
      );
      return json({ failed_keys: await decryptRows(rows) });
    }

    // ---------- List mode ----------
    if (!groupId) return json({ error: "group_id required" }, 400);

    const { data: g } = await admin.from("daily_claim_groups")
      .select("id, owner_user_id, name, network")
      .eq("id", groupId).maybeSingle();
    if (!g || g.owner_user_id !== user.id) return json({ error: "not found" }, 404);

    const { data: runs } = await admin.from("daily_claim_runs")
      .select("*").eq("group_id", groupId).eq("owner_user_id", user.id)
      .order("run_date", { ascending: false })
      .order("started_at", { ascending: false })
      .limit(limit);

    const batchNames = (runs || []).map((r: any) =>
      `daily-claim-${r.network || g.network || "celo"}-${String(r.id).slice(0, 8)}`
    );
    const gasJobsByBatch = new Map<string, any[]>();
    if (batchNames.length > 0) {
      const { data: gjobs } = await admin.from("gas_load_jobs")
        .select("id, batch_name, total, done, failed, status, created_at, finished_at")
        .in("batch_name", batchNames)
        .eq("owner_user_id", user.id)
        .order("created_at", { ascending: true });
      for (const j of gjobs || []) {
        gasJobsByBatch.set(j.batch_name, [...(gasJobsByBatch.get(j.batch_name) || []), j]);
      }
    }

    const result = await Promise.all((runs || []).map(async (r: any) => {
      const batchName = `daily-claim-${r.network || g.network || "celo"}-${String(r.id).slice(0, 8)}`;
      const [successCount, alreadyCount, failedKeyCount, gasFailedKeyCount, gasDone, gasReq, gasErr] = await Promise.all([
        countItems(r.id, user.id, (q) => q.eq("final_status", "success").not("encrypted_key", "is", null)),
        countItems(r.id, user.id, (q) => q.eq("final_status", "already_claimed").not("encrypted_key", "is", null)),
        countItems(r.id, user.id, (q) => applyFailed(q.not("encrypted_key", "is", null))),
        countItems(r.id, user.id, (q) => applyGasFailed(q.not("encrypted_key", "is", null))),
        countItems(r.id, user.id, (q) => q.eq("gas_request_status", "done")),
        countItems(r.id, user.id, (q) => q.eq("gas_request_status", "requested")),
        countItems(r.id, user.id, (q) => q.eq("gas_request_status", "error")),
      ]);
      return {
        ...r,
        success_key_count: successCount,
        already_key_count: alreadyCount,
        failed_key_count: failedKeyCount,
        gas_failed_key_count: gasFailedKeyCount,
        gas_summary: { done: gasDone, requested: gasReq, error: gasErr, total: gasDone + gasReq + gasErr },
        gas_jobs: gasJobsByBatch.get(batchName) || [],
      };
    }));

    return json({ group: { id: g.id, name: g.name, network: g.network }, runs: result });
  } catch (e: any) {
    return json({ error: e?.message || String(e) }, 500);
  }
});
