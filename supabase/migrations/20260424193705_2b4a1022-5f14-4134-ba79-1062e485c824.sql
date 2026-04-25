ALTER TABLE public.admin_settings
ADD COLUMN IF NOT EXISTS mobile_recharge_enabled boolean NOT NULL DEFAULT true;

DROP FUNCTION IF EXISTS public.get_safe_admin_settings();

CREATE OR REPLACE FUNCTION public.get_safe_admin_settings()
RETURNS TABLE(id text, notice_message text, gas_loader_enabled boolean, mobile_recharge_enabled boolean, updated_at timestamp with time zone)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT id, notice_message, gas_loader_enabled, mobile_recharge_enabled, updated_at
  FROM public.admin_settings
  WHERE id = 'main'
  LIMIT 1;
$function$;

GRANT EXECUTE ON FUNCTION public.get_safe_admin_settings() TO anon, authenticated;