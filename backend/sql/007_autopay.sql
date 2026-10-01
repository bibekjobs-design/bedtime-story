-- Auto-renew (Razorpay Subscriptions). Run once in the Supabase SQL editor,
-- same as 001-006. The existing one-time "pay for 1 month" flow is unchanged.

create table if not exists public.autopay_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  razorpay_subscription_id text not null unique,
  plan text not null,                 -- 'normal_monthly' | 'pro_monthly'
  amount_inr integer not null,
  status text not null default 'created',
    -- 'created' | 'authenticated' | 'active' | 'pending' | 'cancelling'
    -- | 'halted' | 'cancelled' | 'completed' | 'paused'
  current_end timestamptz,            -- end of the current paid month, per Razorpay
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_autopay_user_id on public.autopay_subscriptions(user_id);

-- Backend-only table (service-role key bypasses RLS); keep the public key out.
alter table public.autopay_subscriptions enable row level security;

drop policy if exists "autopay_no_public_access" on public.autopay_subscriptions;
create policy "autopay_no_public_access"
  on public.autopay_subscriptions
  for all
  using (false)
  with check (false);
