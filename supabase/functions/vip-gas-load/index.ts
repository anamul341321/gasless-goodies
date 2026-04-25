// VIP user submits a gas-load batch.
// Verifies: (1) wallet has an active membership, (2) submitted addresses are
// in the user's locked_wallets list (across any of their active memberships).
// Then enqueues a job that the existing gas-loader-worker will process.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function sbHeaders(extra: Record<string, string> = {}) {
  return {
    "Content-Type": "application/json",
    apikey: SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    ...extra,
  };
}

async function sbFetch(path: string, init: RequestInit) {
  return fetch(`${SUPABASE_URL}${path}`, {
    ...init,
    headers: { ...sbHeaders(), ...(init.headers || {}) },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Global toggle (admin can switch off)
  try {
    const enabledRes = await sbFetch(
      "/rest/v1/admin_settings?id=eq.main&select=gas_loader_enabled",
      { method: "GET" },
    );
    if (enabledRes.ok) {
      const rows = await enabledRes.json();
      const flag = Array.isArray(rows) && rows[0] ? rows[0].gas_loader_enabled : true;
      if (flag === false) {
        return new Response(
          JSON.stringify({ error: "Gas loader is currently disabled by admin." }),
          { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
    }
  } catch (e) {
    console.warn("enabled check failed", (e as Error).message);
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "invalid json" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const userWallet: string = typeof body?.user_wallet === "string" ? body.user_wallet.trim() : "";
  const wallets: string[] = Array.isArray(body?.wallets) ? body.wallets : [];
  const batchName: string = typeof body?.batch_name === "string" ? body.batch_name.trim() : "";
  const delayMs: number = Math.max(0, Math.min(15000, Number(body?.delay_ms ?? 3000)));

  if (!/^0x[a-fA-F0-9]{40}$/.test(userWallet)) {
    return new Response(JSON.stringify({ error: "invalid user_wallet" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  if (!batchName || batchName.length < 1 || batchName.length > 80) {
    return new Response(JSON.stringify({ error: "batch_name is required (1-80 characters)" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  if (wallets.length === 0) {
    return new Response(JSON.stringify({ error: "no wallets provided" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  if (wallets.length > 350) {
    return new Response(JSON.stringify({ error: "max 350 wallets per submission" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // 1. Active membership check
  const nowIso = new Date().toISOString();
  const memRes = await sbFetch(
    `/rest/v1/user_memberships?user_wallet=eq.${userWallet.toLowerCase()}&status=eq.active&expires_at=gt.${nowIso}&select=id`,
    { method: "GET", headers: { Prefer: "count=exact" } },
  );
  // Try lowercase first; fall back to case-insensitive scan if needed
  let membershipIds: string[] = [];
  if (memRes.ok) {
    const rows = await memRes.json();
    membershipIds = (rows || []).map((r: any) => r.id);
  }
  if (membershipIds.length === 0) {
    // case-insensitive fallback
    const allRes = await sbFetch(
      `/rest/v1/user_memberships?status=eq.active&expires_at=gt.${nowIso}&select=id,user_wallet`,
      { method: "GET" },
    );
    if (allRes.ok) {
      const all = await allRes.json();
      membershipIds = (all || [])
        .filter((r: any) => (r.user_wallet || "").toLowerCase() === userWallet.toLowerCase())
        .map((r: any) => r.id);
    }
  }
  if (membershipIds.length === 0) {
    return new Response(
      JSON.stringify({ error: "No active membership. Please buy a VIP package first." }),
      { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  // 2. Dedupe + validate input addresses
  const seen = new Set<string>();
  const cleaned: string[] = [];
  const invalid: string[] = [];
  for (const w of wallets) {
    if (typeof w !== "string") continue;
    const trimmed = w.trim();
    if (!/^0x[a-fA-F0-9]{40}$/.test(trimmed)) {
      invalid.push(trimmed);
      continue;
    }
    const k = trimmed.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    cleaned.push(trimmed);
  }
  if (cleaned.length === 0) {
    return new Response(
      JSON.stringify({ error: "no valid wallet addresses", invalid: invalid.length }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  // 3. Fetch all locked wallets across this user's active memberships
  const inList = membershipIds.map((id) => `"${id}"`).join(",");
  const lockRes = await sbFetch(
    `/rest/v1/locked_wallets?membership_id=in.(${inList})&select=wallet_address`,
    { method: "GET" },
  );
  if (!lockRes.ok) {
    const t = await lockRes.text();
    return new Response(
      JSON.stringify({ error: "failed to fetch locked wallets", detail: t }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
  const lockedRows = await lockRes.json();
  const lockedSet = new Set<string>(
    (lockedRows || []).map((r: any) => (r.wallet_address || "").toLowerCase()),
  );

  // 4. Filter: only locked wallets pass
  const allowed: string[] = [];
  const rejected: string[] = [];
  for (const w of cleaned) {
    if (lockedSet.has(w.toLowerCase())) allowed.push(w);
    else rejected.push(w);
  }

  if (allowed.length === 0) {
    return new Response(
      JSON.stringify({
        error: "None of the submitted wallets are in your locked list.",
        rejected_count: rejected.length,
        hint: "Lock these wallets to your VIP membership first from the dashboard.",
      }),
      { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  // 5. Create job
  const jobRes = await sbFetch("/rest/v1/gas_load_jobs", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({
      total: allowed.length,
      delay_ms: delayMs,
      status: "pending",
      batch_name: batchName,
      submitted_by_wallet: userWallet.toLowerCase(),
    }),
  });
  if (!jobRes.ok) {
    const t = await jobRes.text();
    return new Response(
      JSON.stringify({ error: "failed to create job", detail: t }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
  const jobRows = await jobRes.json();
  const job = Array.isArray(jobRows) ? jobRows[0] : jobRows;
  const jobId = job.id as string;

  // 6. Enqueue (batched)
  const queueRows = allowed.map((w) => ({
    job_id: jobId,
    wallet_address: w,
    status: "pending",
  }));
  const BATCH = 500;
  for (let i = 0; i < queueRows.length; i += BATCH) {
    const slice = queueRows.slice(i, i + BATCH);
    const qRes = await sbFetch("/rest/v1/gas_load_queue", {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify(slice),
    });
    if (!qRes.ok) {
      const t = await qRes.text();
      return new Response(
        JSON.stringify({ error: "failed to enqueue", detail: t }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
  }

  // 7. Kick worker (best-effort)
  fetch(`${SUPABASE_URL}/functions/v1/gas-loader-worker`, {
    method: "POST",
    headers: sbHeaders(),
    body: JSON.stringify({ trigger: "vip-submit", job_id: jobId }),
  }).catch((e) => console.warn("kick worker failed", (e as Error).message));

  return new Response(
    JSON.stringify({
      job_id: jobId,
      total: allowed.length,
      rejected_not_locked: rejected.length,
      invalid: invalid.length,
    }),
    { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});
