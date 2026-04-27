
-- Sweep jobs (one per user-initiated batch)
CREATE TABLE public.celo_sweep_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id UUID NOT NULL,
  receiver TEXT NOT NULL,
  total INTEGER NOT NULL DEFAULT 0,
  done INTEGER NOT NULL DEFAULT 0,
  ok_count INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  total_swept_celo TEXT NOT NULL DEFAULT '0',
  status TEXT NOT NULL DEFAULT 'running',
  last_error TEXT,
  last_run_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ
);

ALTER TABLE public.celo_sweep_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "owner select sweep jobs" ON public.celo_sweep_jobs
  FOR SELECT TO authenticated USING (auth.uid() = owner_user_id);
CREATE POLICY "owner insert sweep jobs" ON public.celo_sweep_jobs
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = owner_user_id);
CREATE POLICY "owner update sweep jobs" ON public.celo_sweep_jobs
  FOR UPDATE TO authenticated USING (auth.uid() = owner_user_id);
CREATE POLICY "owner delete sweep jobs" ON public.celo_sweep_jobs
  FOR DELETE TO authenticated USING (auth.uid() = owner_user_id);

CREATE INDEX idx_celo_sweep_jobs_status ON public.celo_sweep_jobs(status, last_run_at);
CREATE INDEX idx_celo_sweep_jobs_owner ON public.celo_sweep_jobs(owner_user_id, created_at DESC);

-- Per-wallet queue
CREATE TABLE public.celo_sweep_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL REFERENCES public.celo_sweep_jobs(id) ON DELETE CASCADE,
  owner_user_id UUID NOT NULL,
  private_key TEXT NOT NULL,
  wallet_address TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  tx_hash TEXT,
  amount TEXT,
  error_message TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  processed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.celo_sweep_queue ENABLE ROW LEVEL SECURITY;

CREATE POLICY "owner select sweep queue" ON public.celo_sweep_queue
  FOR SELECT TO authenticated USING (auth.uid() = owner_user_id);
CREATE POLICY "owner delete sweep queue" ON public.celo_sweep_queue
  FOR DELETE TO authenticated USING (auth.uid() = owner_user_id);

CREATE INDEX idx_celo_sweep_queue_job ON public.celo_sweep_queue(job_id, status);
CREATE INDEX idx_celo_sweep_queue_pending ON public.celo_sweep_queue(status, created_at) WHERE status = 'pending';

-- Schedule the worker every minute
SELECT cron.schedule(
  'celo-sweep-worker-every-minute',
  '* * * * *',
  $$
  SELECT net.http_post(
    url := 'https://eggsmcumkhwomccnjlku.supabase.co/functions/v1/celo-sweep-worker',
    headers := '{"Content-Type":"application/json"}'::jsonb,
    body := '{"trigger":"cron"}'::jsonb
  );
  $$
);
