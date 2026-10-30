CREATE OR REPLACE FUNCTION public.reserve_gd_collection_items(p_limit integer DEFAULT 6) RETURNS SETOF public.gd_collection_items LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE active_count integer; available_slots integer;
BEGIN
 PERFORM pg_advisory_xact_lock(20042220);
 UPDATE public.gd_collection_jobs j SET status='stopped',finished_at=now() WHERE status='stopping' AND NOT EXISTS(SELECT 1 FROM public.gd_collection_items i WHERE i.job_id=j.id AND i.status IN ('processing','confirming'));
 UPDATE public.gd_collection_jobs j SET status='completed',finished_at=now() WHERE status='running' AND NOT EXISTS(SELECT 1 FROM public.gd_collection_items i WHERE i.job_id=j.id AND i.status IN ('pending','processing','confirming'));
 SELECT count(*) INTO active_count FROM public.gd_collection_items WHERE status IN ('processing','confirming') AND lease_until>now();
 available_slots := greatest(0,least(greatest(1,least(p_limit,6)),200-active_count));
 IF available_slots=0 THEN RETURN; END IF;
 RETURN QUERY WITH picked AS (
 SELECT i.id FROM public.gd_collection_items i JOIN public.gd_collection_jobs j ON j.id=i.job_id
 WHERE ((j.status='running' AND i.status IN ('pending','processing','confirming')) OR (j.status='stopping' AND i.status IN ('processing','confirming')))
 AND (i.lease_until IS NULL OR i.lease_until<now()) ORDER BY i.updated_at,i.id FOR UPDATE OF i SKIP LOCKED LIMIT available_slots
 ) UPDATE public.gd_collection_items i SET status=CASE WHEN i.signed_tx IS NOT NULL THEN 'confirming' ELSE 'processing' END,lease_id=gen_random_uuid(),lease_until=now()+interval '2 minutes',attempts=i.attempts+1,updated_at=now() FROM picked WHERE i.id=picked.id RETURNING i.*;
END;
$$;
CREATE OR REPLACE FUNCTION public.tick_gd_collection() RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,cron,net AS $$
DECLARE secret text; n integer; remaining integer; callbacks integer;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.gd_collection_jobs WHERE status IN ('running','stopping')) THEN
  PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname='gd-collection-active'; RETURN;
 END IF;
 SELECT token INTO secret FROM public.gd_collection_callback_config WHERE id=true;
 IF secret IS NULL THEN RETURN; END IF;
 SELECT count(*) INTO remaining FROM public.gd_collection_items i JOIN public.gd_collection_jobs j ON j.id=i.job_id WHERE j.status IN ('running','stopping') AND i.status IN ('pending','processing','confirming');
 callbacks := greatest(1,least(34,ceil(remaining::numeric/6)::integer));
 FOR n IN 1..callbacks LOOP
 PERFORM net.http_post(url:='https://project--dd2e3899-be18-40bc-be79-18eb1f70fcff.lovable.app/api/public/hooks/gd-collection',headers:=jsonb_build_object('Content-Type','application/json','x-collection-token',secret),body:='{}'::jsonb,timeout_milliseconds:=55000);
 END LOOP;
END;
$$;