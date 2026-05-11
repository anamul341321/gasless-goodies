
-- Saved wallets (private keys encrypted at rest with DAILY_CLAIM_ENCRYPTION_KEY)
CREATE TABLE public.daily_claim_wallets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL,
  wallet_address text NOT NULL,
  encrypted_key text NOT NULL,
  label text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_user_id, wallet_address)
);
CREATE INDEX idx_dcw_owner ON public.daily_claim_wallets(owner_user_id);

ALTER TABLE public.daily_claim_wallets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owner select dcw" ON public.daily_claim_wallets FOR SELECT TO authenticated USING (auth.uid() = owner_user_id);
CREATE POLICY "owner insert dcw" ON public.daily_claim_wallets FOR INSERT TO authenticated WITH CHECK (auth.uid() = owner_user_id);
CREATE POLICY "owner update dcw" ON public.daily_claim_wallets FOR UPDATE TO authenticated USING (auth.uid() = owner_user_id);
CREATE POLICY "owner delete dcw" ON public.daily_claim_wallets FOR DELETE TO authenticated USING (auth.uid() = owner_user_id);

CREATE TRIGGER trg_dcw_touch BEFORE UPDATE ON public.daily_claim_wallets
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Per-day runs (one per user per UTC date)
CREATE TABLE public.daily_claim_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL,
  run_date date NOT NULL,
  phase text NOT NULL DEFAULT 'claiming', -- claiming|gas_requesting|waiting_30m|retrying|completed|failed
  total int NOT NULL DEFAULT 0,
  success int NOT NULL DEFAULT 0,
  failed_gas int NOT NULL DEFAULT 0,
  failed_other int NOT NULL DEFAULT 0,
  final_failed int NOT NULL DEFAULT 0,
  started_at timestamptz NOT NULL DEFAULT now(),
  phase1_done_at timestamptz,
  gas_requests_done_at timestamptz,
  retry_started_at timestamptz,
  finished_at timestamptz,
  last_error text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_user_id, run_date)
);
CREATE INDEX idx_dcr_owner_date ON public.daily_claim_runs(owner_user_id, run_date DESC);
CREATE INDEX idx_dcr_phase ON public.daily_claim_runs(phase);

ALTER TABLE public.daily_claim_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owner select dcr" ON public.daily_claim_runs FOR SELECT TO authenticated USING (auth.uid() = owner_user_id);

CREATE TRIGGER trg_dcr_touch BEFORE UPDATE ON public.daily_claim_runs
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Per-wallet items for each run
CREATE TABLE public.daily_claim_run_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES public.daily_claim_runs(id) ON DELETE CASCADE,
  owner_user_id uuid NOT NULL,
  wallet_address text NOT NULL,
  encrypted_key text, -- erased on success
  phase1_status text NOT NULL DEFAULT 'pending', -- pending|claiming|success|failed_gas|failed_kyc|failed_other|already_claimed
  phase1_tx text,
  phase1_error text,
  gas_request_status text, -- pending|requested|done|skipped|error
  gas_tx text,
  gas_requested_at timestamptz,
  phase2_status text, -- pending|claiming|success|failed_gas|failed_kyc|failed_other|already_claimed
  phase2_tx text,
  phase2_error text,
  final_status text NOT NULL DEFAULT 'pending', -- pending|success|failed_gas|failed_kyc|failed_other|already_claimed
  attempts int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_dcri_run ON public.daily_claim_run_items(run_id);
CREATE INDEX idx_dcri_owner ON public.daily_claim_run_items(owner_user_id);
CREATE INDEX idx_dcri_phase1 ON public.daily_claim_run_items(phase1_status);
CREATE INDEX idx_dcri_final ON public.daily_claim_run_items(final_status);

ALTER TABLE public.daily_claim_run_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owner select dcri" ON public.daily_claim_run_items FOR SELECT TO authenticated USING (auth.uid() = owner_user_id);

CREATE TRIGGER trg_dcri_touch BEFORE UPDATE ON public.daily_claim_run_items
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
