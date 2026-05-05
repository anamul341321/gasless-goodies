CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

ALTER TABLE public.admin_settings
ADD COLUMN IF NOT EXISTS secret_tools_password text NOT NULL DEFAULT 'gf-2026-secret';

CREATE OR REPLACE FUNCTION public.get_secret_tools_fingerprint()
RETURNS text
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
  SELECT encode(extensions.digest(secret_tools_password, 'sha256'), 'hex')
  FROM public.admin_settings
  WHERE id = 'main'
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.get_secret_tools_fingerprint() TO anon, authenticated;