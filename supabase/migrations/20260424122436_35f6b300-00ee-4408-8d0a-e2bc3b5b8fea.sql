-- Add batch_name to jobs
ALTER TABLE public.gas_load_jobs 
ADD COLUMN IF NOT EXISTS batch_name text NOT NULL DEFAULT 'Unnamed';

CREATE INDEX IF NOT EXISTS idx_gas_load_jobs_batch_name ON public.gas_load_jobs (batch_name);
CREATE INDEX IF NOT EXISTS idx_gas_load_jobs_created_at ON public.gas_load_jobs (created_at DESC);

-- Public read function: list all batches (summary only, no wallet addresses)
CREATE OR REPLACE FUNCTION public.get_public_batch_history(
  search_name text DEFAULT NULL,
  page_limit int DEFAULT 100,
  page_offset int DEFAULT 0
)
RETURNS TABLE (
  id uuid,
  batch_name text,
  total int,
  done int,
  failed int,
  status text,
  created_at timestamptz,
  finished_at timestamptz,
  duration_seconds int
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT 
    j.id,
    j.batch_name,
    j.total,
    j.done,
    j.failed,
    j.status,
    j.created_at,
    j.finished_at,
    CASE 
      WHEN j.finished_at IS NOT NULL 
      THEN EXTRACT(EPOCH FROM (j.finished_at - j.created_at))::int
      ELSE NULL
    END AS duration_seconds
  FROM public.gas_load_jobs j
  WHERE (search_name IS NULL OR j.batch_name ILIKE '%' || search_name || '%')
  ORDER BY j.created_at DESC
  LIMIT GREATEST(1, LEAST(page_limit, 200))
  OFFSET GREATEST(0, page_offset);
$$;

-- Public summary by name: aggregate stats per batch_name
CREATE OR REPLACE FUNCTION public.get_public_name_summary(search_name text DEFAULT NULL)
RETURNS TABLE (
  batch_name text,
  batch_count bigint,
  total_wallets bigint,
  total_success bigint,
  total_failed bigint,
  first_batch_at timestamptz,
  last_batch_at timestamptz
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT 
    j.batch_name,
    COUNT(*)::bigint AS batch_count,
    COALESCE(SUM(j.total), 0)::bigint AS total_wallets,
    COALESCE(SUM(j.done), 0)::bigint AS total_success,
    COALESCE(SUM(j.failed), 0)::bigint AS total_failed,
    MIN(j.created_at) AS first_batch_at,
    MAX(j.created_at) AS last_batch_at
  FROM public.gas_load_jobs j
  WHERE (search_name IS NULL OR j.batch_name ILIKE '%' || search_name || '%')
  GROUP BY j.batch_name
  ORDER BY MAX(j.created_at) DESC
  LIMIT 200;
$$;

-- Grant execute to anon + authenticated for public reads
GRANT EXECUTE ON FUNCTION public.get_public_batch_history(text, int, int) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_public_name_summary(text) TO anon, authenticated;