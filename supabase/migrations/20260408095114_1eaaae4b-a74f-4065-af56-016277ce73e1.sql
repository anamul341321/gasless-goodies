ALTER TABLE public.auto_claim_jobs 
  ADD COLUMN IF NOT EXISTS batch_size integer NOT NULL DEFAULT 300,
  ADD COLUMN IF NOT EXISTS interval_hours numeric NOT NULL DEFAULT 2,
  ADD COLUMN IF NOT EXISTS end_time timestamptz,
  ADD COLUMN IF NOT EXISTS total_gas_spent text NOT NULL DEFAULT '0',
  ADD COLUMN IF NOT EXISTS skipped_count integer NOT NULL DEFAULT 0;