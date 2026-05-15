ALTER TABLE public.gas_load_jobs
  ADD COLUMN IF NOT EXISTS network text NOT NULL DEFAULT 'celo';

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'gas_load_jobs_network_check'
  ) THEN
    ALTER TABLE public.gas_load_jobs
      ADD CONSTRAINT gas_load_jobs_network_check
      CHECK (network IN ('celo','xdc'));
  END IF;
END $$;