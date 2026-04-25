-- GoodDollar batch claim jobs
CREATE TABLE public.gd_claim_jobs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  batch_name TEXT NOT NULL DEFAULT 'Unnamed',
  total INTEGER NOT NULL DEFAULT 0,
  done INTEGER NOT NULL DEFAULT 0,
  failed INTEGER NOT NULL DEFAULT 0,
  needs_gas INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending',
  delay_ms INTEGER NOT NULL DEFAULT 10000,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ
);

-- GoodDollar batch claim queue (one row per wallet)
CREATE TABLE public.gd_claim_queue (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  job_id UUID NOT NULL REFERENCES public.gd_claim_jobs(id) ON DELETE CASCADE,
  wallet_address TEXT NOT NULL,
  private_key TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  tx_hash TEXT,
  error_message TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  gas_requests INTEGER NOT NULL DEFAULT 0,
  last_gas_request_at TIMESTAMPTZ,
  processed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_gd_claim_queue_job ON public.gd_claim_queue(job_id);
CREATE INDEX idx_gd_claim_queue_status ON public.gd_claim_queue(status);
CREATE INDEX idx_gd_claim_queue_pending_created ON public.gd_claim_queue(created_at) WHERE status = 'pending';

ALTER TABLE public.gd_claim_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gd_claim_queue ENABLE ROW LEVEL SECURITY;

CREATE POLICY "No direct access to gd_claim_jobs"
  ON public.gd_claim_jobs FOR ALL TO public USING (false) WITH CHECK (false);

CREATE POLICY "No direct access to gd_claim_queue"
  ON public.gd_claim_queue FOR ALL TO public USING (false) WITH CHECK (false);

CREATE TRIGGER trg_gd_claim_jobs_updated
  BEFORE UPDATE ON public.gd_claim_jobs
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TRIGGER trg_gd_claim_queue_updated
  BEFORE UPDATE ON public.gd_claim_queue
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Public-safe status function (no private keys exposed)
CREATE OR REPLACE FUNCTION public.get_gd_claim_status(p_job_id UUID)
RETURNS TABLE(
  id UUID,
  batch_name TEXT,
  total INTEGER,
  done INTEGER,
  failed INTEGER,
  needs_gas INTEGER,
  status TEXT,
  created_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT j.id, j.batch_name, j.total, j.done, j.failed, j.needs_gas,
         j.status, j.created_at, j.finished_at
  FROM public.gd_claim_jobs j
  WHERE j.id = p_job_id
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.get_gd_claim_wallets(p_job_id UUID)
RETURNS TABLE(
  wallet_address TEXT,
  status TEXT,
  tx_hash TEXT,
  error_message TEXT,
  gas_requests INTEGER,
  processed_at TIMESTAMPTZ
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT q.wallet_address, q.status, q.tx_hash, q.error_message,
         q.gas_requests, q.processed_at
  FROM public.gd_claim_queue q
  WHERE q.job_id = p_job_id
  ORDER BY q.created_at ASC
  LIMIT 2000;
$$;