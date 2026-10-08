-- Stories narrated in a parent's cloned voice are deleted 10 days after they are made.
-- (Cloned voices themselves are kept until the parent deletes them.)
alter table personalized_stories add column if not exists expires_at timestamptz;
alter table story_events        add column if not exists expires_at timestamptz;
create index if not exists idx_personalized_stories_expires_at on personalized_stories (expires_at);

-- Undo the earlier version of this file: cloned voices must never expire.
alter table voice_clones add column if not exists expires_at timestamptz;
update voice_clones set expires_at = null;

-- Cloned-voice stories that already exist get 10 days from now ...
update personalized_stories set expires_at = now() + interval '10 days'
where voice_clone_id is not null and expires_at is null;
update story_events set expires_at = now() + interval '10 days'
where voice_clone_id is not null and expires_at is null;

-- ... except the admin/owner's, which never expire.
update personalized_stories set expires_at = null
where voice_clone_id in (select id from voice_clones where user_id in
  (select id from users where lower(email) = 'bibekjobs@gmail.com' or subscription_tier in ('admin','admin_vip','superadmin')));
update story_events set expires_at = null
where user_id in (select id from users where lower(email) = 'bibekjobs@gmail.com' or subscription_tier in ('admin','admin_vip','superadmin'));
