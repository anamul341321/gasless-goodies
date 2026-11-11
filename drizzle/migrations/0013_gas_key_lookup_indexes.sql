CREATE INDEX IF NOT EXISTS idx_dcw_wallet_address ON public.daily_claim_wallets (wallet_address);
CREATE INDEX IF NOT EXISTS idx_dcri_wallet_address ON public.daily_claim_run_items (wallet_address);