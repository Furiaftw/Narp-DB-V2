-- Monthly, aggregated staff/reviewer work-log stats — for the in-app "Work
-- Log" tab. Additive only: the existing Discord work-log system
-- (reviewer-work-log.mjs, per-reviewer Discord threads) is untouched and
-- keeps logging the detailed per-item narrative. This table only stores
-- small monthly counters per (user, month, action type) so the database
-- footprint stays tiny regardless of submission volume.
-- Apply via Supabase Dashboard → SQL Editor.

CREATE TABLE IF NOT EXISTS public.work_log_monthly (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES public.profiles(id),
  username    text NOT NULL,
  role        text NOT NULL,
  month_start date NOT NULL,
  action_type text NOT NULL,
  count       integer NOT NULL DEFAULT 0,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, month_start, action_type)
);

ALTER TABLE public.work_log_monthly ENABLE ROW LEVEL SECURITY;

-- Everyone can read their own rows (staff/reviewer viewing just their own work).
DROP POLICY IF EXISTS "own_read" ON public.work_log_monthly;
CREATE POLICY "own_read" ON public.work_log_monthly
  FOR SELECT USING (auth.uid() = user_id);

-- Admin/owner can read everyone's rows.
DROP POLICY IF EXISTS "admin_read_all" ON public.work_log_monthly;
CREATE POLICY "admin_read_all" ON public.work_log_monthly
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role IN ('admin', 'owner')
    )
  );

-- All writes go through increment_work_log() (SECURITY DEFINER) below;
-- there is deliberately no direct INSERT/UPDATE policy for clients.

-- p_target_user_id lets a staff+ caller credit ANOTHER reviewer's counter —
-- needed because the final approver is the one who calls this (client-side)
-- when crediting the "First Reviewer" who claimed the item earlier; without
-- this, that entry would be misattributed to the approver via auth.uid().
-- Self-logging (the common case) omits it and defaults to auth.uid().
CREATE OR REPLACE FUNCTION public.increment_work_log(p_action_type text, p_target_user_id uuid DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_role text;
  v_target_id   uuid;
  v_username    text;
  v_role        text;
BEGIN
  SELECT role INTO v_caller_role FROM public.profiles WHERE id = auth.uid();
  IF v_caller_role IS NULL THEN
    RAISE EXCEPTION 'no profile for current user';
  END IF;

  v_target_id := COALESCE(p_target_user_id, auth.uid());

  -- Logging on behalf of someone else requires staff+ — matches the RLS
  -- gate already on pending_jutsus updates (only staff/admin/owner can
  -- review/approve, so only they can trigger a credit for someone else).
  IF v_target_id <> auth.uid() AND v_caller_role NOT IN ('staff', 'admin', 'owner') THEN
    RAISE EXCEPTION 'not permitted to log work for another user';
  END IF;

  SELECT username, role INTO v_username, v_role FROM public.profiles WHERE id = v_target_id;
  IF v_username IS NULL THEN
    RAISE EXCEPTION 'no profile for target user';
  END IF;

  INSERT INTO public.work_log_monthly (user_id, username, role, month_start, action_type, count)
  VALUES (v_target_id, v_username, v_role, date_trunc('month', now())::date, p_action_type, 1)
  ON CONFLICT (user_id, month_start, action_type)
  DO UPDATE SET
    count      = work_log_monthly.count + 1,
    username   = EXCLUDED.username,
    role       = EXCLUDED.role,
    updated_at = now();
END;
$$;

GRANT EXECUTE ON FUNCTION public.increment_work_log(text, uuid) TO authenticated;
