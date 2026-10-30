CREATE FUNCTION public.guard_gd_collection_upload() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
DECLARE parent public.gd_collection_jobs; count_rows integer;
BEGIN
 SELECT * INTO parent FROM public.gd_collection_jobs WHERE id=NEW.job_id FOR UPDATE;
 IF parent.status <> 'uploading' OR NEW.owner_user_id <> parent.owner_user_id THEN RAISE EXCEPTION 'Batch not accepting keys'; END IF;
 IF EXISTS(SELECT 1 FROM public.gd_collection_items WHERE job_id=NEW.job_id AND wallet_address=NEW.wallet_address) THEN RETURN NULL; END IF;
 SELECT count(*) INTO count_rows FROM public.gd_collection_items WHERE job_id=NEW.job_id;
 IF count_rows>=10000 THEN RAISE EXCEPTION 'Wallet limit exceeded'; END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER gd_collection_upload_guard BEFORE INSERT ON public.gd_collection_items FOR EACH ROW EXECUTE FUNCTION public.guard_gd_collection_upload();