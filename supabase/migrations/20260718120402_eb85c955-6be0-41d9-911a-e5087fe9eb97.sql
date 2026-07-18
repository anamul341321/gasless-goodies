
ALTER TABLE public.admin_settings ADD COLUMN IF NOT EXISTS daily_claim_password text NOT NULL DEFAULT 'daily2026';

CREATE OR REPLACE FUNCTION public.get_daily_claim_fingerprint()
RETURNS text
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public, extensions
AS $$
  SELECT encode(extensions.digest(daily_claim_password, 'sha256'), 'hex')
  FROM public.admin_settings
  WHERE id = 'main'
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.get_daily_claim_fingerprint() TO anon, authenticated;
