-- ============================================================================
-- ROLE MIGRATION: user / grader / reviewer / admin / owner
-- ============================================================================
-- Replaces the old role set (user / staff / oc_staff / admin / owner) with the
-- new five-tier ladder. The 'staff' role is removed entirely:
--
--   old 'staff'    -> 'reviewer'  (the UI already labelled these users
--                                  "Reviewer"; full review powers + Gate 2
--                                  upgrade approvals in the RP system)
--   old 'oc_staff' -> 'grader'    (the UI labelled these "Staff (OC only)";
--                                  keeps Character-only review powers + gains
--                                  Gate 1 RP grading in the RP system)
--
-- Run this in the Supabase SQL Editor *together with* deploying the client
-- code that uses the new role names — the old client checks for 'staff' and
-- will lose its gates once the data below is migrated. Idempotent: safe to
-- re-run.
--
-- Companion file: add-rp-grading-upgrades.sql (depends on the helper
-- functions defined here).
-- ============================================================================

-- ─── 1. CHECK CONSTRAINTS OFF, DATA MIGRATED, CONSTRAINTS BACK ON ────────────

alter table public.profiles  drop constraint if exists profiles_role_check;
alter table public.whitelist drop constraint if exists whitelist_role_check;

update public.profiles set role = 'reviewer' where role = 'staff';
update public.profiles set role = 'grader'   where role = 'oc_staff';
update public.whitelist set role = 'reviewer' where role = 'staff';

alter table public.profiles add constraint profiles_role_check
  check (role = any (array['user'::text, 'grader'::text, 'reviewer'::text, 'admin'::text, 'owner'::text]));
alter table public.whitelist add constraint whitelist_role_check
  check (role = any (array['grader'::text, 'reviewer'::text, 'admin'::text]));

-- Discord role-ID config: the grader tier inherits the old OC-staff Discord
-- role mapping so existing Discord role assignments keep working.
insert into public.webhook_config (config_key, config_value, description)
select 'discord_grader_role_id', config_value,
       'Discord role ID that maps to the grader tier (was discord_oc_staff_role_id)'
  from public.webhook_config
 where config_key = 'discord_oc_staff_role_id'
on conflict (config_key) do nothing;

-- ─── 2. ROLE HELPER FUNCTIONS ────────────────────────────────────────────────

create or replace function public.is_reviewer_or_above()
returns boolean
language sql stable security definer
set search_path = public
as $$ select coalesce((select role in ('reviewer', 'admin', 'owner') from profiles where id = auth.uid()), false); $$;

create or replace function public.is_grader_or_above()
returns boolean
language sql stable security definer
set search_path = public
as $$ select coalesce((select role in ('grader', 'reviewer', 'admin', 'owner') from profiles where id = auth.uid()), false); $$;

-- ─── 3. POLICIES: character_sheets ───────────────────────────────────────────

drop policy if exists "Owner or staff creates character sheets" on public.character_sheets;
drop policy if exists "Owner or team creates character sheets"  on public.character_sheets;
create policy "Owner or team creates character sheets"
  on public.character_sheets for insert
  with check (
    owner_id = auth.uid() or exists (
      select 1 from profiles
      where id = auth.uid() and role in ('grader', 'reviewer', 'admin', 'owner')
    )
  );

drop policy if exists "Owner or staff updates character sheets" on public.character_sheets;
drop policy if exists "Owner or team updates character sheets"  on public.character_sheets;
create policy "Owner or team updates character sheets"
  on public.character_sheets for update
  using (
    owner_id = auth.uid() or exists (
      select 1 from profiles
      where id = auth.uid() and role in ('grader', 'reviewer', 'admin', 'owner')
    )
  );

-- ─── 4. POLICIES: jutsu_review_history (was gated on is_staff_or_above) ──────

drop policy if exists "Staff+ can insert jutsu review history"    on public.jutsu_review_history;
drop policy if exists "Reviewer+ can insert jutsu review history" on public.jutsu_review_history;
create policy "Reviewer+ can insert jutsu review history"
  on public.jutsu_review_history for insert
  with check (public.is_reviewer_or_above());

