
-- Revoke column-level SELECT on sponsor_private_key from anon and authenticated roles
REVOKE SELECT (sponsor_private_key) ON public.admin_settings FROM anon, authenticated;

-- Remove the overly permissive public INSERT policy on claim_stats
DROP POLICY IF EXISTS "Anyone can insert claim stats" ON public.claim_stats;

-- Remove Realtime publication for admin_settings to prevent leaking changes
ALTER PUBLICATION supabase_realtime DROP TABLE public.admin_settings;
