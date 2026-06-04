-- Adds three columns to public.bloodlines for the Bloodlines Roster tab.
-- Run once in the Supabase SQL Editor or apply via MCP.

ALTER TABLE public.bloodlines
  ADD COLUMN IF NOT EXISTS proprietary_ability_link TEXT,
  ADD COLUMN IF NOT EXISTS max_slots INTEGER DEFAULT 5,
  ADD COLUMN IF NOT EXISTS slots JSONB;
