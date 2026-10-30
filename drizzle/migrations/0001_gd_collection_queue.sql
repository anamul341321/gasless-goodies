CREATE TABLE public.gd_collection_jobs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), owner_user_id uuid NOT NULL, client_id uuid NOT NULL,
 name text NOT NULL DEFAULT '', network text NOT NULL CHECK(network IN ('celo','xdc')), receiver text NOT NULL,
 status text NOT NULL DEFAULT 'uploading' CHECK(status IN ('uploading','running','stopping','stopped','completed')),
 total integer NOT NULL DEFAULT 0, created_at timestamptz NOT NULL DEFAULT now(), finished_at timestamptz,
 UNIQUE(owner_user_id,client_id)
);
GRANT SELECT ON public.gd_collection_jobs TO authenticated;
GRANT ALL ON public.gd_collection_jobs TO service_role;
ALTER TABLE public.gd_collection_jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY collection_job_owner ON public.gd_collection_jobs FOR SELECT TO authenticated USING(owner_user_id=auth.uid());
CREATE TABLE public.gd_collection_items (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), job_id uuid NOT NULL REFERENCES public.gd_collection_jobs(id) ON DELETE CASCADE,
 owner_user_id uuid NOT NULL, wallet_address text NOT NULL, encrypted_key text,
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','processing','confirming','success','failed','empty','cancelled')),
 amount text, tx_hash text, signed_tx text, error_message text, attempts integer NOT NULL DEFAULT 0,
 lease_id uuid, lease_until timestamptz, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(job_id,wallet_address)
);
GRANT SELECT(id,job_id,owner_user_id,wallet_address,status,amount,tx_hash,error_message,created_at,updated_at) ON public.gd_collection_items TO authenticated;
GRANT ALL ON public.gd_collection_items TO service_role;
ALTER TABLE public.gd_collection_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY collection_item_owner ON public.gd_collection_items FOR SELECT TO authenticated USING(owner_user_id=auth.uid());
CREATE INDEX collection_work_idx ON public.gd_collection_items(status,lease_until,created_at);
CREATE INDEX collection_owner_idx ON public.gd_collection_jobs(owner_user_id,created_at DESC);
CREATE TABLE public.gd_collection_callback_config (id boolean PRIMARY KEY DEFAULT true CHECK(id), token text NOT NULL);
GRANT ALL ON public.gd_collection_callback_config TO service_role;
ALTER TABLE public.gd_collection_callback_config ENABLE ROW LEVEL SECURITY;
CREATE FUNCTION public.verify_gd_collection_callback(p_token text) RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path=public AS $$
 SELECT EXISTS(SELECT 1 FROM public.gd_collection_callback_config WHERE token=p_token AND length(p_token)>=64);
$$;
REVOKE ALL ON FUNCTION public.verify_gd_collection_callback(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.verify_gd_collection_callback(text) TO anon,authenticated,service_role;
CREATE FUNCTION public.reserve_gd_collection_items(p_limit integer DEFAULT 6) RETURNS SETOF public.gd_collection_items LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 UPDATE public.gd_collection_jobs j SET status='stopped',finished_at=now() WHERE status='stopping' AND NOT EXISTS(SELECT 1 FROM public.gd_collection_items i WHERE i.job_id=j.id AND i.status IN ('processing','confirming'));
 UPDATE public.gd_collection_jobs j SET status='completed',finished_at=now() WHERE status='running' AND NOT EXISTS(SELECT 1 FROM public.gd_collection_items i WHERE i.job_id=j.id AND i.status IN ('pending','processing','confirming'));
 RETURN QUERY WITH picked AS (
 SELECT i.id FROM public.gd_collection_items i JOIN public.gd_collection_jobs j ON j.id=i.job_id
 WHERE ((j.status='running' AND i.status IN ('pending','processing','confirming')) OR (j.status='stopping' AND i.status IN ('processing','confirming')))
 AND (i.lease_until IS NULL OR i.lease_until<now()) ORDER BY i.updated_at,i.id FOR UPDATE OF i SKIP LOCKED LIMIT greatest(1,least(p_limit,6))
 ) UPDATE public.gd_collection_items i SET status=CASE WHEN i.signed_tx IS NOT NULL THEN 'confirming' ELSE 'processing' END, lease_id=gen_random_uuid(),lease_until=now()+interval '2 minutes',attempts=i.attempts+1,updated_at=now() FROM picked WHERE i.id=picked.id RETURNING i.*;
END;
$$;
REVOKE ALL ON FUNCTION public.reserve_gd_collection_items(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reserve_gd_collection_items(integer) TO service_role;
CREATE FUNCTION public.stop_gd_collection(p_job uuid) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 UPDATE public.gd_collection_jobs SET status='stopping' WHERE id=p_job AND owner_user_id=auth.uid() AND status IN ('uploading','running');
 IF NOT FOUND THEN RETURN false; END IF;
 UPDATE public.gd_collection_items SET status='cancelled',encrypted_key=NULL,updated_at=now() WHERE job_id=p_job AND status='pending';
 RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.stop_gd_collection(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.stop_gd_collection(uuid) TO authenticated;
CREATE FUNCTION public.gd_collection_summary(p_job uuid) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT jsonb_build_object('total',count(*),'success',count(*) FILTER(WHERE status='success'),'failed',count(*) FILTER(WHERE status='failed'),'empty',count(*) FILTER(WHERE status='empty'),'cancelled',count(*) FILTER(WHERE status='cancelled'),'pending',count(*) FILTER(WHERE status IN ('pending','processing','confirming')),'collected',coalesce(sum(CASE WHEN status='success' THEN amount::numeric ELSE 0 END),0)::text) FROM public.gd_collection_items WHERE job_id=p_job AND owner_user_id=auth.uid();
$$;
REVOKE ALL ON FUNCTION public.gd_collection_summary(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.gd_collection_summary(uuid) TO authenticated;