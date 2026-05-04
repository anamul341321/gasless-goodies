-- Bulk G$ send jobs
CREATE TABLE public.gd_bulk_jobs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  sender_address TEXT NOT NULL,
  sender_key_encrypted TEXT NOT NULL,
  amount_per_recipient TEXT NOT NULL,
  total INTEGER NOT NULL DEFAULT 0,
  sent INTEGER NOT NULL DEFAULT 0,
  failed INTEGER NOT NULL DEFAULT 0,
  skipped INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending',
  approve_tx TEXT,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ
);

ALTER TABLE public.gd_bulk_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "No direct access to gd_bulk_jobs"
ON public.gd_bulk_jobs FOR ALL
USING (false) WITH CHECK (false);

CREATE INDEX idx_gd_bulk_jobs_status ON public.gd_bulk_jobs(status);
CREATE INDEX idx_gd_bulk_jobs_sender ON public.gd_bulk_jobs(sender_address);

CREATE TRIGGER trg_gd_bulk_jobs_updated
BEFORE UPDATE ON public.gd_bulk_jobs
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Per-recipient tracking
CREATE TABLE public.gd_bulk_recipients (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  job_id UUID NOT NULL REFERENCES public.gd_bulk_jobs(id) ON DELETE CASCADE,
  sender_address TEXT NOT NULL,
  wallet_address TEXT NOT NULL,
  amount TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  tx_hash TEXT,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at TIMESTAMPTZ
);

ALTER TABLE public.gd_bulk_recipients ENABLE ROW LEVEL SECURITY;

CREATE POLICY "No direct access to gd_bulk_recipients"
ON public.gd_bulk_recipients FOR ALL
USING (false) WITH CHECK (false);

CREATE INDEX idx_gd_bulk_recipients_job ON public.gd_bulk_recipients(job_id, status);
CREATE INDEX idx_gd_bulk_recipients_dedupe
  ON public.gd_bulk_recipients(sender_address, wallet_address, amount, status);

CREATE TRIGGER trg_gd_bulk_recipients_updated
BEFORE UPDATE ON public.gd_bulk_recipients
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();