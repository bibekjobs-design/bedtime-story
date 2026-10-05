-- Run this ONCE in Supabase: SQL Editor -> New query -> paste -> Run.
-- It makes stories created by a user (AI Generator / file upload) private to that user.

-- 1) New column: who owns the story. NULL = public story (Home library, admin-published).
alter table public.story_texts
  add column if not exists owner_user_id uuid null;

create index if not exists story_texts_owner_user_id_idx
  on public.story_texts (owner_user_id);

-- 2) OPTIONAL but recommended: make stories that users ALREADY created private too.
--    It finds them from the history log (story_events with origin 'create_narrator').
update public.story_texts st
set owner_user_id = ev.user_id
from (
  select distinct on (story_text_id) story_text_id, user_id
  from public.story_events
  where origin = 'create_narrator' and story_text_id is not null
  order by story_text_id, created_at asc
) ev
where st.id = ev.story_text_id
  and st.owner_user_id is null;