drop policy if exists "Staff+ can read jutsu review history"    on public.jutsu_review_history;
drop policy if exists "Reviewer+ can read jutsu review history" on public.jutsu_review_history;
create policy "Reviewer+ can read jutsu review history"
  on public.jutsu_review_history for select
  using (public.is_reviewer_or_above());

-- ─── 5. POLICIES: jutsu_type_tags ────────────────────────────────────────────

drop policy if exists "Staff can manage jutsu_type_tags"     on public.jutsu_type_tags;
drop policy if exists "Reviewer+ can manage jutsu_type_tags" on public.jutsu_type_tags;
create policy "Reviewer+ can manage jutsu_type_tags"
  on public.jutsu_type_tags for all
  using (
    exists (select 1 from profiles where id = auth.uid() and role in ('reviewer', 'admin', 'owner'))
  )
  with check (
    exists (select 1 from profiles where id = auth.uid() and role in ('reviewer', 'admin', 'owner'))
  );

-- ─── 6. POLICIES: pending_chats ──────────────────────────────────────────────
-- Same shape as before: public messages are visible to the submitter of that
-- pending entry and to reviewer+; team-only (is_staff_only) messages are for
-- the owner, or reviewer/admin who did not submit the entry themselves.

drop policy if exists "Insert chats policy" on public.pending_chats;
create policy "Insert chats policy"
  on public.pending_chats for insert
  with check (
    (
      is_staff_only = false and (
        pending_id in (select id from pending_jutsus where submitted_by = auth.uid())
        or (select role from profiles where id = auth.uid()) in ('reviewer', 'admin', 'owner')
      )
    ) or (
      is_staff_only = true and (
        (select role from profiles where id = auth.uid()) = 'owner'
        or (
          (select role from profiles where id = auth.uid()) in ('reviewer', 'admin')
          and not (auth.uid() in (select submitted_by from pending_jutsus where id = pending_chats.pending_id))
        )
      )
    )
  );

drop policy if exists "View chats policy" on public.pending_chats;
create policy "View chats policy"
  on public.pending_chats for select
  using (
    (
      is_staff_only = false and (
        pending_id in (select id from pending_jutsus where submitted_by = auth.uid())
        or (select role from profiles where id = auth.uid()) in ('reviewer', 'admin', 'owner')
      )
    ) or (
      is_staff_only = true and (
        (select role from profiles where id = auth.uid()) = 'owner'
        or (
          (select role from profiles where id = auth.uid()) in ('reviewer', 'admin')
          and not (auth.uid() in (select submitted_by from pending_jutsus where id = pending_chats.pending_id))
        )
      )
    )
  );

-- Graders (old oc_staff) keep their Character-thread-only chat access.
drop policy if exists "oc_staff_insert_chats" on public.pending_chats;
drop policy if exists "grader_insert_chats"   on public.pending_chats;
create policy "grader_insert_chats"
  on public.pending_chats for insert
  with check (
    is_staff_only = false
    and sender_id = auth.uid()
    and exists (select 1 from profiles where id = auth.uid() and role = 'grader')
    and pending_id in (select id from pending_jutsus where data->>'type' = 'Character')
  );

drop policy if exists "oc_staff_read_chats" on public.pending_chats;
drop policy if exists "grader_read_chats"   on public.pending_chats;
create policy "grader_read_chats"
  on public.pending_chats for select
  using (
    is_staff_only = false
    and exists (select 1 from profiles where id = auth.uid() and role = 'grader')
    and pending_id in (select id from pending_jutsus where data->>'type' = 'Character')
  );

-- ─── 7. POLICIES: pending_jutsus ─────────────────────────────────────────────
-- ("Anyone can view/submit pending", "Submitters can insert" and the
-- admin-cancel policy contain no role names and are left untouched.)

