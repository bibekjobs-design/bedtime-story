-- Keeps a visible trace of the daily Supabase keep-alive pings
create table if not exists keepalive_log (
  id bigserial primary key,
  pinged_at timestamptz not null default now(),
  source text
);
create index if not exists keepalive_log_pinged_idx on keepalive_log(pinged_at);
