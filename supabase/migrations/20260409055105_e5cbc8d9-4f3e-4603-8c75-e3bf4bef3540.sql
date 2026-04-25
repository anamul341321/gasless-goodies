ALTER TABLE public.admin_settings
ADD COLUMN IF NOT EXISTS show_claim_stats boolean NOT NULL DEFAULT true;

ALTER TABLE public.claim_stats
ADD COLUMN IF NOT EXISTS claim_date date;

UPDATE public.claim_stats
SET wallet_address = lower(wallet_address),
    claim_date = COALESCE(claim_date, timezone('UTC', created_at)::date)
WHERE claim_date IS NULL
   OR wallet_address <> lower(wallet_address);

DELETE FROM public.claim_stats t
USING (
  SELECT id,
         row_number() OVER (
           PARTITION BY wallet_address, network, claim_source, claim_date
           ORDER BY created_at, id
         ) AS rn
  FROM public.claim_stats
) d
WHERE t.id = d.id
  AND d.rn > 1;

ALTER TABLE public.claim_stats
ALTER COLUMN claim_date SET DEFAULT (timezone('UTC', now())::date),
ALTER COLUMN claim_date SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS claim_stats_unique_wallet_network_source_day
ON public.claim_stats (wallet_address, network, claim_source, claim_date);

DROP POLICY IF EXISTS "Anyone can view claim stats" ON public.claim_stats;
CREATE POLICY "No direct public access to claim stats"
ON public.claim_stats
FOR SELECT
TO anon, authenticated
USING (false);

DROP VIEW IF EXISTS public.claim_stats_public_summary;
CREATE VIEW public.claim_stats_public_summary AS
SELECT
  claim_date,
  network,
  count(*)::bigint AS claim_count,
  COALESCE(
    sum(
      CASE
        WHEN g_dollar_amount ~ '^[0-9]+(\.[0-9]+)?$' THEN
          CASE
            WHEN g_dollar_amount::numeric > 1000000000000 THEN g_dollar_amount::numeric / 1000000000000000000
            ELSE g_dollar_amount::numeric
          END
        ELSE 0
      END
    ),
    0
  )::numeric AS total_g_dollar
FROM public.claim_stats
GROUP BY claim_date, network;

GRANT SELECT ON public.claim_stats_public_summary TO anon, authenticated;