drop policy if exists "Pending insert by staff+"    on public.pending_jutsus;
drop policy if exists "Pending insert by reviewer+" on public.pending_jutsus;
create policy "Pending insert by reviewer+"
  on public.pending_jutsus for insert
  with check (public.is_reviewer_or_above() and submitted_by = auth.uid());

drop policy if exists "Pending read by staff+"    on public.pending_jutsus;
drop policy if exists "Pending read by reviewer+" on public.pending_jutsus;
create policy "Pending read by reviewer+"
  on public.pending_jutsus for select
  using (public.is_reviewer_or_above());

drop policy if exists "Users can view their own pending items" on public.pending_jutsus;
create policy "Users can view their own pending items"
  on public.pending_jutsus for select
  using (auth.uid() = submitted_by or public.is_reviewer_or_above());

drop policy if exists "Staff can delete"             on public.pending_jutsus;
drop policy if exists "Staff can delete pending"     on public.pending_jutsus;
drop policy if exists "Reviewer+ can delete pending" on public.pending_jutsus;
create policy "Reviewer+ can delete pending"
  on public.pending_jutsus for delete
  using (
    auth.uid() = submitted_by
    or (select role from profiles where id = auth.uid()) in ('reviewer', 'admin', 'owner')
  );

drop policy if exists "Staff can update"             on public.pending_jutsus;
drop policy if exists "Staff can update pending"     on public.pending_jutsus;
drop policy if exists "Reviewer+ can update pending" on public.pending_jutsus;
create policy "Reviewer+ can update pending"
  on public.pending_jutsus for update
  using (
    auth.uid() = submitted_by
    or (select role from profiles where id = auth.uid()) in ('reviewer', 'admin', 'owner')
  );

drop policy if exists "oc_staff_update_pending" on public.pending_jutsus;
drop policy if exists "grader_update_pending"   on public.pending_jutsus;
create policy "grader_update_pending"
  on public.pending_jutsus for update
  using (
    data->>'type' = 'Character'
    and exists (select 1 from profiles where id = auth.uid() and role = 'grader')
  );

drop policy if exists "oc_staff_delete_pending" on public.pending_jutsus;
drop policy if exists "grader_delete_pending"   on public.pending_jutsus;
create policy "grader_delete_pending"
  on public.pending_jutsus for delete
  using (
    data->>'type' = 'Character'
    and exists (select 1 from profiles where id = auth.uid() and role = 'grader')
  );

-- ─── 8. POLICIES: profiles ───────────────────────────────────────────────────
-- Admins can flip people between user / grader / reviewer; only the owner
-- touches admins (unchanged "Owner updates any profile" policy handles that).

drop policy if exists "Admin updates user/staff roles"    on public.profiles;
drop policy if exists "Admin updates sub-admin roles"     on public.profiles;
create policy "Admin updates sub-admin roles"
  on public.profiles for update
  using (public.is_admin_or_above() and role in ('user', 'grader', 'reviewer'))
  with check (public.is_admin_or_above() and role in ('user', 'grader', 'reviewer'));

drop policy if exists "Staff can update own profile" on public.profiles;
drop policy if exists "Team can update own profile"  on public.profiles;
create policy "Team can update own profile"
  on public.profiles for update
  using (
    id = auth.uid()
    and (select p.role from profiles p where p.id = auth.uid()) in ('grader', 'reviewer', 'admin', 'owner')
  )
  with check (
    id = auth.uid()
    and (select p.role from profiles p where p.id = auth.uid()) in ('grader', 'reviewer', 'admin', 'owner')
  );

-- ─── 9. POLICIES: roster double-approval (was staff-only proposals) ──────────

drop policy if exists "roster_entries_insert_staff_pending"    on public.roster_entries;
drop policy if exists "roster_entries_insert_reviewer_pending" on public.roster_entries;
create policy "roster_entries_insert_reviewer_pending"
  on public.roster_entries for insert
  with check (
    status = 'pending' and created_by = auth.uid()
    and exists (select 1 from profiles where id = auth.uid() and role = 'reviewer')
  );

