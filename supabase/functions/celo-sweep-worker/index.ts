// Background worker for CELO sweep jobs.
// Runs every minute via pg_cron. Picks running jobs and processes pending
// queue items in parallel chunks (each wallet has its own nonce — safe).
// Self-reschedules if work remains.

import { Wallet, JsonRpcProvider, formatEther } from "npm:ethers@6.13.4";
import { createClient } from "npm:@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CELO_RPC = "https://forno.celo.org";

const provider = new JsonRpcProvider(CELO_RPC, 42220);
const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const CHUNK = 50;                   // parallel sweeps per cycle
const ITEMS_PER_CYCLE = 300;        // soft cap per worker invocation
const TIME_BUDGET_MS = 110_000;
const STOP_BEFORE_TIMEOUT_MS = 15_000;

let inFlight = false;

const TRIGGER_URL = `${SUPABASE_URL}/functions/v1/celo-sweep-worker`;

function hasTimeLeft(deadline: number) {
  return Date.now() < deadline - STOP_BEFORE_TIMEOUT_MS;
}

async function isJobRunning(jobId: string): Promise<boolean> {
  const { data } = await admin
    .from("celo_sweep_jobs")
    .select("status")
    .eq("id", jobId)
    .single();
  return data?.status === "running";
}

async function pickJob(): Promise<{ id: string; receiver: string } | null> {
  const { data } = await admin
    .from("celo_sweep_jobs")
    .select("id, receiver")
    .eq("status", "running")
    .order("last_run_at", { ascending: true, nullsFirst: true })
    .limit(1);
  if (!data || data.length === 0) return null;
  return data[0] as any;
}

async function getFee() {
  const fee = await provider.getFeeData();
  const gasPrice = (fee.gasPrice ?? fee.maxFeePerGas ?? 25_000_000_000n) as bigint;
  const GAS_LIMIT = 21000n;
  const reserve = (gasPrice * GAS_LIMIT * 120n) / 100n;
  return { gasPrice, GAS_LIMIT, reserve };
}

type Item = { id: string; private_key: string };

async function processJob(job: { id: string; receiver: string }, deadline: number): Promise<{ processed: number; ok: number; failed: number; sweptWei: bigint; stopped: boolean; exhausted: boolean; remaining: boolean }> {
  let totalOk = 0;
  let totalFailed = 0;
  let processed = 0;
  let sweptWei = 0n;

  const { gasPrice, GAS_LIMIT, reserve } = await getFee();

  let cycleProcessed = 0;
  while (cycleProcessed < ITEMS_PER_CYCLE && hasTimeLeft(deadline)) {
    if (!(await isJobRunning(job.id))) {
      return { processed, ok: totalOk, failed: totalFailed, sweptWei, stopped: true, exhausted: false, remaining: false };
    }

    const { data: items, error } = await admin
      .from("celo_sweep_queue")
      .select("id, private_key")
      .eq("job_id", job.id)
      .eq("status", "pending")
      .order("created_at", { ascending: true })
      .limit(CHUNK);
    if (error) {
      return { processed, ok: totalOk, failed: totalFailed, sweptWei, stopped: false, exhausted: true, remaining: true, ...({} as any) };
    }
    if (!items || items.length === 0) break;

    const sweepOne = async (it: Item) => {
      let address = "";
      try {
        const wallet = new Wallet(it.private_key, provider);
        address = wallet.address;
        const bal = await provider.getBalance(address);
        if (bal <= reserve) {
          await admin.from("celo_sweep_queue").update({
            status: "failed", wallet_address: address,
            error_message: "balance too low to cover gas",
            processed_at: new Date().toISOString(),
            attempts: 1,
          }).eq("id", it.id);
          return { ok: false, value: 0n };
        }
        const value = bal - reserve;
        const tx = await wallet.sendTransaction({
          to: job.receiver, value, gasLimit: GAS_LIMIT, gasPrice,
        });
        await admin.from("celo_sweep_queue").update({
          status: "success", wallet_address: address,
          tx_hash: tx.hash, amount: formatEther(value),
          processed_at: new Date().toISOString(),
          attempts: 1,
        }).eq("id", it.id);
        return { ok: true, value };
      } catch (e: any) {
        await admin.from("celo_sweep_queue").update({
          status: "failed", wallet_address: address || null,
          error_message: e?.shortMessage || e?.message || String(e),
          processed_at: new Date().toISOString(),
          attempts: 1,
        }).eq("id", it.id);
        return { ok: false, value: 0n };
      }
    };

    const results = await Promise.all((items as Item[]).map(sweepOne));
    const ok = results.filter((r) => r.ok).length;
    const failed = results.length - ok;
    const swept = results.reduce((s, r) => s + r.value, 0n);
    totalOk += ok;
    totalFailed += failed;
    processed += results.length;
    sweptWei += swept;
    cycleProcessed += results.length;

    // Update job counters incrementally
    const { data: cur } = await admin
      .from("celo_sweep_jobs")
      .select("done, ok_count, failed_count, total_swept_celo")
      .eq("id", job.id)
      .single();
    if (cur) {
      const prevSwept = (() => { try { return BigInt(Math.floor(parseFloat(cur.total_swept_celo || "0") * 1e18)); } catch { return 0n; } })();
      await admin.from("celo_sweep_jobs").update({
        done: (cur.done || 0) + results.length,
        ok_count: (cur.ok_count || 0) + ok,
        failed_count: (cur.failed_count || 0) + failed,
        total_swept_celo: formatEther(prevSwept + swept),
        last_run_at: new Date().toISOString(),
      }).eq("id", job.id);
    }
  }

  // Check if any pending remain
  const { count: pendingLeft } = await admin
    .from("celo_sweep_queue")
    .select("id", { count: "exact", head: true })
    .eq("job_id", job.id)
    .eq("status", "pending");

  const remaining = (pendingLeft || 0) > 0;
  if (!remaining) {
    await admin.from("celo_sweep_jobs").update({
      status: "done",
      finished_at: new Date().toISOString(),
    }).eq("id", job.id);
  }

  return { processed, ok: totalOk, failed: totalFailed, sweptWei, stopped: false, exhausted: !hasTimeLeft(deadline), remaining };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  if (inFlight) {
    return new Response(JSON.stringify({ ok: true, skipped: "already running" }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  inFlight = true;

  const startedAt = Date.now();
  const deadline = startedAt + TIME_BUDGET_MS;
  let totalProcessed = 0;
  let anyRemaining = false;

  try {
    while (hasTimeLeft(deadline)) {
      const job = await pickJob();
      if (!job) break;
      const r = await processJob(job, deadline);
      totalProcessed += r.processed;
      if (r.remaining) anyRemaining = true;
      if (r.stopped) continue;
      if (r.exhausted) { anyRemaining = anyRemaining || r.remaining; break; }
    }

    // Check globally for remaining work
    const { data: more } = await admin
      .from("celo_sweep_jobs")
      .select("id")
      .eq("status", "running")
      .limit(1);
    const remaining = anyRemaining || Boolean(more && more.length > 0);

    if (remaining) {
      fetch(TRIGGER_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          apikey: SUPABASE_SERVICE_ROLE_KEY,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ trigger: "continue" }),
      }).catch(() => {});
    }

    return new Response(JSON.stringify({ ok: true, processed: totalProcessed, remaining }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    console.error("celo-sweep-worker error", e?.message || e);
    return new Response(JSON.stringify({ ok: false, error: e?.message || String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } finally {
    inFlight = false;
  }
});
