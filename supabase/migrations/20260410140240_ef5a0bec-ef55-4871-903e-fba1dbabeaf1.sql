
-- Create recharge_requests table
CREATE TABLE public.recharge_requests (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  phone_number TEXT NOT NULL,
  operator TEXT NOT NULL,
  amount_gd TEXT NOT NULL DEFAULT '0',
  amount_bdt NUMERIC NOT NULL DEFAULT 0,
  network TEXT NOT NULL DEFAULT 'celo',
  wallet_address TEXT NOT NULL,
  tx_hash TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  admin_note TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.recharge_requests ENABLE ROW LEVEL SECURITY;

-- Public can read all requests (needed for status checking by wallet)
CREATE POLICY "Anyone can read recharge requests"
ON public.recharge_requests
FOR SELECT
USING (true);

-- No direct inserts/updates/deletes from client
CREATE POLICY "No direct writes to recharge requests"
ON public.recharge_requests
FOR ALL
TO anon, authenticated
USING (false)
WITH CHECK (false);
