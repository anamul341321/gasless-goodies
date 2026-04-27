-- Background farmer jobs
CREATE TABLE public.farmer_jobs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  owner_user_id UUID NOT NULL,
  funder_key TEXT NOT NULL,
  g_amount TEXT NOT NULL DEFAULT '0.5',
  status TEXT NOT NULL DEFAULT 'running', -- running | stopped
  ok_count INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  last_run_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.farmer_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own farmer jobs"
  ON public.farmer_jobs FOR SELECT
  TO authenticated
  USING (auth.uid() = owner_user_id);

CREATE POLICY "Users can insert their own farmer jobs"
  ON public.farmer_jobs FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = owner_user_id);

CREATE POLICY "Users can update their own farmer jobs"
  ON public.farmer_jobs FOR UPDATE
  TO authenticated
  USING (auth.uid() = owner_user_id);

CREATE POLICY "Users can delete their own farmer jobs"
  ON public.farmer_jobs FOR DELETE
  TO authenticated
  USING (auth.uid() = owner_user_id);

CREATE INDEX idx_farmer_jobs_status ON public.farmer_jobs(status, last_run_at);
CREATE INDEX idx_farmer_jobs_owner ON public.farmer_jobs(owner_user_id);

CREATE TRIGGER trg_farmer_jobs_updated_at
  BEFORE UPDATE ON public.farmer_jobs
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();