drop policy if exists "roster_entries_update_staff_pending"    on public.roster_entries;
drop policy if exists "roster_entries_update_reviewer_pending" on public.roster_entries;
create policy "roster_entries_update_reviewer_pending"
  on public.roster_entries for update
  using (
    status = 'pending'
    and exists (select 1 from profiles where id = auth.uid() and role = 'reviewer')
  )
  with check (status in ('pending', 'approved'));

drop policy if exists "roster_entries_delete_staff_pending"    on public.roster_entries;
drop policy if exists "roster_entries_delete_reviewer_pending" on public.roster_entries;
create policy "roster_entries_delete_reviewer_pending"
  on public.roster_entries for delete
  using (
    status = 'pending'
    and exists (select 1 from profiles where id = auth.uid() and role = 'reviewer')
  );

drop policy if exists "roster_squads_insert_staff_pending"    on public.roster_squads;
drop policy if exists "roster_squads_insert_reviewer_pending" on public.roster_squads;
create policy "roster_squads_insert_reviewer_pending"
  on public.roster_squads for insert
  with check (
    status = 'pending' and created_by = auth.uid()
    and exists (select 1 from profiles where id = auth.uid() and role = 'reviewer')
  );

drop policy if exists "roster_squads_update_staff_pending"    on public.roster_squads;
drop policy if exists "roster_squads_update_reviewer_pending" on public.roster_squads;
create policy "roster_squads_update_reviewer_pending"
  on public.roster_squads for update
  using (
    status = 'pending'
    and exists (select 1 from profiles where id = auth.uid() and role = 'reviewer')
  )
  with check (status in ('pending', 'approved'));

drop policy if exists "roster_squads_delete_staff_pending"    on public.roster_squads;
drop policy if exists "roster_squads_delete_reviewer_pending" on public.roster_squads;
create policy "roster_squads_delete_reviewer_pending"
  on public.roster_squads for delete
  using (
    status = 'pending'
    and exists (select 1 from profiles where id = auth.uid() and role = 'reviewer')
  );

