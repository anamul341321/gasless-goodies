ALTER TABLE public.gas_load_jobs ADD COLUMN IF NOT EXISTS owner_user_id uuid;
ALTER TABLE public.gd_bulk_jobs ADD COLUMN IF NOT EXISTS owner_user_id uuid;
CREATE INDEX IF NOT EXISTS gas_jobs_owner_history ON public.gas_load_jobs(owner_user_id, created_at DESC);
COMMENT ON COLUMN public.gas_load_jobs.owner_user_id IS 'Verified submitting user. Legacy ownerless jobs remain private and cannot be adopted by job ID.';
UPDATE public.gas_load_jobs j SET owner_user_id = p.id FROM public.profiles p WHERE j.owner_user_id IS NULL AND lower(j.submitted_by_wallet) = lower(p.wallet_address) AND p.auth_method = 'wallet' AND NOT EXISTS (SELECT 1 FROM public.profiles other WHERE other.id <> p.id AND lower(other.wallet_address) = lower(p.wallet_address));
CREATE OR REPLACE FUNCTION public.get_public_batch_history(search_name text DEFAULT NULL, page_limit integer DEFAULT 100, page_offset integer DEFAULT 0)
RETURNS TABLE(id uuid,batch_name text,total integer,done integer,failed integer,status text,created_at timestamptz,finished_at timestamptz,duration_seconds integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
SELECT j.id,j.batch_name,j.total,j.done,j.failed,j.status,j.created_at,j.finished_at,EXTRACT(EPOCH FROM (j.finished_at-j.created_at))::integer FROM public.gas_load_jobs j WHERE auth.uid() IS NOT NULL AND j.owner_user_id=auth.uid() AND (search_name IS NULL OR j.batch_name ILIKE '%'||search_name||'%') ORDER BY j.created_at DESC LIMIT GREATEST(1,LEAST(page_limit,200)) OFFSET GREATEST(0,page_offset);
$$;
CREATE OR REPLACE FUNCTION public.get_public_name_summary(search_name text DEFAULT NULL)
RETURNS TABLE(batch_name text,batch_count bigint,total_wallets bigint,total_success bigint,total_failed bigint,first_batch_at timestamptz,last_batch_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
SELECT j.batch_name,COUNT(*)::bigint,COALESCE(SUM(j.total),0)::bigint,COALESCE(SUM(j.done),0)::bigint,COALESCE(SUM(j.failed),0)::bigint,MIN(j.created_at),MAX(j.created_at) FROM public.gas_load_jobs j WHERE auth.uid() IS NOT NULL AND j.owner_user_id=auth.uid() AND (search_name IS NULL OR j.batch_name ILIKE '%'||search_name||'%') GROUP BY j.batch_name ORDER BY MAX(j.created_at) DESC LIMIT 200;
$$;
CREATE OR REPLACE FUNCTION public.get_public_gd_claim_history(search_name text DEFAULT NULL,page_limit integer DEFAULT 100,page_offset integer DEFAULT 0)
RETURNS TABLE(id uuid,batch_name text,total integer,done integer,failed integer,needs_gas integer,status text,network text,created_at timestamptz,finished_at timestamptz,duration_seconds integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
SELECT j.id,j.batch_name,j.total,j.done,j.failed,j.needs_gas,j.status,j.network,j.created_at,j.finished_at,EXTRACT(EPOCH FROM (j.finished_at-j.created_at))::integer FROM public.gd_claim_jobs j WHERE auth.uid() IS NOT NULL AND j.owner_user_id=auth.uid() AND (search_name IS NULL OR j.batch_name ILIKE '%'||search_name||'%') ORDER BY j.created_at DESC LIMIT GREATEST(1,LEAST(page_limit,200)) OFFSET GREATEST(0,page_offset);
$$;
CREATE OR REPLACE FUNCTION public.get_gd_claim_status(p_job_id uuid)
RETURNS TABLE(id uuid,batch_name text,total integer,done integer,failed integer,needs_gas integer,status text,network text,gas_phase text,created_at timestamptz,finished_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
SELECT j.id,j.batch_name,j.total,j.done,j.failed,j.needs_gas,j.status,j.network,j.gas_phase,j.created_at,j.finished_at FROM public.gd_claim_jobs j WHERE j.id=p_job_id AND auth.uid() IS NOT NULL AND j.owner_user_id=auth.uid() LIMIT 1;
$$;
CREATE OR REPLACE FUNCTION public.get_gd_claim_wallets(p_job_id uuid,p_requester uuid DEFAULT NULL)
RETURNS TABLE(wallet_address text,status text,tx_hash text,error_message text,gas_requests integer,processed_at timestamptz,private_key text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
SELECT q.wallet_address,q.status,q.tx_hash,q.error_message,q.gas_requests,q.processed_at,CASE WHEN q.status LIKE 'failed%' OR q.status='already_claimed' THEN q.private_key ELSE NULL END FROM public.gd_claim_queue q JOIN public.gd_claim_jobs j ON j.id=q.job_id WHERE q.job_id=p_job_id AND auth.uid() IS NOT NULL AND j.owner_user_id=auth.uid() ORDER BY q.created_at ASC LIMIT 5000;
$$;
CREATE OR REPLACE FUNCTION public.get_vip_job_status(p_wallet text,p_job_id uuid)
RETURNS TABLE(id uuid,total integer,done integer,failed integer,status text,delay_ms integer,batch_name text,created_at timestamptz,finished_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
SELECT j.id,j.total,j.done,j.failed,j.status,j.delay_ms,j.batch_name,j.created_at,j.finished_at FROM public.gas_load_jobs j WHERE j.id=p_job_id AND auth.uid() IS NOT NULL AND j.owner_user_id=auth.uid();
$$;
CREATE OR REPLACE FUNCTION public.get_vip_job_wallets(p_wallet text,p_job_id uuid)
RETURNS TABLE(wallet_address text,status text,tx_hash text,error_message text,processed_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
SELECT q.wallet_address,q.status,q.tx_hash,q.error_message,q.processed_at FROM public.gas_load_queue q JOIN public.gas_load_jobs j ON j.id=q.job_id WHERE q.job_id=p_job_id AND auth.uid() IS NOT NULL AND j.owner_user_id=auth.uid() ORDER BY q.created_at ASC LIMIT 1000;
$$;
CREATE OR REPLACE FUNCTION public.get_vip_recent_jobs(p_wallet text)
RETURNS TABLE(id uuid,total integer,done integer,failed integer,status text,batch_name text,created_at timestamptz,finished_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
SELECT j.id,j.total,j.done,j.failed,j.status,j.batch_name,j.created_at,j.finished_at FROM public.gas_load_jobs j WHERE auth.uid() IS NOT NULL AND j.owner_user_id=auth.uid() ORDER BY j.created_at DESC LIMIT 200;
$$;
REVOKE ALL ON FUNCTION public.get_public_batch_history(text,integer,integer),public.get_public_name_summary(text),public.get_public_gd_claim_history(text,integer,integer),public.get_gd_claim_status(uuid),public.get_gd_claim_wallets(uuid,uuid),public.get_vip_job_status(text,uuid),public.get_vip_job_wallets(text,uuid),public.get_vip_recent_jobs(text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_public_batch_history(text,integer,integer),public.get_public_name_summary(text),public.get_public_gd_claim_history(text,integer,integer),public.get_gd_claim_status(uuid),public.get_gd_claim_wallets(uuid,uuid),public.get_vip_job_status(text,uuid),public.get_vip_job_wallets(text,uuid),public.get_vip_recent_jobs(text) TO authenticated,service_role;