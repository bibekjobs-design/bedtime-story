-- Run this once in Supabase's SQL editor (Project -> SQL Editor -> New query).
-- Creates the table that powers: (1) a real per-user History screen that
-- survives cache clears/device changes, and (2) "my creations" - showing a
-- parent how many stars their own uploaded-and-narrated stories got from
-- other users in the shared Library.
--
-- One row = one narration event: a Library play, a Create->Narrator
-- generation, or a Create->Clone narration. Cloned-voice events are private
-- by nature (queried only for their own user_id, never joined into public
-- Library/search results - same as personalized_stories already is).

create table if not exists story_events (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references users(id) on delete cascade,
    story_text_id uuid references story_texts(id) on delete set null,
    child_profile_id uuid references child_profiles(id) on delete set null,
    origin text not null check (origin in ('library', 'create_narrator', 'create_clone')),
    title text,
    voice_id text,
    voice_clone_id uuid references voice_clones(id) on delete set null,
    audio_url text,
    duration_seconds integer,
    created_at timestamptz not null default now()
);

-- Fast "latest history for this user" queries.
create index if not exists idx_story_events_user_created
    on story_events (user_id, created_at desc);

-- Fast "which shared stories did this user create" queries (My Creations).
create index if not exists idx_story_events_user_origin
    on story_events (user_id, origin, created_at desc);
