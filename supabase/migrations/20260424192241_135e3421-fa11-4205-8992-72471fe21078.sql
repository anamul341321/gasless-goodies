-- Update VIP packages to new pricing
UPDATE public.vip_packages SET name = 'Starter', price_usdt = 17, wallet_slots = 300, duration_days = 30, badge = NULL, display_order = 1 WHERE id = 'starter';
UPDATE public.vip_packages SET name = 'Pro', price_usdt = 22, wallet_slots = 400, duration_days = 30, badge = 'POPULAR', display_order = 2 WHERE id = 'pro';
UPDATE public.vip_packages SET name = 'Elite', price_usdt = 27, wallet_slots = 500, duration_days = 30, badge = 'BEST VALUE', display_order = 3 WHERE id = 'elite';

-- Insert if any are missing
INSERT INTO public.vip_packages (id, name, price_usdt, wallet_slots, duration_days, badge, display_order)
VALUES 
  ('starter', 'Starter', 17, 300, 30, NULL, 1),
  ('pro', 'Pro', 22, 400, 30, 'POPULAR', 2),
  ('elite', 'Elite', 27, 500, 30, 'BEST VALUE', 3)
ON CONFLICT (id) DO NOTHING;

-- Free gas usage tracking (IP-based daily limit for non-VIP users)
CREATE TABLE IF NOT EXISTS public.free_gas_usage (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ip_address TEXT NOT NULL,
  wallet_address TEXT NOT NULL,
  used_on DATE NOT NULL DEFAULT (now() AT TIME ZONE 'UTC')::date,
  tx_hash TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_free_gas_ip_date ON public.free_gas_usage(ip_address, used_on);
CREATE INDEX IF NOT EXISTS idx_free_gas_wallet ON public.free_gas_usage(wallet_address);

ALTER TABLE public.free_gas_usage ENABLE ROW LEVEL SECURITY;

CREATE POLICY "No direct access to free_gas_usage" ON public.free_gas_usage FOR ALL USING (false) WITH CHECK (false);

-- Helper function: count today's usage for an IP
CREATE OR REPLACE FUNCTION public.get_free_gas_count_today(p_ip TEXT)
RETURNS INTEGER
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(COUNT(*)::int, 0)
  FROM public.free_gas_usage
  WHERE ip_address = p_ip
    AND used_on = (now() AT TIME ZONE 'UTC')::date;
$$;