-- Track which VIP user submitted a job (NULL = admin submission)
ALTER TABLE public.gas_load_jobs
ADD COLUMN IF NOT EXISTS submitted_by_wallet text;

CREATE INDEX IF NOT EXISTS idx_gas_load_jobs_submitted_by_wallet
ON public.gas_load_jobs (LOWER(submitted_by_wallet))
WHERE submitted_by_wallet IS NOT NULL;

-- Security definer function: a VIP user fetches their own job + queue rows
CREATE OR REPLACE FUNCTION public.get_vip_job_status(
  p_wallet text,
  p_job_id uuid
)
RETURNS TABLE(
  id uuid,
  total integer,
  done integer,
  failed integer,
  status text,
  delay_ms integer,
  batch_name text,
  created_at timestamptz,
  finished_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT j.id, j.total, j.done, j.failed, j.status, j.delay_ms, j.batch_name, j.created_at, j.finished_at
  FROM public.gas_load_jobs j
  WHERE j.id = p_job_id
    AND LOWER(j.submitted_by_wallet) = LOWER(p_wallet);
$$;

CREATE OR REPLACE FUNCTION public.get_vip_job_wallets(
  p_wallet text,
  p_job_id uuid
)
RETURNS TABLE(
  wallet_address text,
  status text,
  tx_hash text,
  error_message text,
  processed_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT q.wallet_address, q.status, q.tx_hash, q.error_message, q.processed_at
  FROM public.gas_load_queue q
  JOIN public.gas_load_jobs j ON j.id = q.job_id
  WHERE q.job_id = p_job_id
    AND LOWER(j.submitted_by_wallet) = LOWER(p_wallet)
  ORDER BY q.created_at ASC
  LIMIT 1000;
$$;

-- Helper: list a VIP user's recent jobs
CREATE OR REPLACE FUNCTION public.get_vip_recent_jobs(p_wallet text)
RETURNS TABLE(
  id uuid,
  total integer,
  done integer,
  failed integer,
  status text,
  batch_name text,
  created_at timestamptz,
  finished_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT j.id, j.total, j.done, j.failed, j.status, j.batch_name, j.created_at, j.finished_at
  FROM public.gas_load_jobs j
  WHERE LOWER(j.submitted_by_wallet) = LOWER(p_wallet)
  ORDER BY j.created_at DESC
  LIMIT 20;
$$;