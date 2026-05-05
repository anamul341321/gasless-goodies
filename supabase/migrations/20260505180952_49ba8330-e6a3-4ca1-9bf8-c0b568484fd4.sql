INSERT INTO public.admin_settings (id, secret_tools_password, gas_loader_enabled, mobile_recharge_enabled, notice_message)
VALUES ('main', 'Amarboumunni', true, true, '')
ON CONFLICT (id) DO UPDATE SET secret_tools_password = EXCLUDED.secret_tools_password, updated_at = now();