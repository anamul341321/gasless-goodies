-- lovable-cron-fallback-reviewed: Durable phone-off collection wakes on enqueue and unschedules after drain; active-only 15-second retries bound recovery delay without an external delayed workflow. User informed of 5760 checks/day maximum and higher Cloud cost. Both schedule calls reuse the same named job.
CREATE INDEX IF NOT EXISTS gd_collection_owner_work_idx ON public.gd_collection_items(owner_user_id,status,lease_until,updated_at,id);
CREATE OR REPLACE FUNCTION public.gd_collection_owner_slots(p_active integer, p_owners integer) RETURNS integer LANGUAGE sql IMMUTABLE SET search_path=public AS $$
 SELECT greatest(0,least(200,ceil(1000.0/greatest(1,p_owners))::integer)-greatest(0,p_active));
$$;
REVOKE ALL ON FUNCTION public.gd_collection_owner_slots(integer,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.gd_collection_owner_slots(integer,integer) TO service_role;
CREATE OR REPLACE FUNCTION public.reserve_gd_collection_items(p_limit integer DEFAULT 6) RETURNS SETOF public.gd_collection_items LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE active_count integer; available_slots integer; selected_owner uuid; owner_slots integer; owner_count integer;
BEGIN
 PERFORM pg_advisory_xact_lock(20042220);
 UPDATE public.gd_collection_jobs j SET status='stopped',finished_at=now() WHERE status='stopping' AND NOT EXISTS(SELECT 1 FROM public.gd_collection_items i WHERE i.job_id=j.id AND i.status IN ('processing','confirming'));
 UPDATE public.gd_collection_jobs j SET status='completed',finished_at=now() WHERE status='running' AND NOT EXISTS(SELECT 1 FROM public.gd_collection_items i WHERE i.job_id=j.id AND i.status IN ('pending','processing','confirming'));
 SELECT count(*) INTO active_count FROM public.gd_collection_items WHERE status IN ('processing','confirming') AND lease_until>now();
 available_slots := greatest(0,least(greatest(1,least(p_limit,6)),1000-active_count));
 IF available_slots=0 THEN RETURN; END IF;
 SELECT count(DISTINCT j.owner_user_id) INTO owner_count FROM public.gd_collection_jobs j WHERE j.status IN ('running','stopping');
 WITH ready AS (
  SELECT i.owner_user_id,min(i.updated_at) oldest FROM public.gd_collection_items i JOIN public.gd_collection_jobs j ON j.id=i.job_id
  WHERE ((j.status='running' AND i.status IN ('pending','processing','confirming')) OR (j.status='stopping' AND i.status IN ('processing','confirming')))
  AND (i.lease_until IS NULL OR i.lease_until<=now()) GROUP BY i.owner_user_id
 ), active AS (
  SELECT owner_user_id,count(*)::integer busy,max(updated_at) last_reserved FROM public.gd_collection_items
  WHERE status IN ('processing','confirming') AND lease_until>now() GROUP BY owner_user_id
 ) SELECT r.owner_user_id,public.gd_collection_owner_slots(coalesce(a.busy,0),owner_count)
 INTO selected_owner,owner_slots FROM ready r LEFT JOIN active a USING(owner_user_id)
 WHERE public.gd_collection_owner_slots(coalesce(a.busy,0),owner_count)>0
 ORDER BY coalesce(a.busy,0),a.last_reserved NULLS FIRST,r.oldest,r.owner_user_id LIMIT 1;
 IF selected_owner IS NULL THEN RETURN; END IF;
 RETURN QUERY WITH picked AS (
  SELECT i.id FROM public.gd_collection_items i JOIN public.gd_collection_jobs j ON j.id=i.job_id
  WHERE i.owner_user_id=selected_owner AND ((j.status='running' AND i.status IN ('pending','processing','confirming')) OR (j.status='stopping' AND i.status IN ('processing','confirming')))
  AND (i.lease_until IS NULL OR i.lease_until<=now()) ORDER BY i.updated_at,i.id FOR UPDATE OF i SKIP LOCKED LIMIT least(available_slots,owner_slots)
 ) UPDATE public.gd_collection_items i SET status=CASE WHEN i.signed_tx IS NOT NULL THEN 'confirming' ELSE 'processing' END,lease_id=gen_random_uuid(),lease_until=now()+interval '2 minutes',attempts=i.attempts+1,updated_at=now() FROM picked WHERE i.id=picked.id RETURNING i.*;
END;
$$;
REVOKE ALL ON FUNCTION public.reserve_gd_collection_items(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reserve_gd_collection_items(integer) TO service_role;
CREATE OR REPLACE FUNCTION public.tick_gd_collection() RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,cron,net AS $$
DECLARE secret text; n integer; remaining integer; callbacks integer; active_count integer; owner_count integer;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.gd_collection_jobs WHERE status IN ('running','stopping')) THEN
  PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname='gd-collection-active'; RETURN;
 END IF;
 SELECT token INTO secret FROM public.gd_collection_callback_config WHERE id=true;
 IF secret IS NULL THEN RETURN; END IF;
 SELECT count(*) INTO active_count FROM public.gd_collection_items WHERE status IN ('processing','confirming') AND lease_until>now();
 SELECT count(DISTINCT owner_user_id) INTO owner_count FROM public.gd_collection_jobs WHERE status IN ('running','stopping');
 WITH ready AS (
  SELECT i.owner_user_id,count(*)::integer ready_count FROM public.gd_collection_items i JOIN public.gd_collection_jobs j ON j.id=i.job_id
  WHERE ((j.status='running' AND i.status IN ('pending','processing','confirming')) OR (j.status='stopping' AND i.status IN ('processing','confirming')))
  AND (i.lease_until IS NULL OR i.lease_until<=now()) GROUP BY i.owner_user_id
 ), active AS (
  SELECT owner_user_id,count(*)::integer busy FROM public.gd_collection_items WHERE status IN ('processing','confirming') AND lease_until>now() GROUP BY owner_user_id
 ) SELECT coalesce(sum(least(r.ready_count,public.gd_collection_owner_slots(coalesce(a.busy,0),owner_count))),0)::integer INTO remaining FROM ready r LEFT JOIN active a USING(owner_user_id);
 callbacks := least(167,ceil(greatest(0,least(remaining,1000-active_count))::numeric/6)::integer);
 IF callbacks=0 THEN RETURN; END IF;
 FOR n IN 1..callbacks LOOP
  PERFORM net.http_post(url:='https://project--dd2e3899-be18-40bc-be79-18eb1f70fcff.lovable.app/api/public/hooks/gd-collection',headers:=jsonb_build_object('Content-Type','application/json','x-collection-token',secret),body:='{}'::jsonb,timeout_milliseconds:=55000);
 END LOOP;
END;
$$;
REVOKE ALL ON FUNCTION public.tick_gd_collection() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.tick_gd_collection() TO service_role;
CREATE OR REPLACE FUNCTION public.wake_gd_collection() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,cron,net AS $$
BEGIN
 IF NEW.status='running' AND (TG_OP='INSERT' OR OLD.status IS DISTINCT FROM NEW.status) THEN
  PERFORM cron.schedule('gd-collection-active','15 seconds',$cmd$ SELECT public.tick_gd_collection(); $cmd$);
  PERFORM public.tick_gd_collection();
 END IF;
 RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.wake_gd_collection() FROM PUBLIC;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM public.gd_collection_jobs WHERE status IN ('running','stopping')) THEN
  PERFORM cron.schedule('gd-collection-active','15 seconds',$cmd$ SELECT public.tick_gd_collection(); $cmd$);
 END IF;
END $$;