-- Tracks Google Cloud TTS characters synthesized per calendar month, platform-wide,
-- so the app can guard against exceeding the shared 1,000,000-char/month free quota
-- and alert the admin (dashboard + email) at 70% / 90% / 100% usage.
-- Run this once in the Supabase SQL editor, same as 001_story_events.sql.

create table if not exists tts_usage_monthly (
    period_month date primary key,           -- first day of the month, e.g. 2026-09-01
    characters_used bigint not null default 0,
    alert_70_sent boolean not null default false,
    alert_90_sent boolean not null default false,
    alert_100_sent boolean not null default false,
    updated_at timestamptz not null default now()
);
