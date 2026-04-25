
CREATE TABLE public.admin_settings (
  id TEXT PRIMARY KEY DEFAULT 'main',
  batch_claim_enabled BOOLEAN NOT NULL DEFAULT true,
  gas_load_enabled BOOLEAN NOT NULL DEFAULT true,
  notice_message TEXT DEFAULT '',
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Insert default row
INSERT INTO public.admin_settings (id, batch_claim_enabled, gas_load_enabled, notice_message) 
VALUES ('main', true, true, '');

-- Allow anyone to read (public app)
ALTER TABLE public.admin_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read admin settings"
ON public.admin_settings
FOR SELECT
TO anon, authenticated
USING (true);

-- Allow updates from authenticated users (admin will use service key via edge function)
CREATE POLICY "Service role can update admin settings"
ON public.admin_settings
FOR UPDATE
TO authenticated
USING (true)
WITH CHECK (true);

-- Enable realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.admin_settings;
