ALTER TABLE public.daily_claim_settings 
ADD COLUMN IF NOT EXISTS retry_wait_minutes integer NOT NULL DEFAULT 30 
  CHECK (retry_wait_minutes >= 1 AND retry_wait_minutes <= 240);