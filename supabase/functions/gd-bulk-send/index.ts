// Bulk-send G$ on Celo — async job system.
// Creates a DB job, returns job_id immediately, processes recipients in the
// background using EdgeRuntime.waitUntil so the client can close the browser.
// Duplicate protection is per job/batch only: the same wallet cannot appear
// twice in one batch, but a new batch may send to the same wallet again.

import { ethers } from "https://esm.sh/ethers@6.13.4";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const CELO_RPCS = [
  "https://forno.celo.org",
  "https://rpc.ankr.com/celo",
  "https://1rpc.io/celo",
  "https://celo.drpc.org",
];

async function getWorkingProvider(): Promise<ethers.JsonRpcProvider> {
  let lastErr: any = null;
  for (const url of CELO_RPCS) {
    try {
      const p = new ethers.JsonRpcProvider(url, 42220, { staticNetwork: true });
      await p.getBlockNumber();
      return p;
    } catch (e) {
      lastErr = e;
    }
  }
  throw new Error(`All Celo RPCs unavailable: ${lastErr?.message || lastErr}`);
}

const GD_TOKEN = "0x62B8B11039FcfE5aB0C56E502b1C372A3d2a9c7A";
const DISPERSE = "0xD152f549545093347A162Dce210e7293f1452150";
const MAX_PER_TX = 75;

const ERC20_ABI = [
  "function allowance(address,address) view returns (uint256)",
  "function approve(address,uint256) returns (bool)",
  "function balanceOf(address) view returns (uint256)",
  "function decimals() view returns (uint8)",
];
const DISPERSE_ABI = [
  "function disperseTokenSimple(address token, address[] recipients, uint256[] values)",
];

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function admin() {
  return createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { persistSession: false },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  try {
    const body = await req.json();
    let senderKeyRaw = String(body?.sender_key || "").trim();
    if (/^[a-fA-F0-9]{64}$/.test(senderKeyRaw)) senderKeyRaw = "0x" + senderKeyRaw;

    const recipientsRaw: string[] = Array.isArray(body?.recipients) ? body.recipients : [];
    const amountStr = String(body?.amount || "0.5").trim();

    if (!/^0x[a-fA-F0-9]{64}$/.test(senderKeyRaw)) {
      return json({ error: "Invalid sender private key" }, 400);
    }
    const amountNum = Number(amountStr);
    if (!Number.isFinite(amountNum) || amountNum <= 0) {
      return json({ error: "Invalid amount" }, 400);
    }

    // Normalize / dedupe
    const seen = new Set<string>();
    const recipients: string[] = [];
    for (const r of recipientsRaw) {
      const s = String(r || "").trim().toLowerCase();
      if (!/^0x[a-f0-9]{40}$/.test(s)) continue;
      if (seen.has(s)) continue;
      seen.add(s);
      recipients.push(ethers.getAddress(s));
    }
    if (recipients.length === 0) return json({ error: "No valid recipients" }, 400);
    if (recipients.length > 5000) return json({ error: "Max 5000 recipients" }, 400);

    // Derive sender address (no provider needed)
    const wallet = new ethers.Wallet(senderKeyRaw);
    const senderAddress = wallet.address;

    const sb = admin();

    const lowered = recipients.map((r) => r.toLowerCase());
    const fresh = recipients;
    const skipped = 0;

    // Create job
    const { data: jobRow, error: jobErr } = await sb
      .from("gd_bulk_jobs")
      .insert({
        sender_address: senderAddress.toLowerCase(),
        sender_key_encrypted: senderKeyRaw, // protected by RLS deny + service-role only
        amount_per_recipient: amountStr,
        total: fresh.length,
        skipped,
        status: "pending",
      })
      .select("id")
      .single();
    if (jobErr || !jobRow) {
      return json({ error: jobErr?.message || "Failed to create job" }, 500);
    }
    const jobId = jobRow.id as string;

    // Reserve recipients for this job only. New jobs may send to the same wallet again.
    const lockRows = fresh.map((w) => ({
      sender_address: senderAddress.toLowerCase(),
      wallet_address: w.toLowerCase(),
      amount: amountStr,
      job_id: jobId,
      status: "reserved",
    }));
    for (let i = 0; i < lockRows.length; i += 500) {
      const { error } = await sb
        .from("gd_bulk_send_locks")
        .insert(lockRows.slice(i, i + 500));
      if (error) {
        await sb.from("gd_bulk_jobs").update({
          status: "failed", last_error: error.message, finished_at: new Date().toISOString(),
        }).eq("id", jobId);
        return json({ error: error.message }, 500);
      }
    }

    const reserved = new Set<string>();
    for (let i = 0; i < lowered.length; i += 500) {
      const { data: locks } = await sb
        .from("gd_bulk_send_locks")
        .select("wallet_address")
        .eq("sender_address", senderAddress.toLowerCase())
        .eq("amount", amountStr)
        .eq("job_id", jobId)
        .in("wallet_address", lowered.slice(i, i + 500));
      for (const r of locks || []) reserved.add(String(r.wallet_address).toLowerCase());
    }

    const rows = fresh.filter((w) => reserved.has(w.toLowerCase())).map((w) => ({
      job_id: jobId,
      sender_address: senderAddress.toLowerCase(),
      wallet_address: w.toLowerCase(),
      amount: amountStr,
      status: "pending",
    }));
    const actualSkipped = recipients.length - rows.length;
    if (rows.length === 0) {
      await sb.from("gd_bulk_jobs").update({
        total: 0,
        skipped: actualSkipped,
        status: "completed",
        sender_key_encrypted: "",
        finished_at: new Date().toISOString(),
      }).eq("id", jobId);
      return json({ ok: true, job_id: null, message: `All ${recipients.length} recipients were already reserved or sent.`, skipped: actualSkipped, total: 0 });
    }

    await sb.from("gd_bulk_jobs").update({ total: rows.length, skipped: actualSkipped }).eq("id", jobId);

    // Insert recipients in chunks
    for (let i = 0; i < rows.length; i += 500) {
      const chunk = rows.slice(i, i + 500);
      const { error } = await sb.from("gd_bulk_recipients").insert(chunk);
      if (error) {
        await sb.from("gd_bulk_jobs").update({
          status: "failed", last_error: error.message, finished_at: new Date().toISOString(),
        }).eq("id", jobId);
        return json({ error: error.message }, 500);
      }
    }

    // Kick off background processing — survives client disconnect.
    // @ts-ignore — EdgeRuntime is available in Supabase Edge Runtime
    EdgeRuntime.waitUntil(processJob(jobId));

    return json({
      ok: true,
      job_id: jobId,
      total: rows.length,
      skipped: actualSkipped,
      message: actualSkipped > 0
        ? `Started — ${actualSkipped} already sent or reserved, processing ${rows.length} new.`
        : `Started — processing ${rows.length} recipients.`,
    }, 202);
  } catch (e: any) {
    return json({ error: e?.shortMessage || e?.message || String(e) }, 500);
  }
});

