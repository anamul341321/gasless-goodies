INSERT INTO public.daily_claim_run_items (run_id, owner_user_id, wallet_address, encrypted_key, network)
SELECT r.id, w.owner_user_id, w.wallet_address, w.encrypted_key, r.network
FROM public.daily_claim_runs r
JOIN public.daily_claim_groups g ON g.id = r.group_id
JOIN public.daily_claim_wallets w ON w.group_id = g.id AND w.is_active = true
WHERE r.id = '3134c9a6-83e9-4520-bba2-0d16ed54b85e'
  AND NOT EXISTS (
    SELECT 1 FROM public.daily_claim_run_items i
    WHERE i.run_id = r.id AND lower(i.wallet_address) = lower(w.wallet_address)
  );

UPDATE public.daily_claim_runs r
SET total = (SELECT count(*) FROM public.daily_claim_run_items i WHERE i.run_id = r.id)
WHERE r.id = '3134c9a6-83e9-4520-bba2-0d16ed54b85e';