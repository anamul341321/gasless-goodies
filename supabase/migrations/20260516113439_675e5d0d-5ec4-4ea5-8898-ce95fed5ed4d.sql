
ALTER TABLE public.daily_claim_wallets ADD COLUMN IF NOT EXISTS network text NOT NULL DEFAULT 'celo';
ALTER TABLE public.daily_claim_runs ADD COLUMN IF NOT EXISTS network text NOT NULL DEFAULT 'celo';
ALTER TABLE public.daily_claim_run_items ADD COLUMN IF NOT EXISTS network text NOT NULL DEFAULT 'celo';

ALTER TABLE public.daily_claim_wallets
  DROP CONSTRAINT IF EXISTS daily_claim_wallets_owner_user_id_wallet_address_key;
ALTER TABLE public.daily_claim_wallets
  ADD CONSTRAINT daily_claim_wallets_owner_addr_net_key UNIQUE (owner_user_id, wallet_address, network);

ALTER TABLE public.daily_claim_runs
  DROP CONSTRAINT IF EXISTS daily_claim_runs_owner_user_id_run_date_key;
ALTER TABLE public.daily_claim_runs
  ADD CONSTRAINT daily_claim_runs_owner_date_net_key UNIQUE (owner_user_id, run_date, network);

CREATE INDEX IF NOT EXISTS idx_dcw_owner_net ON public.daily_claim_wallets(owner_user_id, network);
CREATE INDEX IF NOT EXISTS idx_dcr_owner_net_date ON public.daily_claim_runs(owner_user_id, network, run_date DESC);
