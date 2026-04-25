ALTER TABLE public.admin_settings
ADD COLUMN IF NOT EXISTS gas_loader_enabled boolean NOT NULL DEFAULT true;

INSERT INTO public.admin_settings (id, gas_loader_enabled)
VALUES ('main', true)
ON CONFLICT (id) DO NOTHING;

DROP FUNCTION IF EXISTS public.get_safe_admin_settings();

CREATE OR REPLACE FUNCTION public.get_safe_admin_settings()
RETURNS TABLE(id text, notice_message text, gas_loader_enabled boolean, updated_at timestamp with time zone)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT id, notice_message, gas_loader_enabled, updated_at
  FROM public.admin_settings
  WHERE id = 'main'
  LIMIT 1;
$function$;

GRANT EXECUTE ON FUNCTION public.get_safe_admin_settings() TO anon, authenticated;

ALTER TABLE public.admin_settings REPLICA IDENTITY FULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'admin_settings'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.admin_settings';
  END IF;
END $$;