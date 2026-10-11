create table if not exists support_messages (
    id          uuid primary key default gen_random_uuid(),
    user_id     uuid references users(id) on delete cascade,
    user_name   text,
    user_email  text,
    plan        text,
    message     text not null,
    is_read     boolean not null default false,
    created_at  timestamptz not null default now()
);
create index if not exists idx_support_messages_created on support_messages (created_at desc);
alter table support_messages enable row level security;
