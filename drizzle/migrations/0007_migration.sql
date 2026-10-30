ALTER TABLE public.gas_load_jobs DROP CONSTRAINT IF EXISTS gas_load_jobs_network_check;
ALTER TABLE public.gas_load_jobs ADD CONSTRAINT gas_load_jobs_network_check CHECK (network = ANY (ARRAY['celo','xdc','fuse']));
ALTER TABLE public.daily_claim_settings DROP CONSTRAINT IF EXISTS daily_claim_settings_network_check;
ALTER TABLE public.daily_claim_settings ADD CONSTRAINT daily_claim_settings_network_check CHECK (network = ANY (ARRAY['celo','xdc','fuse']));