
DROP POLICY "Service role can update admin settings" ON public.admin_settings;

CREATE POLICY "No direct updates allowed"
ON public.admin_settings
FOR UPDATE
TO anon, authenticated
USING (false)
WITH CHECK (false);
