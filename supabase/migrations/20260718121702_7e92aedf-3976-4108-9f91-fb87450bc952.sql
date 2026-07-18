UPDATE public.admin_settings SET secret_tools_password = 'Amarboumunni', updated_at = now() WHERE id = 'main';
ALTER PUBLICATION supabase_realtime ADD TABLE public.admin_settings;