async function processJob(jobId: string) {
  const sb = admin();
  try {
    const { data: job } = await sb
      .from("gd_bulk_jobs")
      .select("*")
      .eq("id", jobId)
      .single();
    if (!job) return;

    await sb.from("gd_bulk_jobs").update({ status: "processing" }).eq("id", jobId);

    const provider = await getWorkingProvider();
    const wallet = new ethers.Wallet(job.sender_key_encrypted, provider);
    const token = new ethers.Contract(GD_TOKEN, ERC20_ABI, wallet);
    const disperse = new ethers.Contract(DISPERSE, DISPERSE_ABI, wallet);

    const decimals: number = Number(await token.decimals());
    const perRecipient = ethers.parseUnits(String(job.amount_per_recipient), decimals);
    const senderAddress = String(job.sender_address).toLowerCase();
    const amountStr = String(job.amount_per_recipient);

    // Count pending recipients first; the REST API defaults to 1000 rows per read,
    // so processing must repeatedly fetch pending chunks until none remain.
    const { count: pendingCount } = await sb
      .from("gd_bulk_recipients")
      .select("id", { count: "exact", head: true })
      .eq("job_id", jobId)
      .eq("status", "pending");
    if (!pendingCount) {
      await finalize(sb, jobId);
      return;
    }

    const totalNeeded = perRecipient * BigInt(pendingCount);

    // Balance checks
    const gdBalance: bigint = await token.balanceOf(wallet.address);
    if (gdBalance < totalNeeded) {
      await failJob(sb, jobId,
        `Insufficient G$ — need ${ethers.formatUnits(totalNeeded, decimals)}, have ${ethers.formatUnits(gdBalance, decimals)}`);
      return;
    }
    const celoBalance = await provider.getBalance(wallet.address);
    if (celoBalance < ethers.parseEther("0.005")) {
      await failJob(sb, jobId,
        `Insufficient CELO for gas — have ${ethers.formatEther(celoBalance)}`);
      return;
    }

    // Approve once if needed
    const allowance: bigint = await token.allowance(wallet.address, DISPERSE);
    if (allowance < totalNeeded) {
      const approveTx = await token.approve(DISPERSE, ethers.MaxUint256);
      await sb.from("gd_bulk_jobs").update({ approve_tx: approveTx.hash }).eq("id", jobId);
      await approveTx.wait();
    }

    // Process in chunks
    while (true) {
      const { data: currentJob } = await sb
        .from("gd_bulk_jobs")
        .select("status")
        .eq("id", jobId)
        .single();
      if (currentJob?.status === "stopped" || currentJob?.status === "cancelled") break;

      const { data: pending } = await sb
        .from("gd_bulk_recipients")
        .select("id, wallet_address")
        .eq("job_id", jobId)
        .eq("status", "pending")
        .order("created_at", { ascending: true })
        .limit(MAX_PER_TX);
      const chunk = pending || [];
      if (chunk.length === 0) break;

      const sendable = chunk;

      const addresses = sendable.map((r: any) => ethers.getAddress(r.wallet_address));
      const values = addresses.map(() => perRecipient);
      const ids = sendable.map((r: any) => r.id);

      try {
        const est = await disperse.disperseTokenSimple.estimateGas(GD_TOKEN, addresses, values);
        const gasLimit = (est * 130n) / 100n;
        const tx = await disperse.disperseTokenSimple(GD_TOKEN, addresses, values, { gasLimit });
        await tx.wait();

        await sb.from("gd_bulk_recipients").update({
          status: "sent",
          tx_hash: tx.hash,
          processed_at: new Date().toISOString(),
        }).in("id", ids);

        await sb.from("gd_bulk_send_locks").update({
          status: "sent",
          tx_hash: tx.hash,
          updated_at: new Date().toISOString(),
        }).eq("job_id", jobId).in("wallet_address", sendable.map((r: any) => String(r.wallet_address).toLowerCase()));

        const { data: jb } = await sb.from("gd_bulk_jobs").select("sent").eq("id", jobId).single();
        await sb.from("gd_bulk_jobs").update({
          sent: (jb?.sent || 0) + sendable.length,
        }).eq("id", jobId);
      } catch (e: any) {
        const msg = e?.shortMessage || e?.message || String(e);
        await sb.from("gd_bulk_recipients").update({
          status: "failed",
          error_message: msg.slice(0, 500),
          processed_at: new Date().toISOString(),
        }).in("id", ids);
        await sb.from("gd_bulk_send_locks").update({
          status: "failed_locked",
          updated_at: new Date().toISOString(),
        }).eq("job_id", jobId).in("wallet_address", sendable.map((r: any) => String(r.wallet_address).toLowerCase()));
        const { data: jb } = await sb.from("gd_bulk_jobs").select("failed").eq("id", jobId).single();
        await sb.from("gd_bulk_jobs").update({
          failed: (jb?.failed || 0) + sendable.length,
          last_error: msg.slice(0, 500),
        }).eq("id", jobId);
        // Stop on hard error (out of funds / revert) — user can resume later
        break;
      }
    }

    await finalize(sb, jobId);
  } catch (e: any) {
    await failJob(sb, jobId, e?.shortMessage || e?.message || String(e));
  }
}

async function finalize(sb: any, jobId: string) {
  const { data: jb } = await sb
    .from("gd_bulk_jobs")
    .select("total, sent, failed")
    .eq("id", jobId)
    .single();
  const allDone = (jb?.sent || 0) + (jb?.failed || 0) >= (jb?.total || 0);
  const update: any = {
    status: allDone ? "completed" : "stopped",
    finished_at: new Date().toISOString(),
  };
  if (allDone) update.sender_key_encrypted = "";
  await sb.from("gd_bulk_jobs").update(update).eq("id", jobId);
}

async function failJob(sb: any, jobId: string, msg: string) {
  await sb.from("gd_bulk_jobs").update({
    status: "failed",
    last_error: msg.slice(0, 500),
    finished_at: new Date().toISOString(),
    sender_key_encrypted: "",
  }).eq("id", jobId);
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
