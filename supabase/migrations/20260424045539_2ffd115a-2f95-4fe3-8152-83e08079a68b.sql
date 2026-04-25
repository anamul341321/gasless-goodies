CREATE TABLE public.gas_load_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_address TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('success', 'failed', 'pending')),
  tx_hash TEXT,
  proxy_ip TEXT,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.gas_load_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "No direct access to gas_load_history"
  ON public.gas_load_history
  FOR ALL
  USING (false)
  WITH CHECK (false);

CREATE INDEX idx_gas_load_history_created_at ON public.gas_load_history(created_at DESC);
CREATE INDEX idx_gas_load_history_wallet ON public.gas_load_history(wallet_address);