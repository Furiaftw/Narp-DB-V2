-- ============================================================================
-- FIX: infinite recursion between rp_submissions and rp_participants policies
-- ============================================================================
-- add-rp-grading-upgrades.sql shipped two policies that reference each other's
-- table:
--
--   rp_submissions_select  ──subquery──▶ rp_participants
--   rp_participants_*      ──subquery──▶ rp_submissions
--
-- Evaluating either one re-enters the other, so Postgres aborts with
-- "infinite recursion detected in policy for relation rp_participants".
-- It only surfaced for signed-in users below grader: grader+ short-circuits on
-- is_grader_or_above() before reaching the recursive branch.
--
-- The remedy is the standard one for mutually-referential policies: read the
-- other table through a SECURITY DEFINER helper, which does not re-invoke RLS.
-- The visible permissions are unchanged — only how they are evaluated.
--
-- Idempotent: safe to re-run. Applies on top of add-rp-grading-upgrades.sql
-- (whose policy bodies have been corrected to match, for fresh installs).
-- ============================================================================

-- ─── HELPERS ─────────────────────────────────────────────────────────────────
-- Deliberately left with their default EXECUTE grants, matching the existing
-- is_*_or_above() predicates: they are evaluated inside RLS, and return an
-- empty set when auth.uid() is null (anonymous).

-- Submissions the caller takes part in (drives rp_submissions_select).
create or replace function public.my_participating_rp_ids()
returns setof uuid
language sql stable security definer
set search_path = public
as $$ select submission_id from rp_participants where user_id = auth.uid(); $$;

-- Submissions the caller filed. p_only_pending narrows to ones still editable,
-- which is what the participant write policies gate on.
create or replace function public.my_rp_submission_ids(p_only_pending boolean default false)
returns setof uuid
language sql stable security definer
set search_path = public
as $$
  select id from rp_submissions
   where submitter_id = auth.uid()
     and (not p_only_pending or status = 'pending');
$$;

-- ─── POLICIES ────────────────────────────────────────────────────────────────

drop policy if exists "rp_submissions_select" on public.rp_submissions;
create policy "rp_submissions_select"
  on public.rp_submissions for select
  using (
    submitter_id = auth.uid()
    or public.is_grader_or_above()
    or id in (select public.my_participating_rp_ids())
  );

drop policy if exists "rp_participants_select" on public.rp_participants;
create policy "rp_participants_select"
  on public.rp_participants for select
  using (
    user_id = auth.uid()
    or public.is_grader_or_above()
    or submission_id in (select public.my_rp_submission_ids())
  );

drop policy if exists "rp_participants_insert" on public.rp_participants;
create policy "rp_participants_insert"
  on public.rp_participants for insert
  with check (submission_id in (select public.my_rp_submission_ids(true)));

drop policy if exists "rp_participants_update" on public.rp_participants;
create policy "rp_participants_update"
  on public.rp_participants for update
  using (submission_id in (select public.my_rp_submission_ids(true)));

drop policy if exists "rp_participants_delete" on public.rp_participants;
create policy "rp_participants_delete"
  on public.rp_participants for delete
  using (
    submission_id in (select public.my_rp_submission_ids(true))
    or public.is_admin_or_above()
  );
