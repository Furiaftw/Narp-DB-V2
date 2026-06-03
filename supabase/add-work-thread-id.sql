-- Adds the per-user `work_thread_id` column to public.profiles.
-- Run this once in the Supabase SQL Editor (Dashboard > SQL Editor > New query)
-- to enable saving Discord work thread IDs for team members.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS work_thread_id TEXT;
