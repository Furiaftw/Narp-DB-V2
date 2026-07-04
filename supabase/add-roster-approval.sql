-- Roster double-approval system.
-- Reviewers (role = 'staff') may add roster entries/squad members, but their
-- additions are inserted with status = 'pending' and only become visible on
-- the public roster after a SECOND person (another Reviewer or an Admin)
-- approves them. Admins/Owners keep writing directly (rows default to
-- 'approved') via the existing admin policies, which are left untouched.
-- Apply via Supabase Dashboard → SQL Editor

ALTER TABLE public.roster_entries ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'approved';
ALTER TABLE public.roster_entries ADD COLUMN IF NOT EXISTS approved_by uuid;
ALTER TABLE public.roster_squads  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'approved';
ALTER TABLE public.roster_squads  ADD COLUMN IF NOT EXISTS approved_by uuid;

-- ── roster_entries ──────────────────────────────────────────────────────────

-- Staff may insert only pending submissions they own
DROP POLICY IF EXISTS "roster_entries_insert_staff_pending" ON public.roster_entries;
CREATE POLICY "roster_entries_insert_staff_pending" ON public.roster_entries
  FOR INSERT WITH CHECK (
    status = 'pending' AND created_by = auth.uid()
    AND EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'staff')
  );

-- Staff may update pending rows (edit their own, or approve someone else's)
DROP POLICY IF EXISTS "roster_entries_update_staff_pending" ON public.roster_entries;
CREATE POLICY "roster_entries_update_staff_pending" ON public.roster_entries
  FOR UPDATE USING (
    status = 'pending'
    AND EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'staff')
  )
  WITH CHECK (status IN ('pending', 'approved'));

-- Staff may delete pending rows (reject, or cancel their own submission)
DROP POLICY IF EXISTS "roster_entries_delete_staff_pending" ON public.roster_entries;
CREATE POLICY "roster_entries_delete_staff_pending" ON public.roster_entries
  FOR DELETE USING (
    status = 'pending'
    AND EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'staff')
  );

-- ── roster_squads ───────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "roster_squads_insert_staff_pending" ON public.roster_squads;
CREATE POLICY "roster_squads_insert_staff_pending" ON public.roster_squads
  FOR INSERT WITH CHECK (
    status = 'pending' AND created_by = auth.uid()
    AND EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'staff')
  );

DROP POLICY IF EXISTS "roster_squads_update_staff_pending" ON public.roster_squads;
CREATE POLICY "roster_squads_update_staff_pending" ON public.roster_squads
  FOR UPDATE USING (
    status = 'pending'
    AND EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'staff')
  )
  WITH CHECK (status IN ('pending', 'approved'));

DROP POLICY IF EXISTS "roster_squads_delete_staff_pending" ON public.roster_squads;
CREATE POLICY "roster_squads_delete_staff_pending" ON public.roster_squads
  FOR DELETE USING (
    status = 'pending'
    AND EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'staff')
  );
