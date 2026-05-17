UPDATE public.daily_claim_runs r
SET group_id = (
  SELECT g.id FROM public.daily_claim_groups g
  WHERE g.owner_user_id = r.owner_user_id AND g.network = r.network
  ORDER BY g.created_at ASC LIMIT 1
)
WHERE r.group_id IS NULL;