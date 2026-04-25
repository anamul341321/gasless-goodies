-- Update count function: count distinct usage by IP OR wallet (whichever matches today)
CREATE OR REPLACE FUNCTION public.get_free_gas_count_today(p_ip text, p_wallets text[] DEFAULT ARRAY[]::text[])
RETURNS INTEGER
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(COUNT(*)::int, 0)
  FROM public.free_gas_usage
  WHERE used_on = (now() AT TIME ZONE 'UTC')::date
    AND (
      ip_address = p_ip
      OR (array_length(p_wallets, 1) > 0 AND lower(wallet_address) = ANY(SELECT lower(unnest(p_wallets))))
    );
$$;