
DROP FUNCTION IF EXISTS public.get_safe_admin_settings();

CREATE OR REPLACE FUNCTION public.get_safe_admin_settings()
 RETURNS TABLE(id text, show_claim_stats boolean, notice_message text, updated_at timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $$
  SELECT id, show_claim_stats, notice_message, updated_at
  FROM public.admin_settings
  WHERE id = 'main'
  LIMIT 1;
$$;
