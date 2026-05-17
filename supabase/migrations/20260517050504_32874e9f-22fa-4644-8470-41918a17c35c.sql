
-- 1) Groups table
CREATE TABLE public.daily_claim_groups (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  owner_user_id uuid NOT NULL,
  network text NOT NULL DEFAULT 'celo',
  name text NOT NULL DEFAULT 'Group',
  start_hour_bd smallint NOT NULL DEFAULT 0,
  start_minute_bd smallint NOT NULL DEFAULT 0,
  retry_wait_minutes integer NOT NULL DEFAULT 30,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_dcg_owner_net ON public.daily_claim_groups(owner_user_id, network);

ALTER TABLE public.daily_claim_groups ENABLE ROW LEVEL SECURITY;

CREATE POLICY "owner select dcg" ON public.daily_claim_groups
  FOR SELECT TO authenticated USING (auth.uid() = owner_user_id);
CREATE POLICY "owner insert dcg" ON public.daily_claim_groups
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = owner_user_id);
CREATE POLICY "owner update dcg" ON public.daily_claim_groups
  FOR UPDATE TO authenticated USING (auth.uid() = owner_user_id);
CREATE POLICY "owner delete dcg" ON public.daily_claim_groups
  FOR DELETE TO authenticated USING (auth.uid() = owner_user_id);

CREATE TRIGGER trg_dcg_updated BEFORE UPDATE ON public.daily_claim_groups
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- 2) Add group_id to wallets + runs
ALTER TABLE public.daily_claim_wallets ADD COLUMN group_id uuid;
ALTER TABLE public.daily_claim_runs    ADD COLUMN group_id uuid;

CREATE INDEX idx_dcw_group ON public.daily_claim_wallets(group_id);
CREATE INDEX idx_dcr_group_date ON public.daily_claim_runs(group_id, run_date);

-- 3) Backfill: create a default group for every (user, network) that has wallets,
--    using daily_claim_settings if present, else defaults.
WITH targets AS (
  SELECT DISTINCT w.owner_user_id, COALESCE(w.network,'celo') AS network
  FROM public.daily_claim_wallets w
),
inserted AS (
  INSERT INTO public.daily_claim_groups
    (owner_user_id, network, name, start_hour_bd, start_minute_bd, retry_wait_minutes, enabled)
  SELECT
    t.owner_user_id,
    t.network,
    'Default — ' || upper(t.network),
    COALESCE(s.start_hour_bd, 0),
    COALESCE(s.start_minute_bd, 0),
    COALESCE(s.retry_wait_minutes, 30),
    COALESCE(s.enabled, true)
  FROM targets t
  LEFT JOIN public.daily_claim_settings s
    ON s.owner_user_id = t.owner_user_id AND s.network = t.network
  RETURNING id, owner_user_id, network
)
UPDATE public.daily_claim_wallets w
SET group_id = i.id
FROM inserted i
WHERE w.owner_user_id = i.owner_user_id
  AND COALESCE(w.network,'celo') = i.network
  AND w.group_id IS NULL;
