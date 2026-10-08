-- Ratings: table + columns the app expects (safe to run more than once)
create table if not exists story_ratings (
  id uuid primary key default gen_random_uuid(),
  story_text_id uuid not null references story_texts(id) on delete cascade,
  user_id uuid,
  device_id text,
  rating int not null check (rating between 1 and 5),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create index if not exists story_ratings_story_idx on story_ratings(story_text_id);
alter table story_texts add column if not exists average_rating numeric default 0;
alter table story_texts add column if not exists total_ratings int default 0;
