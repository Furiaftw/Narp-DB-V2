-- Clean up broken database triggers and functions left behind by the reverted notification/bell features.
-- Run this in the Supabase SQL Editor (Dashboard > SQL Editor > New query) to restore chat functionality.

-- 1. Drop trigger and function on pending_chats
DROP TRIGGER IF EXISTS tr_pending_chats_insert ON public.pending_chats;
DROP FUNCTION IF EXISTS public.update_last_status_change_on_chat();

-- 2. Drop trigger and function on pending_jutsus
DROP TRIGGER IF EXISTS tr_pending_jutsus_status_change ON public.pending_jutsus;
DROP FUNCTION IF EXISTS public.update_last_status_change();

-- 3. Safely remove columns if they exist and are no longer used
-- (These are already removed from the frontend codebase)
ALTER TABLE public.pending_jutsus DROP COLUMN IF EXISTS last_status_change;
ALTER TABLE public.pending_jutsus DROP COLUMN IF EXISTS is_bumped;
ALTER TABLE public.pending_jutsus DROP COLUMN IF EXISTS has_user_unread;
ALTER TABLE public.pending_chats DROP COLUMN IF EXISTS is_system_message;
