
CREATE TABLE public.claim_stats (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  wallet_address TEXT NOT NULL,
  network TEXT NOT NULL DEFAULT 'celo',
  g_dollar_amount TEXT DEFAULT '0',
  claim_source TEXT NOT NULL DEFAULT 'connected_wallet',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.claim_stats ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can insert claim stats"
ON public.claim_stats FOR INSERT
WITH CHECK (true);

CREATE POLICY "Anyone can view claim stats"
ON public.claim_stats FOR SELECT
USING (true);

CREATE INDEX idx_claim_stats_wallet ON public.claim_stats (wallet_address);
CREATE INDEX idx_claim_stats_created ON public.claim_stats (created_at);
