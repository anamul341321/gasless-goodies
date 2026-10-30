CREATE OR REPLACE FUNCTION public.get_gd_claim_wallets(p_job_id uuid,p_requester uuid DEFAULT NULL)
RETURNS TABLE(wallet_address text,status text,tx_hash text,error_message text,gas_requests integer,processed_at timestamptz,private_key text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
SELECT q.wallet_address,q.status,q.tx_hash,q.error_message,q.gas_requests,q.processed_at,CASE WHEN q.status LIKE 'failed%' OR q.status='already_claimed' THEN q.private_key ELSE NULL END FROM public.gd_claim_queue q JOIN public.gd_claim_jobs j ON j.id=q.job_id WHERE q.job_id=p_job_id AND auth.uid() IS NOT NULL AND j.owner_user_id=auth.uid() ORDER BY q.created_at ASC, q.wallet_address ASC;
$$;