ALTER TABLE public.gas_load_jobs 
ADD COLUMN IF NOT EXISTS retry_round integer NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS max_retries integer NOT NULL DEFAULT 2;

CREATE INDEX IF NOT EXISTS idx_gas_load_queue_job_status 
ON public.gas_load_queue(job_id, status);