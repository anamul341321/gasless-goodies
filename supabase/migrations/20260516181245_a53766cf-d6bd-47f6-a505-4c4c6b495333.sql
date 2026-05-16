
CREATE TABLE IF NOT EXISTS public.daily_claim_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL,
  network text NOT NULL DEFAULT 'celo',
  start_hour_bd smallint NOT NULL DEFAULT 0,
  start_minute_bd smallint NOT NULL DEFAULT 0,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(owner_user_id, network),
  CHECK (start_hour_bd BETWEEN 0 AND 23),
  CHECK (start_minute_bd BETWEEN 0 AND 59),
  CHECK (network IN ('celo','xdc'))
);

ALTER TABLE public.daily_claim_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "owner select dcs" ON public.daily_claim_settings
  FOR SELECT TO authenticated USING (auth.uid() = owner_user_id);
CREATE POLICY "owner insert dcs" ON public.daily_claim_settings
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = owner_user_id);
CREATE POLICY "owner update dcs" ON public.daily_claim_settings
  FOR UPDATE TO authenticated USING (auth.uid() = owner_user_id);
CREATE POLICY "owner delete dcs" ON public.daily_claim_settings
  FOR DELETE TO authenticated USING (auth.uid() = owner_user_id);

CREATE INDEX IF NOT EXISTS idx_dcs_time ON public.daily_claim_settings(start_hour_bd, start_minute_bd) WHERE enabled = true;
