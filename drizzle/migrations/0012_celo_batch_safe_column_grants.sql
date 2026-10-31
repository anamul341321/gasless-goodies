REVOKE ALL PRIVILEGES ON TABLE public.celo_batch_jobs,public.celo_batch_chunks FROM anon,authenticated;
GRANT SELECT(id,owner_user_id,client_id,sender_address,amount,total,status,last_error,created_at,finished_at) ON public.celo_batch_jobs TO authenticated;
GRANT SELECT(id,job_id,owner_user_id,position,recipients,status,tx_hash,error_message) ON public.celo_batch_chunks TO authenticated;
GRANT ALL ON public.celo_batch_jobs,public.celo_batch_chunks TO service_role;