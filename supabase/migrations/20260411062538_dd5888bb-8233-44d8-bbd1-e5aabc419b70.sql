DROP TRIGGER IF EXISTS refresh_claim_stats_public_summary_after_change ON public.claim_stats;
DROP FUNCTION IF EXISTS public.refresh_claim_stats_public_summary();