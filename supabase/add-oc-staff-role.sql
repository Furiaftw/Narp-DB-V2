-- Adds a new 'oc_staff' role tier ("Staff" in the UI): a reviewer restricted
-- to OC (Character) submissions only. Additive — the existing 'staff'
-- ("Reviewer") tier is untouched and keeps full access to both jutsus and
-- OCs; oc_staff can only ever claim/review/approve/deny/chat on
-- pending_jutsus rows where data->>'type' = 'Character'.

ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_role_check;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_role_check
  CHECK (role = ANY (ARRAY['user'::text, 'staff'::text, 'oc_staff'::text, 'admin'::text, 'owner'::text]));

-- Let admins (not just the owner) assign/revoke oc_staff, same as they
-- already do for 'staff'.
DROP POLICY IF EXISTS "Admin updates user/staff roles" ON public.profiles;
CREATE POLICY "Admin updates user/staff roles" ON public.profiles
  FOR UPDATE
  USING (is_admin_or_above() AND role = ANY (ARRAY['user'::text, 'staff'::text, 'oc_staff'::text]))
  WITH CHECK (is_admin_or_above() AND role = ANY (ARRAY['user'::text, 'staff'::text, 'oc_staff'::text]));

-- Let oc_staff self-update their own profile (nickname etc.), same as staff+.
DROP POLICY IF EXISTS "Staff can update own profile" ON public.profiles;
CREATE POLICY "Staff can update own profile" ON public.profiles
  FOR UPDATE
  USING (
    id = auth.uid()
    AND (SELECT role FROM public.profiles p WHERE p.id = auth.uid()) = ANY (ARRAY['staff'::text, 'admin'::text, 'owner'::text, 'oc_staff'::text])
  )
  WITH CHECK (
    id = auth.uid()
    AND (SELECT role FROM public.profiles p WHERE p.id = auth.uid()) = ANY (ARRAY['staff'::text, 'admin'::text, 'owner'::text, 'oc_staff'::text])
  );

-- pending_jutsus: oc_staff may claim/review/approve/deny/edit only
-- Character-type (OC) entries.
DROP POLICY IF EXISTS "oc_staff_update_pending" ON public.pending_jutsus;
CREATE POLICY "oc_staff_update_pending" ON public.pending_jutsus
  FOR UPDATE USING (
    (data->>'type' = 'Character')
    AND EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'oc_staff')
  );

DROP POLICY IF EXISTS "oc_staff_delete_pending" ON public.pending_jutsus;
CREATE POLICY "oc_staff_delete_pending" ON public.pending_jutsus
  FOR DELETE USING (
    (data->>'type' = 'Character')
    AND EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'oc_staff')
  );

-- pending_chats: oc_staff may read/post only in Character-type (OC) threads.
DROP POLICY IF EXISTS "oc_staff_read_chats" ON public.pending_chats;
CREATE POLICY "oc_staff_read_chats" ON public.pending_chats
  FOR SELECT USING (
    is_staff_only = false
    AND EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'oc_staff')
    AND pending_id IN (SELECT id FROM public.pending_jutsus WHERE data->>'type' = 'Character')
  );

DROP POLICY IF EXISTS "oc_staff_insert_chats" ON public.pending_chats;
CREATE POLICY "oc_staff_insert_chats" ON public.pending_chats
  FOR INSERT WITH CHECK (
    is_staff_only = false
    AND sender_id = auth.uid()
    AND EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'oc_staff')
    AND pending_id IN (SELECT id FROM public.pending_jutsus WHERE data->>'type' = 'Character')
  );
