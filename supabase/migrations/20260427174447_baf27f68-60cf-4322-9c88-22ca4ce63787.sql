CREATE TABLE public.farmer_wallets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  wallet_address text NOT NULL,
  private_key text NOT NULL,
  gd_tx_hash text,
  gd_status text NOT NULL DEFAULT 'pending',
  gd_error text,
  faucet_tx_hash text,
  faucet_status text NOT NULL DEFAULT 'pending',
  faucet_error text,
  faucet_ip text,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX idx_farmer_wallets_owner_created ON public.farmer_wallets(owner_user_id, created_at DESC);

ALTER TABLE public.farmer_wallets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own farmed wallets"
  ON public.farmer_wallets
  FOR SELECT
  TO authenticated
  USING (auth.uid() = owner_user_id);

CREATE POLICY "Users can delete their own farmed wallets"
  ON public.farmer_wallets
  FOR DELETE
  TO authenticated
  USING (auth.uid() = owner_user_id);