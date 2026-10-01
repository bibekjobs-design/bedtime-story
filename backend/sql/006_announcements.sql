-- In-app announcements ("notifications") shown behind the bell on the Home
-- screen. Run this once in the Supabase SQL editor, same as 001-005.
--
-- To send a message to users: INSERT a row (or add one in the Table Editor).
-- To change or retire it: edit the row, or set is_active = false. The app
-- picks changes up within about a minute while Home is open - no app update.
--
--   audience : 'all' | 'free' (trial / expired / logged-out) | 'normal' | 'pro'
--   action   : optional in-app button - 'library' | 'create' | 'plans' | 'history'
--              (in-app screens only; web links are deliberately not allowed)
--   starts_at / expires_at : schedule a message, or let it retire itself

create table if not exists announcements (
    id            uuid primary key default gen_random_uuid(),
    title         text not null,
    message       text not null,
    icon          text not null default '🔔',
    audience      text not null default 'all'
                  check (audience in ('all', 'free', 'normal', 'pro')),
    action        text
                  check (action is null or action in ('library', 'create', 'plans', 'history')),
    action_label  text,
    is_active     boolean not null default true,
    starts_at     timestamptz not null default now(),
    expires_at    timestamptz,
    created_at    timestamptz not null default now()
);

create index if not exists idx_announcements_active
    on announcements (is_active, starts_at desc);

-- Only the backend (service-role key, which bypasses RLS) reads this table.
-- Turning RLS on with no policies keeps the public anon key out.
alter table announcements enable row level security;

-- Sample message so the bell shows something right away. Delete or edit it.
insert into announcements (title, message, icon, audience)
select 'Welcome to Bedtime Story!',
       'We''ll post news about new stories and features here. Sweet dreams! 🌙',
       '🌙', 'all'
where not exists (select 1 from announcements);
