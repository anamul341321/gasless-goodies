// Returns live CELO/USD price from CoinGecko with a short in-memory cache.
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

let cached: { price: number; at: number } | null = null;
const TTL_MS = 5 * 60 * 1000; // 5 minutes
const FALLBACK_PRICE = 0.30;

async function fetchPrice(): Promise<number> {
  const url =
    "https://api.coingecko.com/api/v3/simple/price?ids=celo&vs_currencies=usd";
  const res = await fetch(url, {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`coingecko ${res.status}`);
  const j = await res.json();
  const p = Number(j?.celo?.usd);
  if (!isFinite(p) || p <= 0) throw new Error("invalid price");
  return p;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const now = Date.now();
    if (!cached || now - cached.at > TTL_MS) {
      try {
        const price = await fetchPrice();
        cached = { price, at: now };
      } catch (e) {
        if (!cached) cached = { price: FALLBACK_PRICE, at: now };
        console.warn("price fetch failed, using cache/fallback", (e as Error).message);
      }
    }

    return new Response(
      JSON.stringify({
        price_usd: cached!.price,
        cached_at: new Date(cached!.at).toISOString(),
        source: "coingecko",
      }),
      {
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
          "Cache-Control": "public, max-age=300",
        },
      },
    );
  } catch (e) {
    return new Response(
      JSON.stringify({ price_usd: FALLBACK_PRICE, fallback: true, error: (e as Error).message }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
