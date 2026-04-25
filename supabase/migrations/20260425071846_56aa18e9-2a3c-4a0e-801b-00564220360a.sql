-- Add fingerprint column for device tracking
ALTER TABLE public.free_gas_usage
ADD COLUMN IF NOT EXISTS device_fingerprint text;

CREATE INDEX IF NOT EXISTS idx_free_gas_usage_fingerprint
ON public.free_gas_usage (device_fingerprint, used_on);

-- Drop old function variants and recreate with fingerprint support
DROP FUNCTION IF EXISTS public.get_free_gas_count_today(text);
DROP FUNCTION IF EXISTS public.get_free_gas_count_today(text, text[]);

CREATE OR REPLACE FUNCTION public.get_free_gas_count_today(
  p_ip text,
  p_wallets text[] DEFAULT ARRAY[]::text[],
  p_fingerprint text DEFAULT NULL
)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT COALESCE(COUNT(*)::int, 0)
  FROM public.free_gas_usage
  WHERE used_on = (now() AT TIME ZONE 'UTC')::date
    AND (
      ip_address = p_ip
      OR (p_fingerprint IS NOT NULL AND device_fingerprint = p_fingerprint)
      OR (array_length(p_wallets, 1) > 0
          AND lower(wallet_address) = ANY(SELECT lower(unnest(p_wallets))))
    );
$$;