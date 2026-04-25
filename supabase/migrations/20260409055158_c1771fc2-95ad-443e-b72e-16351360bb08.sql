DROP VIEW IF EXISTS public.claim_stats_public_summary;

CREATE TABLE IF NOT EXISTS public.claim_stats_public_summary (
  claim_date date NOT NULL,
  network text NOT NULL,
  claim_count bigint NOT NULL DEFAULT 0,
  total_g_dollar numeric NOT NULL DEFAULT 0,
  PRIMARY KEY (claim_date, network)
);

ALTER TABLE public.claim_stats_public_summary ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can read claim stats public summary" ON public.claim_stats_public_summary;
CREATE POLICY "Anyone can read claim stats public summary"
ON public.claim_stats_public_summary
FOR SELECT
TO anon, authenticated
USING (true);

DROP POLICY IF EXISTS "No direct writes to claim stats public summary" ON public.claim_stats_public_summary;
CREATE POLICY "No direct writes to claim stats public summary"
ON public.claim_stats_public_summary
FOR ALL
TO anon, authenticated
USING (false)
WITH CHECK (false);

CREATE OR REPLACE FUNCTION public.calculate_claim_stats_amount(raw_amount text)
RETURNS numeric
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
BEGIN
  IF raw_amount IS NULL OR raw_amount !~ '^[0-9]+(\.[0-9]+)?$' THEN
    RETURN 0;
  END IF;

  IF raw_amount::numeric > 1000000000000 THEN
    RETURN raw_amount::numeric / 1000000000000000000;
  END IF;

  RETURN raw_amount::numeric;
END;
$$;

CREATE OR REPLACE FUNCTION public.refresh_claim_stats_public_summary()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  DELETE FROM public.claim_stats_public_summary;

  INSERT INTO public.claim_stats_public_summary (claim_date, network, claim_count, total_g_dollar)
  SELECT
    claim_date,
    network,
    count(*)::bigint,
    COALESCE(sum(public.calculate_claim_stats_amount(g_dollar_amount)), 0)::numeric
  FROM public.claim_stats
  GROUP BY claim_date, network;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS refresh_claim_stats_public_summary_after_change ON public.claim_stats;
CREATE TRIGGER refresh_claim_stats_public_summary_after_change
AFTER INSERT OR UPDATE OR DELETE ON public.claim_stats
FOR EACH STATEMENT
EXECUTE FUNCTION public.refresh_claim_stats_public_summary();

DELETE FROM public.claim_stats_public_summary;
INSERT INTO public.claim_stats_public_summary (claim_date, network, claim_count, total_g_dollar)
SELECT
  claim_date,
  network,
  count(*)::bigint,
  COALESCE(sum(public.calculate_claim_stats_amount(g_dollar_amount)), 0)::numeric
FROM public.claim_stats
GROUP BY claim_date, network;