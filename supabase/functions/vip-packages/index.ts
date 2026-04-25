// Public catalog of VIP packages.
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RECEIVER = (Deno.env.get("CELO_RECEIVER_ADDRESS") || "").trim();

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/vip_packages?select=*&order=display_order.asc`,
      {
        headers: {
          apikey: SERVICE_KEY,
          Authorization: `Bearer ${SERVICE_KEY}`,
        },
      },
    );
    const packages = await res.json();
    return new Response(
      JSON.stringify({
        packages,
        receiver: RECEIVER,
        network: "celo",
        usdt_contract: "0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e",
        chain_id: 42220,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
