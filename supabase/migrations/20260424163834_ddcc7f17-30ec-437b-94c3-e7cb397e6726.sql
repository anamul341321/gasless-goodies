-- Drop the blocking SELECT policy so realtime subscriptions and direct reads work
DROP POLICY IF EXISTS "Block direct read of admin settings" ON public.admin_settings;

-- Allow everyone (anon + authenticated) to read the single public settings row
CREATE POLICY "Public can read admin settings"
ON public.admin_settings
FOR SELECT
TO anon, authenticated
USING (id = 'main');