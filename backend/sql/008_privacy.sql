-- Voice clones are removed automatically 10 days after they are created.
alter table voice_clones add column if not exists expires_at timestamptz;
create index if not exists idx_voice_clones_expires_at on voice_clones (expires_at);
-- Clones that already exist: give them 10 days from now.
update voice_clones set expires_at = now() + interval '10 days' where expires_at is null;
