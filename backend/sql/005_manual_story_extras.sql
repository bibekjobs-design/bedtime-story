-- Adds an admin-uploaded cover picture per story, for the new "Create New
-- Story" (write-it-myself) flow. Run this once in the Supabase SQL editor,
-- same as 001/002/003/004.

alter table story_texts
    add column if not exists cover_image_url text;

-- Storage bucket for admin-uploaded story cover pictures (public, so the
-- app can display them without needing a signed URL every time).
insert into storage.buckets (id, name, public)
values ('story-covers', 'story-covers', true)
on conflict (id) do nothing;

-- Allow the backend's service-role key to read/write this bucket (same
-- pattern as the story-audio and category-images buckets). CREATE POLICY
-- has no IF NOT EXISTS in Postgres, so we drop-then-create to stay
-- re-runnable.
drop policy if exists "Public read story covers" on storage.objects;
create policy "Public read story covers"
    on storage.objects for select
    using (bucket_id = 'story-covers');

drop policy if exists "Service role can manage story covers" on storage.objects;
create policy "Service role can manage story covers"
    on storage.objects for all
    using (bucket_id = 'story-covers' and auth.role() = 'service_role')
    with check (bucket_id = 'story-covers' and auth.role() = 'service_role');
