ALTER TABLE public.daily_claim_runs
  DROP CONSTRAINT IF EXISTS daily_claim_runs_owner_date_net_key;

CREATE UNIQUE INDEX IF NOT EXISTS daily_claim_runs_group_date_uniq
  ON public.daily_claim_runs (group_id, run_date)
  WHERE group_id IS NOT NULL;