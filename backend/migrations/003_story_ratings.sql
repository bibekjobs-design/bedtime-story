-- ====================================================================
-- Story Ratings Schema & Performance Index for Bedtime Story App
-- Run this SQL in your Supabase SQL Editor
-- ====================================================================

-- 1. Add rating aggregation columns to story_texts if they don't exist
ALTER TABLE story_texts 
  ADD COLUMN IF NOT EXISTS average_rating NUMERIC(3,2) DEFAULT 5.00,
  ADD COLUMN IF NOT EXISTS total_ratings INTEGER DEFAULT 1;

-- 2. Create story_ratings table for individual user/device votes
CREATE TABLE IF NOT EXISTS story_ratings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  story_text_id UUID NOT NULL REFERENCES story_texts(id) ON DELETE CASCADE,
  user_id UUID,
  device_id TEXT,
  rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Create unique index so a user or device can only have 1 active rating per story (supports re-rating)
CREATE UNIQUE INDEX IF NOT EXISTS idx_story_ratings_user_story 
  ON story_ratings (story_text_id, user_id) 
  WHERE user_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_story_ratings_device_story 
  ON story_ratings (story_text_id, device_id) 
  WHERE user_id IS NULL AND device_id IS NOT NULL;

-- 4. Fast lookup index for story text ratings
CREATE INDEX IF NOT EXISTS idx_story_ratings_story_id 
  ON story_ratings (story_text_id);

-- 5. Sorting index for Top Rated stories
CREATE INDEX IF NOT EXISTS idx_story_texts_rating_sort 
  ON story_texts (average_rating DESC, total_ratings DESC);
