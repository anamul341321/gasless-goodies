-- Enable scheduling extensions
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Jobs table: one row per batch submission
create table if not exists public.gas_load_jobs (
  id uuid primary key default gen_random_uuid(),
  total int not null default 0,
  done int not null default 0,
  failed int not null default 0,
  status text not null default 'pending', -- pending | running | completed
  delay_ms int not null default 2000,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  finished_at timestamptz
);

create index if not exists idx_gas_load_jobs_status on public.gas_load_jobs(status);

-- Queue table: one row per wallet per job
create table if not exists public.gas_load_queue (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.gas_load_jobs(id) on delete cascade,
  wallet_address text not null,
  status text not null default 'pending', -- pending | processing | success | failed
  attempts int not null default 0,
  tx_hash text,
  proxy_ip text,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  processed_at timestamptz
);

create index if not exists idx_gas_load_queue_job on public.gas_load_queue(job_id);
create index if not exists idx_gas_load_queue_status on public.gas_load_queue(status);
create index if not exists idx_gas_load_queue_pending on public.gas_load_queue(job_id, status) where status = 'pending';

-- RLS: lock both tables from direct client access
alter table public.gas_load_jobs enable row level security;
alter table public.gas_load_queue enable row level security;

create policy "No direct access to gas_load_jobs"
  on public.gas_load_jobs for all
  to public
  using (false)
  with check (false);

create policy "No direct access to gas_load_queue"
  on public.gas_load_queue for all
  to public
  using (false)
  with check (false);
