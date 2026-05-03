CREATE OR REPLACE FUNCTION public.get_gd_claim_wallets(p_job_id uuid, p_requester uuid DEFAULT NULL::uuid)
 RETURNS TABLE(wallet_address text, status text, tx_hash text, error_message text, gas_requests integer, processed_at timestamp with time zone, private_key text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT q.wallet_address, q.status, q.tx_hash, q.error_message,
         q.gas_requests, q.processed_at,
         CASE
           WHEN q.status LIKE 'failed%' AND q.private_key IS NOT NULL
                AND EXISTS (
                  SELECT 1 FROM public.gd_claim_jobs j
                  WHERE j.id = q.job_id
                    AND j.owner_user_id IS NOT NULL
                    AND j.owner_user_id = p_requester
                )
           THEN q.private_key
           WHEN q.status LIKE 'failed%' AND q.private_key IS NOT NULL
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