-- ─── 10. POLICIES: whitelist ─────────────────────────────────────────────────
-- Admins manage grader/reviewer whitelist entries; admin entries stay
-- owner-only (unchanged "Whitelist owner full write" / "Whitelist read by
-- owner" policies).

drop policy if exists "Whitelist admin write staff only"      on public.whitelist;
drop policy if exists "Whitelist admin write sub-admin only"  on public.whitelist;
create policy "Whitelist admin write sub-admin only"
  on public.whitelist for insert
  with check (public.is_admin_or_above() and role in ('grader', 'reviewer'));

drop policy if exists "Whitelist admin update staff only"     on public.whitelist;
drop policy if exists "Whitelist admin update sub-admin only" on public.whitelist;
create policy "Whitelist admin update sub-admin only"
  on public.whitelist for update
  using (public.is_admin_or_above() and role in ('grader', 'reviewer'))
  with check (public.is_admin_or_above() and role in ('grader', 'reviewer'));

drop policy if exists "Whitelist admin delete staff only"     on public.whitelist;
drop policy if exists "Whitelist admin delete sub-admin only" on public.whitelist;
create policy "Whitelist admin delete sub-admin only"
  on public.whitelist for delete
  using (public.is_admin_or_above() and role in ('grader', 'reviewer'));

drop policy if exists "Whitelist read staff entries by admin"     on public.whitelist;
drop policy if exists "Whitelist read sub-admin entries by admin" on public.whitelist;
create policy "Whitelist read sub-admin entries by admin"
  on public.whitelist for select
  using (public.is_admin_or_above() and role in ('grader', 'reviewer'));

-- ─── 11. FUNCTIONS THAT CHECKED 'staff' ──────────────────────────────────────

-- Demotion cleanup: dropping someone to plain user clears their pending queue.
create or replace function public.cleanup_pending_on_demotion()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  if old.role in ('grader', 'reviewer', 'admin') and new.role = 'user' then
    delete from pending_jutsus where submitted_by = new.id;
  end if;
  return new;
end;
$$;

-- approve_pending_jutsu: identical body, permission check moves to reviewer+.
create or replace function public.approve_pending_jutsu(pending_id uuid)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  p record;
  d jsonb;
begin
  if not is_reviewer_or_above() then
    raise exception 'Permission denied: must be reviewer or above';
  end if;

  select * into p from pending_jutsus where id = pending_id;
  if not found then
    raise exception 'Pending entry not found';
  end if;

  if p.submitted_by = auth.uid() then
    raise exception 'You cannot approve your own submission';
  end if;

  d := p.data;

  if p.operation = 'insert' then
    insert into jutsus (
      id, name, nature, rank, cost, types, origin, spec, link, bloodline,
      custom_tags, limited, locked, multi_rank, bm_tier, slots,
      jutsu_type, pve, sheet,
      created_by, last_modified_by
    ) values (
      coalesce(nullif(d->>'id','')::uuid, gen_random_uuid()),
      d->>'name',
      nullif(d->>'nature',''),
      coalesce(array(select jsonb_array_elements_text(d->'rank')), '{}'),
      nullif(d->>'cost',''),
      coalesce(array(select jsonb_array_elements_text(d->'types')), '{}'),
      nullif(d->>'origin',''),
      coalesce(array(select jsonb_array_elements_text(d->'spec')), '{}'),
      nullif(d->>'link',''),
      nullif(d->>'bloodline',''),
      coalesce(array(select jsonb_array_elements_text(d->'custom_tags')), '{}'),
      coalesce((d->>'limited')::boolean, false),
      coalesce((d->>'locked')::boolean, false),
      coalesce((d->>'multi_rank')::boolean, false),
      nullif(d->>'bm_tier',''),
      d->'slots',
      coalesce(array(select jsonb_array_elements_text(d->'jutsu_type')), '{}'),
      coalesce((d->>'pve')::boolean, false),
      coalesce(d->'sheet', '{}'::jsonb),
      p.submitted_by,
      auth.uid()
    );

  elsif p.operation = 'update' then
    update jutsus set
      name             = d->>'name',
      nature           = nullif(d->>'nature',''),
      rank             = coalesce(array(select jsonb_array_elements_text(d->'rank')), '{}'),
      cost             = nullif(d->>'cost',''),
      types            = coalesce(array(select jsonb_array_elements_text(d->'types')), '{}'),
      origin           = nullif(d->>'origin',''),
      spec             = coalesce(array(select jsonb_array_elements_text(d->'spec')), '{}'),
      link             = nullif(d->>'link',''),
      bloodline        = nullif(d->>'bloodline',''),
      custom_tags      = coalesce(array(select jsonb_array_elements_text(d->'custom_tags')), '{}'),
      limited          = coalesce((d->>'limited')::boolean, false),
      locked           = coalesce((d->>'locked')::boolean, false),
      multi_rank       = coalesce((d->>'multi_rank')::boolean, false),
      bm_tier          = nullif(d->>'bm_tier',''),
      slots            = d->'slots',
      jutsu_type       = coalesce(array(select jsonb_array_elements_text(d->'jutsu_type')), '{}'),
      pve              = coalesce((d->>'pve')::boolean, false),
      sheet            = coalesce(d->'sheet', '{}'::jsonb),
      last_modified_by = auth.uid()
    where id = p.target_id;

    if not found then
      raise exception 'The jutsu this update targets no longer exists. Cancel and resubmit.';
    end if;

  elsif p.operation = 'delete' then
    delete from jutsus where id = p.target_id;
    -- Silently succeed if the jutsu was already deleted by an admin.
  end if;

  delete from pending_jutsus where id = pending_id;
end;
$$;

-- Every policy that referenced is_staff_or_above() has been recreated above,
-- so the old helper can go.
drop function if exists public.is_staff_or_above();
