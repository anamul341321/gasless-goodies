-- 1. Profiles table (linked to auth.users)
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name TEXT,
  email TEXT,
  avatar_url TEXT,
  wallet_address TEXT UNIQUE,
  auth_method TEXT NOT NULL DEFAULT 'email',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own profile" ON public.profiles
  FOR SELECT TO authenticated USING (auth.uid() = id);

CREATE POLICY "Users can update own profile" ON public.profiles
  FOR UPDATE TO authenticated USING (auth.uid() = id);

CREATE POLICY "Users can insert own profile" ON public.profiles
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = id);

CREATE TRIGGER touch_profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Auto-create profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, email, display_name, avatar_url, auth_method)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name', split_part(NEW.email, '@', 1)),
    NEW.raw_user_meta_data->>'avatar_url',
    CASE
      WHEN NEW.raw_user_meta_data->>'provider' = 'google' THEN 'google'
      WHEN NEW.raw_user_meta_data->>'auth_method' = 'wallet' THEN 'wallet'
      ELSE 'email'
    END
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- 2. SIWE nonce table for wallet login
CREATE TABLE public.siwe_nonces (
  nonce TEXT PRIMARY KEY,
  wallet_address TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '10 minutes'),
  used BOOLEAN NOT NULL DEFAULT false
);

ALTER TABLE public.siwe_nonces ENABLE ROW LEVEL SECURITY;

CREATE POLICY "No direct access to siwe_nonces" ON public.siwe_nonces
  FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);

-- 3. Add owner_user_id to gd_claim_jobs (nullable for legacy/anonymous batches)
ALTER TABLE public.gd_claim_jobs
  ADD COLUMN owner_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN owner_label TEXT;

CREATE INDEX idx_gd_claim_jobs_owner ON public.gd_claim_jobs(owner_user_id) WHERE owner_user_id IS NOT NULL;

-- 4. Update get_gd_claim_wallets to require auth for failed-with-key access
DROP FUNCTION IF EXISTS public.get_gd_claim_wallets(uuid);

CREATE OR REPLACE FUNCTION public.get_gd_claim_wallets(p_job_id uuid, p_requester uuid DEFAULT NULL)
 RETURNS TABLE(wallet_address text, status text, tx_hash text, error_message text, gas_requests integer, processed_at timestamp with time zone, private_key text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $$
  SELECT q.wallet_address, q.status, q.tx_hash, q.error_message,
         q.gas_requests, q.processed_at,
         CASE
           -- Owner of the job (logged in) gets the key
           WHEN q.status = 'failed' AND q.private_key IS NOT NULL
                AND EXISTS (
                  SELECT 1 FROM public.gd_claim_jobs j
                  WHERE j.id = q.job_id
                    AND j.owner_user_id IS NOT NULL
                    AND j.owner_user_id = p_requester
                )
           THEN q.private_key
           -- Legacy anonymous batches: keep old behavior (visible to all)
           WHEN q.status = 'failed' AND q.gas_requests > 0 AND q.private_key IS NOT NULL
                AND EXISTS (
                  SELECT 1 FROM public.gd_claim_jobs j
                  WHERE j.id = q.job_id AND j.owner_user_id IS NULL
                )
           THEN q.private_key
           ELSE NULL
         END AS private_key
  FROM public.gd_claim_queue q
  WHERE q.job_id = p_job_id
  ORDER BY q.created_at ASC
  LIMIT 2000;
$$;

-- 5. Function to get current user's batches
CREATE OR REPLACE FUNCTION public.get_my_gd_claim_batches()
 RETURNS TABLE(id uuid, batch_name text, total integer, done integer, failed integer, needs_gas integer, status text, created_at timestamp with time zone, finished_at timestamp with time zone, failed_with_keys bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $$
  SELECT
    j.id, j.batch_name, j.total, j.done, j.failed, j.needs_gas,
    j.status, j.created_at, j.finished_at,
    COALESCE((
      SELECT COUNT(*)::bigint FROM public.gd_claim_queue q
      WHERE q.job_id = j.id AND q.status = 'failed' AND q.private_key IS NOT NULL
    ), 0) AS failed_with_keys
  FROM public.gd_claim_jobs j
  WHERE j.owner_user_id = auth.uid()
  ORDER BY j.created_at DESC
  LIMIT 200;
$$;

-- 6. Function for user to delete a stored key (manual cleanup)
CREATE OR REPLACE FUNCTION public.delete_my_failed_key(p_job_id uuid, p_wallet_address text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
DECLARE
  is_owner boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM public.gd_claim_jobs
    WHERE id = p_job_id AND owner_user_id = auth.uid()
  ) INTO is_owner;

  IF NOT is_owner THEN
    RETURN false;
  END IF;

  UPDATE public.gd_claim_queue
  SET private_key = NULL, updated_at = now()
  WHERE job_id = p_job_id
    AND lower(wallet_address) = lower(p_wallet_address)
    AND status = 'failed';

  RETURN true;
END;
$$;