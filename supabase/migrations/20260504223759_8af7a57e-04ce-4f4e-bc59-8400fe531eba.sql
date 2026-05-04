DROP INDEX IF EXISTS public.idx_gd_bulk_send_locks_unique;

CREATE UNIQUE INDEX IF NOT EXISTS idx_gd_bulk_send_locks_unique
ON public.gd_bulk_send_locks (job_id, wallet_address, amount)
WHERE job_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_gd_bulk_send_locks_sender_wallet_amount
ON public.gd_bulk_send_locks (sender_address, wallet_address, amount);
