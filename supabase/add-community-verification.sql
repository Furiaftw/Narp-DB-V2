-- Community verification system: new users must submit a join application
-- and pass an admin interview before they can see any of the database.
--
-- Adds:
--   * join_applications  — one row per application attempt (denied rows are
--     kept forever as history; only one open application per user).
--   * application_chats  — interview chat messages, mirroring pending_chats.
--   * profiles.verified  — the actual gate. Existing users are grandfathered.
--   * is_verified()      — RLS helper (verified OR any staff+ role).
--   * SECURITY DEFINER RPCs for every status transition (no direct UPDATEs).
--   * Catalog lockdown: SELECT on jutsus/bloodlines/roster/etc. now requires
--     is_verified(). Public browsing ends by design.
--
-- Run once in the Supabase SQL Editor BEFORE deploying the matching client
-- code. Safe to re-run.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table if not exists public.join_applications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  -- { why_join, how_found, most_active_server, rp_server_count: '0'|'1'|'2'|'3+', age }
  answers jsonb not null,
  status text not null default 'pending'
    check (status in ('pending', 'interview', 'approved', 'denied')),
  reviewed_by uuid references public.profiles(id),
  denial_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  decided_at timestamptz
);

-- Only one open (pending/interview) application per user; closed ones pile
-- up as history.
create unique index if not exists join_applications_one_open
  on public.join_applications (user_id)
  where status in ('pending', 'interview');

create index if not exists join_applications_user_idx
  on public.join_applications (user_id, created_at desc);

create table if not exists public.application_chats (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.join_applications(id) on delete cascade,
  sender_id uuid not null references public.profiles(id),
  message text not null,
  created_at timestamptz not null default now(),
  is_edited boolean not null default false,
  original_message text,
  is_deleted boolean not null default false
);

create index if not exists application_chats_app_idx
  on public.application_chats (application_id, created_at);

-- ---------------------------------------------------------------------------
-- profiles.verified + grandfathering
-- ---------------------------------------------------------------------------

alter table public.profiles
  add column if not exists verified boolean not null default false,
  add column if not exists verified_at timestamptz,
  add column if not exists verified_by uuid references public.profiles(id);

-- Grandfather everyone who existed before this system launched. The
-- not-exists guard keeps this re-runnable after launch without verifying
-- people who are mid-application.
update public.profiles p
   set verified = true,
       verified_at = now()
 where p.verified = false
   and not exists (
     select 1 from public.join_applications ja where ja.user_id = p.id
   );

-- ---------------------------------------------------------------------------
-- is_verified() — RLS helper. SECURITY DEFINER so it can read profiles
-- without recursing through profiles' own policies. Staff+ are implicitly
-- verified so a role change never locks someone out.
-- ---------------------------------------------------------------------------

create or replace function public.is_verified()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select verified or role in ('staff', 'oc_staff', 'admin', 'owner')
       from public.profiles
      where id = auth.uid()),
    false
  );
$$;

grant execute on function public.is_verified() to authenticated, anon;

-- ---------------------------------------------------------------------------
-- RLS: join_applications
-- ---------------------------------------------------------------------------

alter table public.join_applications enable row level security;

drop policy if exists "applicant_read_own" on public.join_applications;
create policy "applicant_read_own" on public.join_applications
  for select using (auth.uid() = user_id);

drop policy if exists "admin_read_all_applications" on public.join_applications;
create policy "admin_read_all_applications" on public.join_applications
  for select using (is_admin_or_above());

-- Applicants may only open a fresh 'pending' application for themselves.
-- The partial unique index blocks a second open one. No UPDATE/DELETE
-- policies: every transition goes through the RPCs below.
drop policy if exists "applicant_insert_own" on public.join_applications;
create policy "applicant_insert_own" on public.join_applications
  for insert with check (
    auth.uid() = user_id
    and status = 'pending'
    and reviewed_by is null
    and decided_at is null
  );

-- ---------------------------------------------------------------------------
-- RLS: application_chats — applicant of the parent application + admins,
-- and posting only while the interview is actually open.
-- ---------------------------------------------------------------------------

alter table public.application_chats enable row level security;

