import { historyUser, historyDenied } from "../_shared/historyAuth.ts";
// VIP user polls status of their own gas-load job.
// Uses security-definer functions so the user only sees their own data.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

async function rpc(req: Request, fn: string, args: Record<string, unknown>) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: Deno.env.get("SUPABASE_ANON_KEY") || "",
      Authorization: req.headers.get("Authorization") || "",
    },
    body: JSON.stringify(args),
  });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
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

  const requester = await historyUser(req);
  if (!requester) return historyDenied(corsHeaders);

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
  if (!/^0x[a-fA-F0-9]{40}$/.test(userWallet)) {
    return new Response(JSON.stringify({ error: "invalid user_wallet" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const profileRes = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${requester.id}&select=wallet_address`, { headers: { apikey: SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` } });
  const profiles = profileRes.ok ? await profileRes.json() : [];
  if (profiles[0]?.wallet_address?.toLowerCase() !== userWallet.toLowerCase()) return historyDenied(corsHeaders, 404);

  const action: string = typeof body?.action === "string" ? body.action : "status";

  try {
    if (action === "recent") {
      const jobs = await rpc(req, "get_vip_recent_jobs", { p_wallet: userWallet });
      return new Response(JSON.stringify({ jobs }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "locked") {
      // Aggregate all locked wallets across user's active memberships
      const nowIso = new Date().toISOString();
      const memRes = await fetch(
        `${SUPABASE_URL}/rest/v1/user_memberships?status=eq.active&expires_at=gt.${nowIso}&select=id,user_wallet,package_id,expires_at`,
        {
          headers: {
            apikey: SUPABASE_SERVICE_ROLE_KEY,
            Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          },
        },
      );
      const allMems = memRes.ok ? await memRes.json() : [];
      const myMems = (allMems || []).filter(
        (m: any) => (m.user_wallet || "").toLowerCase() === userWallet.toLowerCase(),
      );
      if (myMems.length === 0) {
        return new Response(
          JSON.stringify({ has_membership: false, wallets: [] }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      const ids = myMems.map((m: any) => `"${m.id}"`).join(",");
      const lockRes = await fetch(
        `${SUPABASE_URL}/rest/v1/locked_wallets?membership_id=in.(${ids})&select=wallet_address,added_at,membership_id&order=added_at.desc`,
        {
          headers: {
            apikey: SUPABASE_SERVICE_ROLE_KEY,
            Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          },
        },
      );
      const locked = lockRes.ok ? await lockRes.json() : [];
      // Dedupe by wallet_address (case-insensitive)
      const seen = new Set<string>();
      const dedup: any[] = [];
      for (const r of locked) {
        const k = (r.wallet_address || "").toLowerCase();
        if (seen.has(k)) continue;
        seen.add(k);
        dedup.push(r);
      }
      return new Response(
        JSON.stringify({ has_membership: true, wallets: dedup, memberships: myMems }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // action === "status"
    const jobId: string = typeof body?.job_id === "string" ? body.job_id : "";
    if (!jobId) {
      return new Response(JSON.stringify({ error: "job_id required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const job = await rpc(req, "get_vip_job_status", { p_wallet: userWallet, p_job_id: jobId });
    if (!Array.isArray(job) || job.length === 0) {
      return new Response(JSON.stringify({ job: null, wallets: [] }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const wallets = await rpc(req, "get_vip_job_wallets", { p_wallet: userWallet, p_job_id: jobId });
    return new Response(
      JSON.stringify({ job: job[0], wallets }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
