-- Adds columns and triggers to support a state-based timer, priority sorting,
-- user 'Request Update' bump feature, and real-time user notification unread state.
-- Run this once in the Supabase SQL Editor (Dashboard > SQL Editor > New query).

-- 1. Add columns to pending_jutsus (or equivalent tables)
ALTER TABLE public.pending_jutsus
  ADD COLUMN IF NOT EXISTS last_status_change TIMESTAMP WITH TIME ZONE DEFAULT now(),
  ADD COLUMN IF NOT EXISTS is_bumped BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS has_user_unread BOOLEAN DEFAULT false;

-- 2. Add column to pending_chats
ALTER TABLE public.pending_chats
  ADD COLUMN IF NOT EXISTS is_system_message BOOLEAN DEFAULT false;

-- 3. Create trigger function to update last_status_change on status change
CREATE OR REPLACE FUNCTION public.update_last_status_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF (TG_OP = 'INSERT') OR (OLD.status IS DISTINCT FROM NEW.status) THEN
    NEW.last_status_change := now();
  END IF;
  RETURN NEW;
END;
$$;

-- 4. Create trigger on pending_jutsus
DROP TRIGGER IF EXISTS tr_pending_jutsus_status_change ON public.pending_jutsus;
CREATE TRIGGER tr_pending_jutsus_status_change
  BEFORE INSERT OR UPDATE OF status
  ON public.pending_jutsus
  FOR EACH ROW
  EXECUTE FUNCTION public.update_last_status_change();

-- 5. Create trigger function to update last_status_change and has_user_unread on new chats (replies)
CREATE OR REPLACE FUNCTION public.update_last_status_change_on_chat()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_role TEXT;
BEGIN
  -- 1. Update last_status_change
  UPDATE public.pending_jutsus
     SET last_status_change = now()
   WHERE id = NEW.pending_id;

  -- 2. Check the sender's role in profiles
  SELECT role INTO v_role
    FROM public.profiles
   WHERE id = NEW.sender_id;

  -- 3. If role is staff, admin, or owner, set has_user_unread = true
  IF v_role IN ('staff', 'admin', 'owner') THEN
    UPDATE public.pending_jutsus
       SET has_user_unread = true
     WHERE id = NEW.pending_id;
  END IF;

  RETURN NEW;
END;
$$;

-- 6. Create trigger on pending_chats
DROP TRIGGER IF EXISTS tr_pending_chats_insert ON public.pending_chats;
CREATE TRIGGER tr_pending_chats_insert
  AFTER INSERT
  ON public.pending_chats
  FOR EACH ROW
  EXECUTE FUNCTION public.update_last_status_change_on_chat();
