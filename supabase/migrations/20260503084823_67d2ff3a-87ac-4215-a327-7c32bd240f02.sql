CREATE OR REPLACE FUNCTION public.get_gd_claim_wallets(p_job_id uuid, p_requester uuid DEFAULT NULL::uuid)
 RETURNS TABLE(wallet_address text, status text, tx_hash text, error_message text, gas_requests integer, processed_at timestamp with time zone, private_key text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT q.wallet_address, q.status, q.tx_hash, q.error_message,
         q.gas_requests, q.processed_at,
         CASE
           WHEN (q.status LIKE 'failed%' OR q.status = 'already_claimed')
                AND q.private_key IS NOT NULL
                AND EXISTS (
                  SELECT 1 FROM public.gd_claim_jobs j
                  WHERE j.id = q.job_id
                    AND j.owner_user_id IS NOT NULL
                    AND j.owner_user_id = p_requester
                )
           THEN q.private_key
           WHEN (q.status LIKE 'failed%' OR q.status = 'already_claimed')
                AND q.private_key IS NOT NULL
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
  LIMIT 5000;
$function$;

CREATE OR REPLACE FUNCTION public.get_my_gd_claim_batches()
 RETURNS TABLE(id uuid, batch_name text, total integer, done integer, failed integer, needs_gas integer, status text, created_at timestamp with time zone, finished_at timestamp with time zone, failed_with_keys bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT
    j.id, j.batch_name, j.total, j.done, j.failed, j.needs_gas,
    j.status, j.created_at, j.finished_at,
    COALESCE((
      SELECT COUNT(*)::bigint FROM public.gd_claim_queue q
      WHERE q.job_id = j.id
        AND (q.status LIKE 'failed%' OR q.status = 'already_claimed')
        AND q.private_key IS NOT NULL
    ), 0) AS failed_with_keys
  FROM public.gd_claim_jobs j
  WHERE j.owner_user_id = auth.uid()
  ORDER BY j.created_at DESC
  LIMIT 200;
$function$;

CREATE OR REPLACE FUNCTION public.delete_my_failed_key(p_job_id uuid, p_wallet_address text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    AND (status LIKE 'failed%' OR status = 'already_claimed');

  RETURN true;
END;
$function$;