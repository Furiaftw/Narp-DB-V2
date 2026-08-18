-- ============================================================================
-- FIX: infinite recursion between battles / battle_participants RLS policies
-- ============================================================================
-- add-combat-tracker.sql shipped policies that read across (and, in one
-- case, back into) each other's table:
--
--   battles_select             ──subquery──▶ battle_participants
--   battle_participants_select ──subquery──▶ battles
--   battle_participants_select ──subquery──▶ battle_participants (itself)
--
-- Evaluating any of these re-enters a policy that's still being evaluated,
-- so Postgres aborts with "infinite recursion detected in policy for
-- relation battle_participants". Same root cause and same fix as
-- fix-rp-participants-rls-recursion.sql: read the other table (or, for the
-- self-reference, the same table) through a SECURITY DEFINER helper, which
-- does not re-invoke RLS. Visible permissions are unchanged.
--
-- Idempotent: safe to re-run. Applies on top of add-combat-tracker.sql
-- (whose policy bodies have been corrected to match, for fresh installs).
-- ============================================================================

-- ─── HELPERS ─────────────────────────────────────────────────────────────────

-- Battles the caller participates in (drives battles_select and, plainly,
-- battle_participants_select's own "am I in this battle" branch).
create or replace function public.my_battle_ids_as_participant()
returns setof uuid
language sql stable security definer
set search_path = public
as $$ select battle_id from battle_participants where user_id = auth.uid(); $$;

-- Battles the caller hosts, plus any open-lobby draft (public by design).
create or replace function public.my_hosted_or_open_battle_ids()
returns setof uuid
language sql stable security definer
set search_path = public
as $$
  select id from battles
   where host_id = auth.uid() or (status = 'draft' and visibility_mode = 'open');
$$;

-- ─── POLICIES ────────────────────────────────────────────────────────────────

drop policy if exists "battles_select" on public.battles;
create policy "battles_select"
  on public.battles for select
  using (
    (status = 'draft' and visibility_mode = 'open')
    or host_id = auth.uid()
    or public.is_reviewer_or_above()
    or id in (select public.my_battle_ids_as_participant())
  );

drop policy if exists "battle_participants_select" on public.battle_participants;
create policy "battle_participants_select"
  on public.battle_participants for select
  using (
    user_id = auth.uid()
    or public.is_reviewer_or_above()
    or battle_id in (select public.my_hosted_or_open_battle_ids())
    or battle_id in (select public.my_battle_ids_as_participant())
  );

drop policy if exists "battle_turn_log_select" on public.battle_turn_log;
create policy "battle_turn_log_select"
  on public.battle_turn_log for select
  using (
    public.is_reviewer_or_above()
    or battle_id in (select id from battles where host_id = auth.uid())
    or battle_id in (select public.my_battle_ids_as_participant())
  );
