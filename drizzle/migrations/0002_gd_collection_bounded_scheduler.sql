-- lovable-cron-fallback-reviewed: Phone-off durable queue requires bounded minute retries; wake only when a batch starts, unschedule after drain; no idle polling. User informed of 1440 maximum daily runs and Cloud cost.
CREATE FUNCTION public.tick_gd_collection() RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,cron,net AS $$
DECLARE secret text; n integer;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.gd_collection_jobs WHERE status IN ('running','stopping')) THEN
  PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname='gd-collection-active'; RETURN;
 END IF;
 SELECT token INTO secret FROM public.gd_collection_callback_config WHERE id=true;
 IF secret IS NULL THEN RETURN; END IF;
 FOR n IN 1..8 LOOP
 PERFORM net.http_post(url:='https://project--dd2e3899-be18-40bc-be79-18eb1f70fcff.lovable.app/api/public/hooks/gd-collection',headers:=jsonb_build_object('Content-Type','application/json','x-collection-token',secret),body:='{}'::jsonb,timeout_milliseconds:=55000);
 END LOOP;
END;
$$;
CREATE FUNCTION public.wake_gd_collection() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,cron,net AS $$
BEGIN
 IF NEW.status='running' AND (TG_OP='INSERT' OR OLD.status IS DISTINCT FROM NEW.status) THEN
 PERFORM cron.schedule('gd-collection-active','* * * * *',$cmd$ SELECT public.tick_gd_collection(); $cmd$);
 PERFORM public.tick_gd_collection();
 END IF;
 RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.tick_gd_collection() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.wake_gd_collection() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.tick_gd_collection() TO service_role;
CREATE TRIGGER gd_collection_wake AFTER INSERT OR UPDATE OF status ON public.gd_collection_jobs FOR EACH ROW EXECUTE FUNCTION public.wake_gd_collection();