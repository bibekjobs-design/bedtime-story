-- Adds a one-time-generated cover picture per category. Run this once in
-- the Supabase SQL editor, same as 001/002/003.

alter table story_categories
    add column if not exists image_url text;

-- Storage bucket for the generated category pictures (public, so the app
-- can display them without needing a signed URL every time).
insert into storage.buckets (id, name, public)
values ('category-images', 'category-images', true)
on conflict (id) do nothing;

-- Allow the backend's service-role key to read/write this bucket (matches
-- the existing pattern for the story-audio bucket). CREATE POLICY has no
-- IF NOT EXISTS in Postgres, so we drop-then-create to stay re-runnable.
drop policy if exists "Public read category images" on storage.objects;
create policy "Public read category images"
    on storage.objects for select
    using (bucket_id = 'category-images');

drop policy if exists "Service role can manage category images" on storage.objects;
create policy "Service role can manage category images"
    on storage.objects for all
    using (bucket_id = 'category-images' and auth.role() = 'service_role')
    with check (bucket_id = 'category-images' and auth.role() = 'service_role');
