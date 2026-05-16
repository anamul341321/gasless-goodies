ALTER TABLE public.gd_claim_jobs
  ADD COLUMN IF NOT EXISTS gas_phase text NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS gas_job_id uuid,
  ADD COLUMN IF NOT EXISTS gas_requested_at timestamptz,
  ADD COLUMN IF NOT EXISTS gas_done_at timestamptz,
  ADD COLUMN IF NOT EXISTS retry_eligible_at timestamptz,
  ADD COLUMN IF NOT EXISTS retried_at timestamptz;

CREATE INDEX IF NOT EXISTS gd_claim_jobs_gas_phase_idx
  ON public.gd_claim_jobs(gas_phase)
  WHERE gas_phase <> 'none' AND gas_phase <> 'retried';

DROP FUNCTION IF EXISTS public.get_gd_claim_status(uuid);
DROP FUNCTION IF EXISTS public.get_my_gd_claim_batches();

CREATE FUNCTION public.get_gd_claim_status(p_job_id uuid)
 RETURNS TABLE(id uuid, batch_name text, total integer, done integer, failed integer, needs_gas integer, status text, network text, gas_phase text, created_at timestamp with time zone, finished_at timestamp with time zone)
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT j.id, j.batch_name, j.total, j.done, j.failed, j.needs_gas,
         j.status, j.network, j.gas_phase, j.created_at, j.finished_at
  FROM public.gd_claim_jobs j WHERE j.id = p_job_id LIMIT 1;
$$;

CREATE FUNCTION public.get_my_gd_claim_batches()
 RETURNS TABLE(id uuid, batch_name text, total integer, done integer, failed integer, needs_gas integer, status text, network text, gas_phase text, created_at timestamp with time zone, finished_at timestamp with time zone, failed_with_keys bigint)
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT j.id, j.batch_name, j.total, j.done, j.failed, j.needs_gas,
         j.status, j.network, j.gas_phase, j.created_at, j.finished_at,
    COALESCE((
      SELECT COUNT(*)::bigint FROM public.gd_claim_queue q
      WHERE q.job_id = j.id
        AND (q.status LIKE 'failed%' OR q.status = 'already_claimed')
        AND q.private_key IS NOT NULL
    ), 0) AS failed_with_keys
  FROM public.gd_claim_jobs j
  WHERE j.owner_user_id = auth.uid()
  ORDER BY j.created_at DESC LIMIT 200;
$$;