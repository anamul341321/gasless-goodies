import { historyUser, historyDenied } from "../_shared/historyAuth.ts";
// Public read-only endpoint for G$ claim batch history (counts only).
// No private keys, no wallet addresses — just per-batch summary stats.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function sbHeaders(req: Request) {
  return {
    "Content-Type": "application/json",
    apikey: Deno.env.get("SUPABASE_ANON_KEY") || "",
    Authorization: req.headers.get("Authorization") || "",
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (!await historyUser(req)) return historyDenied(corsHeaders);

  try {
    const url = new URL(req.url);
    const search = url.searchParams.get("search")?.trim() || null;
    const limitRaw = Number(url.searchParams.get("limit") || "100");
    const offsetRaw = Number(url.searchParams.get("offset") || "0");
    const limit = Math.max(1, Math.min(200, isNaN(limitRaw) ? 100 : limitRaw));
    const offset = Math.max(0, isNaN(offsetRaw) ? 0 : offsetRaw);

    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/rpc/get_public_gd_claim_history`,
      {
        method: "POST",
        headers: sbHeaders(req),
        body: JSON.stringify({
          search_name: search,
          page_limit: limit,
          page_offset: offset,
        }),
      }
    );

    if (!res.ok) {
      const text = await res.text();
      return new Response(
        JSON.stringify({ error: "lookup failed", detail: text }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" },
        }
      );
    }

    const rows = await res.json();
    return new Response(JSON.stringify({ rows }), {
      headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" },
    });
  } catch (e: any) {
    return new Response(
      JSON.stringify({ error: e?.message || String(e) }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" },
      }
    );
  }
});
