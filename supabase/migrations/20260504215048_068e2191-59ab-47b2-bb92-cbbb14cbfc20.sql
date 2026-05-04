CREATE TABLE IF NOT EXISTS public.gd_bulk_send_locks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sender_address text NOT NULL,
  wallet_address text NOT NULL,
  amount text NOT NULL,
  job_id uuid,
  recipient_id uuid,
  status text NOT NULL DEFAULT 'reserved',
  tx_hash text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.gd_bulk_send_locks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "No direct access to gd_bulk_send_locks" ON public.gd_bulk_send_locks;
CREATE POLICY "No direct access to gd_bulk_send_locks"
ON public.gd_bulk_send_locks
FOR ALL
TO public
USING (false)
WITH CHECK (false);

CREATE UNIQUE INDEX IF NOT EXISTS idx_gd_bulk_send_locks_unique
ON public.gd_bulk_send_locks (sender_address, wallet_address, amount);

CREATE INDEX IF NOT EXISTS idx_gd_bulk_send_locks_job
ON public.gd_bulk_send_locks (job_id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'trg_gd_bulk_send_locks_updated'
  ) THEN
    CREATE TRIGGER trg_gd_bulk_send_locks_updated
    BEFORE UPDATE ON public.gd_bulk_send_locks
    FOR EACH ROW
    EXECUTE FUNCTION public.touch_updated_at();
  END IF;
END $$;

INSERT INTO public.gd_bulk_send_locks (sender_address, wallet_address, amount, job_id, recipient_id, status, tx_hash, created_at, updated_at)
SELECT DISTINCT ON (sender_address, wallet_address, amount)
  sender_address,
  wallet_address,
  amount,
  job_id,
  id,
  'sent',
  tx_hash,
  COALESCE(processed_at, created_at, now()),
  now()
FROM public.gd_bulk_recipients
WHERE status = 'sent'
ORDER BY sender_address, wallet_address, amount, COALESCE(processed_at, created_at, now()) ASC
ON CONFLICT (sender_address, wallet_address, amount) DO NOTHING;