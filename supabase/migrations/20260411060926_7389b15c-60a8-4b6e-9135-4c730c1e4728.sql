DROP TABLE IF EXISTS public.auto_claim_keys CASCADE;
DROP TABLE IF EXISTS public.auto_claim_jobs CASCADE;

ALTER TABLE public.admin_settings
  DROP COLUMN IF EXISTS batch_claim_enabled,
  DROP COLUMN IF EXISTS gas_load_enabled,
  DROP COLUMN IF EXISTS sponsor_private_key;

DROP POLICY IF EXISTS "Anyone can read recharge requests" ON public.recharge_requests;

CREATE POLICY "No direct reads to recharge requests"
ON public.recharge_requests
FOR SELECT
TO anon, authenticated
USING (false);