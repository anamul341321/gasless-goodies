
-- Enable pg_cron and pg_net for scheduled jobs
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

-- Auto claim jobs table
CREATE TABLE public.auto_claim_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  network TEXT NOT NULL DEFAULT 'celo',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','running','completed','stopped')),
  sponsor_key_encrypted TEXT,
  total_keys INTEGER NOT NULL DEFAULT 0,
  claimed_count INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  gas_loaded_count INTEGER NOT NULL DEFAULT 0,
  next_run_at TIMESTAMP WITH TIME ZONE,
  started_at TIMESTAMP WITH TIME ZONE,
  completed_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Auto claim keys table
CREATE TABLE public.auto_claim_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL REFERENCES public.auto_claim_jobs(id) ON DELETE CASCADE,
  private_key_encrypted TEXT NOT NULL,
  address TEXT NOT NULL,
  claim_status TEXT NOT NULL DEFAULT 'pending' CHECK (claim_status IN ('pending','claiming','claimed','gas_needed','gas_loading','gas_loaded','failed','skipped')),
  error_message TEXT,
  last_attempt_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Index for fast batch processing
CREATE INDEX idx_auto_claim_keys_job_status ON public.auto_claim_keys(job_id, claim_status);
CREATE INDEX idx_auto_claim_jobs_status ON public.auto_claim_jobs(status);

-- Enable RLS
ALTER TABLE public.auto_claim_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.auto_claim_keys ENABLE ROW LEVEL SECURITY;

-- RLS: Allow edge functions (service role) full access, no direct client access
CREATE POLICY "No direct access to auto_claim_jobs" ON public.auto_claim_jobs
  FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);

CREATE POLICY "No direct access to auto_claim_keys" ON public.auto_claim_keys
  FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
