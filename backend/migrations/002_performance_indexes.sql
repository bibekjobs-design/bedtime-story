-- ====================================================================
-- Performance Optimization Indexes for Bedtime Story App
-- Run these SQL statements in your Supabase SQL Editor
-- ====================================================================

-- 1. Index on story_texts for ultra-fast library browsing & sorting
CREATE INDEX IF NOT EXISTS idx_story_texts_age_lang_served 
  ON story_texts (age_group_id, language_id, times_served DESC);

-- 2. Index on story_texts for category filtering
CREATE INDEX IF NOT EXISTS idx_story_texts_category_age 
  ON story_texts (category_id, age_group_id);

-- 3. Index on story_texts for text and keyword search
CREATE INDEX IF NOT EXISTS idx_story_texts_title_trgm 
  ON story_texts USING gin (title gin_trgm_ops);

-- 4. Foreign key index on story_audio for instantaneous joined lookup
CREATE INDEX IF NOT EXISTS idx_story_audio_story_text_id 
  ON story_audio (story_text_id);

-- 5. Composite index on story_audio for exact voice persona lookup
CREATE INDEX IF NOT EXISTS idx_story_audio_text_voice 
  ON story_audio (story_text_id, voice_tier);

-- 6. Index on usage_tracking for quota verification
CREATE INDEX IF NOT EXISTS idx_usage_tracking_user_period 
  ON usage_tracking (user_id, usage_type, period_month);

-- 7. Index on child_profiles for parent profile loading
CREATE INDEX IF NOT EXISTS idx_child_profiles_user_id 
  ON child_profiles (user_id);
