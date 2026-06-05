-- Enable RLS on pending_jutsus
-- Apply via Supabase Dashboard → SQL Editor

ALTER TABLE public.pending_jutsus ENABLE ROW LEVEL SECURITY;

-- Submitters see only their own submissions
CREATE POLICY "submitter_read_own" ON public.pending_jutsus
  FOR SELECT USING (auth.uid() = submitted_by);

-- Staff/admin/owner see all submissions
CREATE POLICY "staff_read_all" ON public.pending_jutsus
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role IN ('staff', 'admin', 'owner')
    )
  );

-- Any authenticated user may insert their own submission
CREATE POLICY "auth_insert_own" ON public.pending_jutsus
  FOR INSERT WITH CHECK (auth.uid() = submitted_by);

-- Staff/admin/owner may update (claim, review, approve)
CREATE POLICY "staff_update" ON public.pending_jutsus
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role IN ('staff', 'admin', 'owner')
    )
  );

-- Admin/owner may delete
CREATE POLICY "admin_delete" ON public.pending_jutsus
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role IN ('admin', 'owner')
    )
  );

-- Enable RLS on pending_chats
ALTER TABLE public.pending_chats ENABLE ROW LEVEL SECURITY;

-- Only submitter or staff can read chat for a submission
CREATE POLICY "participant_read" ON public.pending_chats
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.pending_jutsus pj
      WHERE pj.id = pending_id
        AND (
          pj.submitted_by = auth.uid()
          OR EXISTS (
            SELECT 1 FROM public.profiles
            WHERE id = auth.uid() AND role IN ('staff', 'admin', 'owner')
          )
        )
    )
  );

-- Any authenticated user may insert chat messages
CREATE POLICY "participant_insert" ON public.pending_chats
  FOR INSERT WITH CHECK (auth.uid() = sender_id);
