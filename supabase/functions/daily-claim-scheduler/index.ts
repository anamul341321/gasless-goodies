// Runs every minute via pg_cron. Two responsibilities:
//  1) At Bangladesh midnight (UTC 18:00–18:09), create today's run for every
//     user that has active wallets and kick the worker in phase 1.
//  2) For runs in phase 'waiting_30m' whose gas_requests_done_at + 30m has
//     passed, advance to phase 'retrying' and trigger the worker.

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
  const today = bdNow.toISOString().slice(0, 10); // run_date keyed in BD date

  let started = 0;
  let resumed = 0;

  try {
    // 1) Per-user/per-network scheduled start. Trigger any setting whose
    //    target time has passed within the last 10 minutes and hasn't run today.
    const { data: settings } = await admin
      .from("daily_claim_settings")
      .select("owner_user_id, network, start_hour_bd, start_minute_bd, enabled")
      .eq("enabled", true);

    for (const s of settings || []) {
      // target time expressed in UTC minutes-of-day
      const targetUtcMin = (((s.start_hour_bd as number) * 60 + (s.start_minute_bd as number)) - 360 + 1440) % 1440;
      // diff = how many minutes since target fired today (handle midnight wrap)
      let diff = utcNowMin - targetUtcMin;
      if (diff < 0) diff += 1440;
      if (diff > 9) continue; // only fire within a 10-minute window

      const uid = s.owner_user_id as string;
      const network = (s.network as string) || "celo";

      const { data: existing } = await admin
        .from("daily_claim_runs")
        .select("id")
        .eq("owner_user_id", uid)
        .eq("run_date", today)
        .eq("network", network)
        .maybeSingle();
      if (existing) continue;

      const { data: wallets } = await admin
        .from("daily_claim_wallets")
        .select("wallet_address, encrypted_key")
        .eq("owner_user_id", uid)
        .eq("network", network)
        .eq("is_active", true);
      if (!wallets || wallets.length === 0) continue;

      const { data: runRow, error: runErr } = await admin
        .from("daily_claim_runs")
        .insert({
          owner_user_id: uid,
          run_date: today,
          network,
          phase: "claiming",
          total: wallets.length,
          started_at: new Date().toISOString(),
        })
        .select("id")
        .single();
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
        await admin.from("daily_claim_run_items").insert(items.slice(i, i + BATCH));
      }

      kickWorker(runRow.id, "claiming");
      started++;
    }

    // 2) Resume runs that finished waiting (per-user configurable wait)
    const { data: waiting } = await admin
      .from("daily_claim_runs")
      .select("id, gas_requests_done_at, owner_user_id, network")
      .eq("phase", "waiting_30m");
    for (const r of waiting || []) {
      if (!r.gas_requests_done_at) continue;
      const { data: setting } = await admin
        .from("daily_claim_settings")
        .select("retry_wait_minutes")
        .eq("owner_user_id", r.owner_user_id)
        .eq("network", r.network || "celo")
        .maybeSingle();
      const waitMin = Number(setting?.retry_wait_minutes ?? 30);
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

    // 3) Re-kick any in-progress runs in case they stalled
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
