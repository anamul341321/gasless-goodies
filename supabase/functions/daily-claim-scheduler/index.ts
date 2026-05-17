// Runs every minute via pg_cron. Two responsibilities:
//  1) When a claim group's scheduled BD time fires (within a 10-minute window),
//     create today's run for that group and kick the worker (phase: claiming).
//  2) Resume runs in phase 'waiting_30m' whose group's retry_wait_minutes has
//     elapsed → phase 'retrying'.
//
// Each user can define unlimited groups; each group has its own wallets,
// start time, and retry wait. Uniqueness key for "today's run" is
// (group_id, run_date).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const admin = createClient(SUPABASE_URL, SERVICE_KEY);

const WORKER_URL = `${SUPABASE_URL}/functions/v1/daily-claim-worker`;

async function kickWorker(runId: string, phase: string) {
  fetch(WORKER_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${SERVICE_KEY}`,
      apikey: SERVICE_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ run_id: runId, phase }),
  }).catch(() => {});
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const now = new Date();
  const utcNowMin = now.getUTCHours() * 60 + now.getUTCMinutes();
  // Bangladesh = UTC + 6
  const bdNow = new Date(now.getTime() + 6 * 60 * 60_000);
  const today = bdNow.toISOString().slice(0, 10);

  let started = 0;
  let resumed = 0;

  try {
    // 1) Fire each enabled group whose target time hit within the last 10 min.
    const { data: groups, error: gErr } = await admin
      .from("daily_claim_groups")
      .select("id, owner_user_id, network, start_hour_bd, start_minute_bd, enabled")
      .eq("enabled", true);
    if (gErr) console.error("groups fetch err", gErr);
    console.log(`scheduler tick: utcNowMin=${utcNowMin} today=${today} groups=${(groups||[]).length}`);

    for (const g of groups || []) {
      const targetUtcMin = (((g.start_hour_bd as number) * 60 + (g.start_minute_bd as number)) - 360 + 1440) % 1440;
      let diff = utcNowMin - targetUtcMin;
      if (diff < 0) diff += 1440;
      console.log(`  group ${g.id} ${g.start_hour_bd}:${g.start_minute_bd} target=${targetUtcMin} diff=${diff}`);
      if (diff > 9) continue;

      const groupId = g.id as string;
      const uid = g.owner_user_id as string;
      const network = (g.network as string) || "celo";

      const { data: existing } = await admin
        .from("daily_claim_runs")
        .select("id")
        .eq("group_id", groupId)
        .eq("run_date", today)
        .maybeSingle();
      if (existing) { console.log(`  group ${groupId}: existing run ${existing.id}`); continue; }

      const { data: wallets, error: wErr } = await admin
        .from("daily_claim_wallets")
        .select("wallet_address, encrypted_key")
        .eq("owner_user_id", uid)
        .eq("group_id", groupId)
        .eq("is_active", true);
      if (wErr) console.error("wallets fetch err", wErr);
      console.log(`  group ${groupId}: wallets=${wallets?.length ?? 0}`);
      if (!wallets || wallets.length === 0) continue;

      const { data: runRow, error: runErr } = await admin
        .from("daily_claim_runs")
        .insert({
          owner_user_id: uid,
          run_date: today,
          network,
          group_id: groupId,
          phase: "claiming",
          total: wallets.length,
          started_at: new Date().toISOString(),
        })
        .select("id")
        .single();
      if (runErr) console.error(`  run insert err for group ${groupId}:`, runErr);
      if (runErr || !runRow) continue;

      const items = wallets.map((w: any) => ({
        run_id: runRow.id,
        owner_user_id: uid,
        wallet_address: w.wallet_address,
        encrypted_key: w.encrypted_key,
        network,
      }));
      const BATCH = 500;
      for (let i = 0; i < items.length; i += BATCH) {
        const { error: itErr } = await admin.from("daily_claim_run_items").insert(items.slice(i, i + BATCH));
        if (itErr) console.error(`  items insert err:`, itErr);
      }

      kickWorker(runRow.id, "claiming");
      started++;
    }

    // 2) Resume runs whose group wait window has elapsed
    const { data: waiting } = await admin
      .from("daily_claim_runs")
      .select("id, gas_requests_done_at, group_id, owner_user_id, network")
      .eq("phase", "waiting_30m");
    for (const r of waiting || []) {
      if (!r.gas_requests_done_at) continue;
      let waitMin = 30;
      if (r.group_id) {
        const { data: g } = await admin
          .from("daily_claim_groups")
          .select("retry_wait_minutes")
          .eq("id", r.group_id)
          .maybeSingle();
        if (g?.retry_wait_minutes != null) waitMin = Number(g.retry_wait_minutes);
      } else {
        // legacy fallback
        const { data: setting } = await admin
          .from("daily_claim_settings")
          .select("retry_wait_minutes")
          .eq("owner_user_id", r.owner_user_id)
          .eq("network", r.network || "celo")
          .maybeSingle();
        if (setting?.retry_wait_minutes != null) waitMin = Number(setting.retry_wait_minutes);
      }
      const doneAt = new Date(r.gas_requests_done_at).getTime();
      if (Date.now() - doneAt >= waitMin * 60_000) {
        await admin
          .from("daily_claim_runs")
          .update({ phase: "retrying", retry_started_at: new Date().toISOString() })
          .eq("id", r.id)
          .eq("phase", "waiting_30m");
        kickWorker(r.id, "retrying");
        resumed++;
      }
    }

    // 3) Re-kick any stalled in-progress runs
    const { data: stuck } = await admin
      .from("daily_claim_runs")
      .select("id, phase, updated_at")
      .in("phase", ["claiming", "gas_requesting", "retrying"]);
    for (const r of stuck || []) {
      const stale = Date.now() - new Date(r.updated_at).getTime() > 90_000;
      if (stale) kickWorker(r.id, r.phase);
    }

    return new Response(JSON.stringify({ ok: true, started, resumed }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ ok: false, error: e?.message || String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
