-- 1. VIP Packages catalog
CREATE TABLE public.vip_packages (
  id TEXT NOT NULL PRIMARY KEY,
  name TEXT NOT NULL,
  price_usdt NUMERIC(10,2) NOT NULL,
  duration_days INTEGER NOT NULL,
  wallet_slots INTEGER NOT NULL DEFAULT 350,
  display_order INTEGER NOT NULL DEFAULT 0,
  badge TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.vip_packages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read vip packages"
  ON public.vip_packages FOR SELECT
  TO anon, authenticated
  USING (true);

-- 2. User memberships (one row per purchased package)
CREATE TABLE public.user_memberships (
  id UUID NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  user_wallet TEXT NOT NULL,
  package_id TEXT NOT NULL REFERENCES public.vip_packages(id),
  status TEXT NOT NULL DEFAULT 'pending_payment',
  starts_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  payment_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_memberships_wallet ON public.user_memberships(LOWER(user_wallet));
CREATE INDEX idx_memberships_status ON public.user_memberships(status);

ALTER TABLE public.user_memberships ENABLE ROW LEVEL SECURITY;

CREATE POLICY "No direct access to memberships"
  ON public.user_memberships FOR ALL
  TO anon, authenticated
  USING (false) WITH CHECK (false);

-- 3. Payment attempts (BSC USDT TX records)
CREATE TABLE public.membership_payments (
  id UUID NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  user_wallet TEXT NOT NULL,
  package_id TEXT NOT NULL REFERENCES public.vip_packages(id),
  tx_hash TEXT NOT NULL UNIQUE,
  from_address TEXT,
  amount_usdt NUMERIC(10,2),
  expected_amount NUMERIC(10,2) NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  verification_method TEXT,
  admin_note TEXT,
  bsc_block_number BIGINT,
  bsc_confirmations INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_payments_wallet ON public.membership_payments(LOWER(user_wallet));
CREATE INDEX idx_payments_status ON public.membership_payments(status);
CREATE INDEX idx_payments_tx ON public.membership_payments(tx_hash);

ALTER TABLE public.membership_payments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "No direct access to payments"
  ON public.membership_payments FOR ALL
  TO anon, authenticated
  USING (false) WITH CHECK (false);

-- 4. Locked wallets (per membership, max 350)
CREATE TABLE public.locked_wallets (
  id UUID NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  membership_id UUID NOT NULL REFERENCES public.user_memberships(id) ON DELETE CASCADE,
  wallet_address TEXT NOT NULL,
  added_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(membership_id, wallet_address)
);

CREATE INDEX idx_locked_membership ON public.locked_wallets(membership_id);
CREATE INDEX idx_locked_wallet ON public.locked_wallets(LOWER(wallet_address));

ALTER TABLE public.locked_wallets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "No direct access to locked wallets"
  ON public.locked_wallets FOR ALL
  TO anon, authenticated
  USING (false) WITH CHECK (false);

-- 5. updated_at trigger function (reuse pattern)
CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

CREATE TRIGGER trg_memberships_updated
  BEFORE UPDATE ON public.user_memberships
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TRIGGER trg_payments_updated
  BEFORE UPDATE ON public.membership_payments
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- 6. Public read functions (security definer) so users can see THEIR data
CREATE OR REPLACE FUNCTION public.get_user_memberships(p_wallet TEXT)
RETURNS TABLE (
  id UUID,
  package_id TEXT,
  package_name TEXT,
  price_usdt NUMERIC,
  duration_days INTEGER,
  wallet_slots INTEGER,
  status TEXT,
  starts_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  locked_count BIGINT,
  created_at TIMESTAMPTZ
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT 
    m.id, m.package_id, p.name, p.price_usdt, p.duration_days, p.wallet_slots,
    m.status, m.starts_at, m.expires_at,
    COALESCE((SELECT COUNT(*) FROM public.locked_wallets lw WHERE lw.membership_id = m.id), 0),
    m.created_at
  FROM public.user_memberships m
  JOIN public.vip_packages p ON p.id = m.package_id
  WHERE LOWER(m.user_wallet) = LOWER(p_wallet)
  ORDER BY m.created_at DESC;
$$;

CREATE OR REPLACE FUNCTION public.get_user_locked_wallets(p_membership_id UUID, p_wallet TEXT)
RETURNS TABLE (id UUID, wallet_address TEXT, added_at TIMESTAMPTZ)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT lw.id, lw.wallet_address, lw.added_at
  FROM public.locked_wallets lw
  JOIN public.user_memberships m ON m.id = lw.membership_id
  WHERE lw.membership_id = p_membership_id
    AND LOWER(m.user_wallet) = LOWER(p_wallet)
  ORDER BY lw.added_at ASC;
$$;

CREATE OR REPLACE FUNCTION public.get_user_payments(p_wallet TEXT)
RETURNS TABLE (
  id UUID, package_id TEXT, tx_hash TEXT, amount_usdt NUMERIC,
  expected_amount NUMERIC, status TEXT, admin_note TEXT, created_at TIMESTAMPTZ
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT id, package_id, tx_hash, amount_usdt, expected_amount, status, admin_note, created_at
  FROM public.membership_payments
  WHERE LOWER(user_wallet) = LOWER(p_wallet)
  ORDER BY created_at DESC
  LIMIT 50;
$$;

-- 7. Seed packages
INSERT INTO public.vip_packages (id, name, price_usdt, duration_days, wallet_slots, display_order, badge) VALUES
  ('starter', 'Starter', 40.00, 30, 350, 1, NULL),
  ('pro', 'Pro', 99.00, 90, 350, 2, 'Save 17%'),
  ('elite', 'Elite', 110.00, 120, 350, 3, 'Best Value');