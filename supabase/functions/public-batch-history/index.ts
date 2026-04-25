// Public read-only batch history (no password). Returns batch summary +
// optional per-name aggregate. Used by the public BatchHistory page.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function sbHeaders() {
  return {
    "Content-Type": "application/json",
    apikey: SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const url = new URL(req.url);
  const search = (url.searchParams.get("search") || "").trim();
  const limit = Math.min(200, Math.max(1, Number(url.searchParams.get("limit") ?? 100)));
  const offset = Math.max(0, Number(url.searchParams.get("offset") ?? 0));
  const mode = url.searchParams.get("mode") || "list"; // "list" | "summary"

  const rpcName =
    mode === "summary" ? "get_public_name_summary" : "get_public_batch_history";
  const payload =
    mode === "summary"
      ? { search_name: search || null }
      : {
          search_name: search || null,
          page_limit: limit,
          page_offset: offset,
        };

  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${rpcName}`, {
    method: "POST",
    headers: sbHeaders(),
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const text = await res.text();
    return new Response(JSON.stringify({ error: "query failed", detail: text }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const data = await res.json();
  return new Response(JSON.stringify({ rows: data }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
