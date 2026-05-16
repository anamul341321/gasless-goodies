
ALTER TABLE public.gd_claim_jobs
  ADD COLUMN IF NOT EXISTS network text NOT NULL DEFAULT 'celo';

CREATE INDEX IF NOT EXISTS idx_gd_claim_jobs_network ON public.gd_claim_jobs(network);

-- Update RPC: include network
DROP FUNCTION IF EXISTS public.get_gd_claim_status(uuid);
CREATE OR REPLACE FUNCTION public.get_gd_claim_status(p_job_id uuid)
 RETURNS TABLE(id uuid, batch_name text, total integer, done integer, failed integer, needs_gas integer, status text, network text, created_at timestamp with time zone, finished_at timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT j.id, j.batch_name, j.total, j.done, j.failed, j.needs_gas,
         j.status, j.network, j.created_at, j.finished_at
  FROM public.gd_claim_jobs j
  WHERE j.id = p_job_id
  LIMIT 1;
$function$;

DROP FUNCTION IF EXISTS public.get_my_gd_claim_batches();
CREATE OR REPLACE FUNCTION public.get_my_gd_claim_batches()
 RETURNS TABLE(id uuid, batch_name text, total integer, done integer, failed integer, needs_gas integer, status text, network text, created_at timestamp with time zone, finished_at timestamp with time zone, failed_with_keys bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT
    j.id, j.batch_name, j.total, j.done, j.failed, j.needs_gas,
    j.status, j.network, j.created_at, j.finished_at,
    COALESCE((
      SELECT COUNT(*)::bigint FROM public.gd_claim_queue q
      WHERE q.job_id = j.id
        AND (q.status LIKE 'failed%' OR q.status = 'already_claimed')
        AND q.private_key IS NOT NULL
    ), 0) AS failed_with_keys
  FROM public.gd_claim_jobs j
  WHERE j.owner_user_id = auth.uid()
  ORDER BY j.created_at DESC
  LIMIT 200;
$function$;

DROP FUNCTION IF EXISTS public.get_public_gd_claim_history(text, integer, integer);
CREATE OR REPLACE FUNCTION public.get_public_gd_claim_history(search_name text DEFAULT NULL::text, page_limit integer DEFAULT 100, page_offset integer DEFAULT 0)
 RETURNS TABLE(id uuid, batch_name text, total integer, done integer, failed integer, needs_gas integer, status text, network text, created_at timestamp with time zone, finished_at timestamp with time zone, duration_seconds integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT
    j.id, j.batch_name, j.total, j.done, j.failed, j.needs_gas,
    j.status, j.network, j.created_at, j.finished_at,
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
$function$;