drop policy if exists "interview_participant_read" on public.application_chats;
create policy "interview_participant_read" on public.application_chats
  for select using (
    exists (
      select 1 from public.join_applications ja
      where ja.id = application_id
        and (ja.user_id = auth.uid() or is_admin_or_above())
    )
  );

drop policy if exists "interview_participant_insert" on public.application_chats;
create policy "interview_participant_insert" on public.application_chats
  for insert with check (
    sender_id = auth.uid()
    and exists (
      select 1 from public.join_applications ja
      where ja.id = application_id
        and ja.status = 'interview'
        and (ja.user_id = auth.uid() or is_admin_or_above())
    )
  );

-- ---------------------------------------------------------------------------
-- RPCs — admin-gated state transitions
-- ---------------------------------------------------------------------------

-- Application approved at first glance: open the interview chat.
create or replace function public.start_application_interview(application_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not is_admin_or_above() then
    raise exception 'Admin access required';
  end if;

  update public.join_applications
     set status = 'interview',
         reviewed_by = auth.uid(),
         updated_at = now()
   where id = application_id and status = 'pending';

  if not found then
    raise exception 'Application not found or not pending';
  end if;
end;
$$;

-- Deny at either stage (initial review or end of interview).
create or replace function public.deny_join_application(application_id uuid, reason text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not is_admin_or_above() then
    raise exception 'Admin access required';
  end if;

  update public.join_applications
     set status = 'denied',
         reviewed_by = auth.uid(),
         denial_reason = reason,
         updated_at = now(),
         decided_at = now()
   where id = application_id and status in ('pending', 'interview');

  if not found then
    raise exception 'Application not found or already decided';
  end if;
end;
$$;

-- Final approval at the end of the interview: closes the application and
-- flips profiles.verified in the same transaction. Returns the applicant so
-- the client can follow up with the Discord role grant.
create or replace function public.approve_join_application(application_id uuid)
returns table (user_id uuid, discord_id text)
language plpgsql
security definer
set search_path = public
as $$
declare
  applicant uuid;
begin
  if not is_admin_or_above() then
    raise exception 'Admin access required';
  end if;

  update public.join_applications ja
     set status = 'approved',
         reviewed_by = auth.uid(),
         updated_at = now(),
         decided_at = now()
   where ja.id = application_id and ja.status = 'interview'
   returning ja.user_id into applicant;

  if applicant is null then
    raise exception 'Application not found or not in interview';
  end if;

  update public.profiles
     set verified = true,
         verified_at = now(),
         verified_by = auth.uid()
   where id = applicant;

  return query
    select p.id, p.discord_id from public.profiles p where p.id = applicant;
end;
$$;

grant execute on function public.start_application_interview(uuid) to authenticated;
grant execute on function public.deny_join_application(uuid, text) to authenticated;
grant execute on function public.approve_join_application(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Realtime: publish the two new tables (no-op if already added).
-- Verify in Dashboard → Database → Replication if live updates don't arrive.
-- ---------------------------------------------------------------------------

do $$
begin
  alter publication supabase_realtime add table public.join_applications;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.application_chats;
exception when duplicate_object then null;
end $$;

-- ---------------------------------------------------------------------------
-- Catalog lockdown: reading the database now requires verification.
-- The live SELECT policy names aren't tracked in this repo, so drop whatever
-- SELECT policies exist on each catalog table and install a single
-- verified-only one. Write policies are left untouched.
-- ---------------------------------------------------------------------------

do $$
declare
  t text;
  p record;
begin
  foreach t in array array[
    'jutsus', 'bloodlines', 'specializations', 'jutsu_type_tags',
    'roster_entries', 'roster_squads'
  ] loop
    if to_regclass('public.' || t) is null then
      continue;  -- table doesn't exist in this database; skip
    end if;

    execute format('alter table public.%I enable row level security', t);

    for p in
      select policyname from pg_policies
       where schemaname = 'public' and tablename = t and cmd = 'SELECT'
    loop
      execute format('drop policy %I on public.%I', p.policyname, t);
    end loop;

    execute format(
      'create policy "verified_read" on public.%I for select using (public.is_verified())',
      t
    );
  end loop;
end $$;
