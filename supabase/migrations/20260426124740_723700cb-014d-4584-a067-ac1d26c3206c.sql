-- Public read-only RPC for G$ claim batch history (counts only, no wallets/keys)
CREATE OR REPLACE FUNCTION public.get_public_gd_claim_history(
  search_name text DEFAULT NULL,
  page_limit int DEFAULT 100,
  page_offset int DEFAULT 0
)
RETURNS TABLE(
  id uuid,
  batch_name text,
  total int,
  done int,
  failed int,
  needs_gas int,
  status text,
  created_at timestamptz,
  finished_at timestamptz,
  duration_seconds int
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    j.id,
    j.batch_name,
    j.total,
    j.done,
    j.failed,
    j.needs_gas,
    j.status,
    j.created_at,
    j.finished_at,
    CASE
      WHEN j.finished_at IS NOT NULL
      THEN EXTRACT(EPOCH FROM (j.finished_at - j.created_at))::int
      ELSE NULL
    END AS duration_seconds
  FROM public.gd_claim_jobs j
  WHERE (search_name IS NULL OR j.batch_name ILIKE '%' || search_name || '%')
  ORDER BY j.created_at DESC
  LIMIT GREATEST(1, LEAST(page_limit, 200))
  OFFSET GREATEST(0, page_offset);
$$;