-- Drop existing permissive SELECT policy
DROP POLICY IF EXISTS "Anyone can read admin settings" ON public.admin_settings;

-- Create a new SELECT policy that hides sponsor_private_key
-- We use a security definer function to serve safe data
CREATE OR REPLACE FUNCTION public.get_safe_admin_settings()
RETURNS TABLE (
  id text,
  batch_claim_enabled boolean,
  gas_load_enabled boolean,
  show_claim_stats boolean,
  notice_message text,
  updated_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id, batch_claim_enabled, gas_load_enabled, show_claim_stats, notice_message, updated_at
  FROM public.admin_settings
  WHERE id = 'main'
  LIMIT 1;
$$;

-- Create a restrictive SELECT policy that only allows reading non-sensitive columns
-- Since we can't do column-level RLS, we'll block direct table access and use the function
CREATE POLICY "Block direct read of admin settings"
ON public.admin_settings
FOR SELECT
TO anon, authenticated
USING (false);