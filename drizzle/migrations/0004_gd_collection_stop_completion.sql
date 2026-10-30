CREATE OR REPLACE FUNCTION public.stop_gd_collection(p_job uuid) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 UPDATE public.gd_collection_jobs SET status='stopping' WHERE id=p_job AND owner_user_id=auth.uid() AND status IN ('uploading','running');
 IF NOT FOUND THEN RETURN false; END IF;
 UPDATE public.gd_collection_items SET status='cancelled',encrypted_key=NULL,updated_at=now() WHERE job_id=p_job AND status='pending';
 UPDATE public.gd_collection_jobs SET status='stopped',finished_at=now() WHERE id=p_job AND NOT EXISTS(SELECT 1 FROM public.gd_collection_items WHERE job_id=p_job AND status IN ('processing','confirming'));
 RETURN true;
END;
$$;