-- ============================================================================
-- RP GRADING & UPGRADE AUTOMATION (Phase 1)
-- ============================================================================
-- The two-gate pipeline:
--
--   Player submits RP ──▶ [GATE 1: grader] ──▶ credits minted
--   Player spends a credit on an upgrade ──▶ [GATE 2: reviewer] ──▶ sheet
--   auto-updated (revert available to reviewer+)
--
-- Core model: a graded RP mints ONE single-use credit per participating
-- character, tagged with the eligible uses the grader approved. Spending a
-- credit consumes it whole. Slice-of-Life-only RPs mint no credits.
--
-- Weekly cap: 2 approved upgrades per character per cycle; cycles reset
-- Monday 00:00 America/New_York and are keyed by ISO week evaluated in ET
-- (e.g. '2026-W34'), stamped at APPROVAL time.
--
-- Depends on: migrate-roles-grader-reviewer.sql (is_grader_or_above /
-- is_reviewer_or_above). Run that first. Idempotent: safe to re-run.
-- ============================================================================

-- ─── TABLES ──────────────────────────────────────────────────────────────────

create table if not exists public.rp_submissions (
  id            uuid primary key default gen_random_uuid(),
  submitter_id  uuid not null references public.profiles(id),
  rp_type       text not null check (rp_type in ('Regular', 'Event', 'Mission', 'Bounty', 'Squad')),
  description   text not null default '',
  thread_url    text not null,
  status        text not null default 'pending' check (status in ('pending', 'graded', 'rejected')),
  grader_id     uuid references public.profiles(id),
  sol_only      boolean not null default false,
  grader_notes  text not null default '',
  created_at    timestamptz not null default now(),
  graded_at     timestamptz
);

create table if not exists public.rp_participants (
  id               uuid primary key default gen_random_uuid(),
  submission_id    uuid not null references public.rp_submissions(id) on delete cascade,
  user_id          uuid not null references public.profiles(id),
  discord_user_id  text not null default '',
  character_id     uuid not null references public.character_sheets(id),
  claimed_tags     text[] not null default '{}'
);

create table if not exists public.rp_credits (
  id                   uuid primary key default gen_random_uuid(),
  submission_id        uuid not null references public.rp_submissions(id),
  character_id         uuid not null references public.character_sheets(id),
  eligible_tags        text[] not null default '{}',
  status               text not null default 'unspent' check (status in ('unspent', 'spent')),
  spent_on_upgrade_id  uuid,
  credit_value         int not null default 1,
  created_at           timestamptz not null default now()
);

create table if not exists public.upgrade_requests (
  id                   uuid primary key default gen_random_uuid(),
  character_id         uuid not null references public.character_sheets(id),
  requester_id         uuid not null references public.profiles(id),
  upgrade_type         text not null check (upgrade_type in ('stat', 'skill', 'dojutsu_skill', 'jutsu')),
  -- { label, tag, path (text[] into character_sheets.data), new_value, ... }
  target               jsonb not null default '{}',
  computed_cost        int not null default 1,
  attached_credit_ids  uuid[] not null default '{}',
  -- soft warnings computed at request time, shown to the reviewer
  warnings             jsonb not null default '[]',
  status               text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'reverted')),
  reviewer_id          uuid references public.profiles(id),
  override_reason      text,
  review_note          text,
  before_value         jsonb,
  cycle_key            text,
  created_at           timestamptz not null default now(),
  reviewed_at          timestamptz,
  reverted_by          uuid references public.profiles(id),
  reverted_at          timestamptz
);

do $$ begin
  alter table public.rp_credits
    add constraint rp_credits_spent_on_upgrade_id_fkey
    foreign key (spent_on_upgrade_id) references public.upgrade_requests(id);
exception when duplicate_object then null; end $$;

-- Elite Jonin maxout passive (Phase 1 ships the column only; the promotion
-- path that grants it is v2): when 2, graded RPs mint 2 credits for this
-- character instead of 1.
alter table public.character_sheets
  add column if not exists credit_multiplier int not null default 1;

create index if not exists rp_participants_submission_idx on public.rp_participants(submission_id);
create index if not exists rp_credits_character_idx       on public.rp_credits(character_id, status);
create index if not exists rp_submissions_status_idx      on public.rp_submissions(status);
create index if not exists upgrade_requests_character_idx on public.upgrade_requests(character_id, status, cycle_key);

-- ─── ROW-LEVEL SECURITY ──────────────────────────────────────────────────────
-- Submitters see their own submissions/credits/requests; graders see the
-- grading queue; reviewers see the upgrade queue; admin/owner see all
-- (implied by the role ladder in is_grader_or_above / is_reviewer_or_above).
-- All credit minting/spending and all sheet writes go through the SECURITY
-- DEFINER functions below — clients get no direct write access to rp_credits
-- and no status/review writes on the other tables.

alter table public.rp_submissions   enable row level security;
alter table public.rp_participants  enable row level security;
alter table public.rp_credits       enable row level security;
alter table public.upgrade_requests enable row level security;

drop policy if exists "rp_submissions_select" on public.rp_submissions;
create policy "rp_submissions_select"
  on public.rp_submissions for select
  using (
    submitter_id = auth.uid()
    or public.is_grader_or_above()
    or id in (select submission_id from rp_participants where user_id = auth.uid())
  );

drop policy if exists "rp_submissions_insert" on public.rp_submissions;
create policy "rp_submissions_insert"
  on public.rp_submissions for insert
  with check (submitter_id = auth.uid() and status = 'pending');

drop policy if exists "rp_submissions_update_own_pending" on public.rp_submissions;
create policy "rp_submissions_update_own_pending"
  on public.rp_submissions for update
  using (submitter_id = auth.uid() and status = 'pending')
  with check (submitter_id = auth.uid() and status = 'pending');

drop policy if exists "rp_submissions_delete" on public.rp_submissions;
create policy "rp_submissions_delete"
  on public.rp_submissions for delete
  using (
    (submitter_id = auth.uid() and status = 'pending')
    or public.is_admin_or_above()
  );

drop policy if exists "rp_participants_select" on public.rp_participants;
create policy "rp_participants_select"
  on public.rp_participants for select
  using (
    user_id = auth.uid()
    or public.is_grader_or_above()
    or submission_id in (select id from rp_submissions where submitter_id = auth.uid())
  );

drop policy if exists "rp_participants_insert" on public.rp_participants;
create policy "rp_participants_insert"
  on public.rp_participants for insert
  with check (
    submission_id in (
      select id from rp_submissions
      where submitter_id = auth.uid() and status = 'pending'
    )
  );

drop policy if exists "rp_participants_update" on public.rp_participants;
create policy "rp_participants_update"
  on public.rp_participants for update
  using (
    submission_id in (
      select id from rp_submissions
      where submitter_id = auth.uid() and status = 'pending'
    )
  );

drop policy if exists "rp_participants_delete" on public.rp_participants;
create policy "rp_participants_delete"
  on public.rp_participants for delete
  using (
    submission_id in (
      select id from rp_submissions
      where submitter_id = auth.uid() and status = 'pending'
    )
    or public.is_admin_or_above()
  );

drop policy if exists "rp_credits_select" on public.rp_credits;
create policy "rp_credits_select"
  on public.rp_credits for select
  using (
    public.is_grader_or_above()
    or character_id in (select id from character_sheets where owner_id = auth.uid())
  );
-- (no insert/update/delete policies: rp_credits is written only by the
-- SECURITY DEFINER grading/upgrade functions)

drop policy if exists "upgrade_requests_select" on public.upgrade_requests;
create policy "upgrade_requests_select"
  on public.upgrade_requests for select
  using (
    requester_id = auth.uid()
    or public.is_reviewer_or_above()
    or character_id in (select id from character_sheets where owner_id = auth.uid())
  );

drop policy if exists "upgrade_requests_insert" on public.upgrade_requests;
create policy "upgrade_requests_insert"
  on public.upgrade_requests for insert
  with check (
    requester_id = auth.uid()
    and status = 'pending'
    and character_id in (select id from character_sheets where owner_id = auth.uid())
  );

drop policy if exists "upgrade_requests_delete" on public.upgrade_requests;
create policy "upgrade_requests_delete"
  on public.upgrade_requests for delete
  using (
    (requester_id = auth.uid() and status = 'pending')
    or public.is_admin_or_above()
  );
-- (no update policy: approve/reject/revert go through the functions below)

-- ─── HELPERS ─────────────────────────────────────────────────────────────────

-- The weekly-cap cycle key: ISO year+week evaluated in ET, so the cycle
-- rolls over Monday 00:00 America/New_York. Example: '2026-W34'.
create or replace function public.current_upgrade_cycle_key()
returns text
language sql stable
as $$ select to_char(now() at time zone 'America/New_York', 'IYYY-"W"IW'); $$;

-- Approved (and not reverted) upgrades this cycle for one character —
-- feeds both the wallet's "X of 2 used" display and the cap warning.
create or replace function public.approved_upgrades_this_cycle(p_character_id uuid)
returns int
language sql stable security definer
set search_path = public
as $$
  select count(*)::int from upgrade_requests
  where character_id = p_character_id
    and status = 'approved'
    and cycle_key = current_upgrade_cycle_key();
$$;

-- ─── GATE 1: grade_rp_submission ─────────────────────────────────────────────
-- Grader-only, atomic. Blocks self-grading (a grader who appears in the
-- participant list, by site account or Discord ID, cannot grade). On
-- approval mints one credit per participating character, carrying the
-- grader-approved eligible tags and the character's credit_multiplier;
-- Slice-of-Life-only approvals mint nothing. p_participant_tags maps
-- participant row id -> text[] of eligible tags (falls back to the
-- participant's claimed tags when absent).

create or replace function public.grade_rp_submission(
  p_submission_id    uuid,
  p_approve          boolean,
  p_sol_only         boolean default false,
  p_participant_tags jsonb   default '{}'::jsonb,
  p_notes            text    default ''
)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  s          record;
  part       record;
  my_discord text;
  tags       text[];
begin
  if not is_grader_or_above() then
    raise exception 'Permission denied: must be grader or above';
  end if;

  select * into s from rp_submissions where id = p_submission_id for update;
  if not found then
    raise exception 'RP submission not found';
  end if;
  if s.status <> 'pending' then
    raise exception 'This RP has already been graded';
  end if;

  select coalesce(discord_id, '') into my_discord from profiles where id = auth.uid();
  if exists (
    select 1 from rp_participants
    where submission_id = p_submission_id
      and (user_id = auth.uid()
           or (discord_user_id <> '' and discord_user_id = my_discord))
  ) then
    raise exception 'You participated in this RP and cannot grade it';
  end if;

  if not p_approve then
    update rp_submissions
       set status = 'rejected', grader_id = auth.uid(),
           grader_notes = coalesce(p_notes, ''), graded_at = now()
     where id = p_submission_id;
    return;
  end if;

  update rp_submissions
     set status = 'graded', grader_id = auth.uid(), sol_only = p_sol_only,
         grader_notes = coalesce(p_notes, ''), graded_at = now()
   where id = p_submission_id;

  if p_sol_only then
    return; -- SoL RPs mint no upgrade credit (Ryo/None only)
  end if;

  for part in
    select rp.*, coalesce(cs.credit_multiplier, 1) as multiplier
      from rp_participants rp
      join character_sheets cs on cs.id = rp.character_id
     where rp.submission_id = p_submission_id
  loop
    if p_participant_tags ? part.id::text then
      tags := coalesce(array(select jsonb_array_elements_text(p_participant_tags -> part.id::text)), '{}');
    else
      tags := part.claimed_tags;
    end if;

    insert into rp_credits (submission_id, character_id, eligible_tags, credit_value)
    values (p_submission_id, part.character_id, tags, greatest(part.multiplier, 1));
  end loop;
end;
$$;

-- ─── GATE 2: approve_upgrade_request ─────────────────────────────────────────
-- Reviewer-only, atomic (mirrors approve_pending_jutsu). Hard-blocks:
-- self-OC approval, spent/foreign credits, malformed targets. Soft rules
-- (insufficient credits, weekly cap) require a logged override_reason to
-- pass. On success: snapshots before_value, writes the new value into
-- character_sheets.data, marks every attached credit spent, and stamps the
-- approval-time cycle key — all in one transaction. The request row itself
-- is the audit record (who, what, when, before-value, override reason).

create or replace function public.approve_upgrade_request(
  p_request_id      uuid,
  p_override_reason text default null
)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  r            record;
  cs           record;
  t_path       text[];
  t_new        jsonb;
  n_credits    int;
  sum_value    int;
  used         int;
  needs_reason text := null;
  old_value    jsonb;
  new_data     jsonb;
begin
  if not is_reviewer_or_above() then
    raise exception 'Permission denied: must be reviewer or above';
  end if;

  select * into r from upgrade_requests where id = p_request_id for update;
  if not found then
    raise exception 'Upgrade request not found';
  end if;
  if r.status <> 'pending' then
    raise exception 'This request has already been reviewed';
  end if;

  select * into cs from character_sheets where id = r.character_id for update;
  if not found then
    raise exception 'Character sheet no longer exists';
  end if;
  if cs.owner_id = auth.uid() then
    raise exception 'You cannot approve an upgrade for your own character';
  end if;

  -- Validate the target: path and value must match the declared upgrade type,
  -- so a crafted request can never write outside the stats/skills/dojutsu/
  -- jutsu regions of the sheet.
  t_path := coalesce(array(select jsonb_array_elements_text(r.target -> 'path')), '{}');
  t_new  := r.target -> 'new_value';
  if t_new is null then
    raise exception 'Malformed upgrade target: missing new_value';
  end if;

  if r.upgrade_type = 'stat' then
    if array_length(t_path, 1) <> 2 or t_path[1] <> 'stats'
       or t_path[2] not in ('chakra_level', 'chakra_control', 'speed', 'strength')
       or jsonb_typeof(t_new) <> 'string'
       or (t_new #>> '{}') not in ('F', 'E', 'D', 'C', 'B', 'A', 'S') then
      raise exception 'Malformed stat upgrade target';
    end if;
  elsif r.upgrade_type = 'skill' then
    if array_length(t_path, 1) <> 2 or t_path[1] <> 'skills'
       or t_path[2] not in ('ninjutsu', 'taijutsu', 'genjutsu', 'fuinjutsu', 'bukijutsu', 'medical')
       or jsonb_typeof(t_new) <> 'string'
       or (t_new #>> '{}') !~ '^(10|20|30|40|50|60|70|80|90|100)%$' then
      raise exception 'Malformed skill upgrade target';
    end if;
  elsif r.upgrade_type = 'dojutsu_skill' then
    if t_path <> array['limited', 'dojutsu_skill']
       or jsonb_typeof(t_new) <> 'string'
       or (t_new #>> '{}') !~ '^(10|20|30|40|50|60|70|80|90|100)%$' then
      raise exception 'Malformed dojutsu upgrade target';
    end if;
  elsif r.upgrade_type = 'jutsu' then
    if t_path <> array['techniques', 'jutsu'] or jsonb_typeof(t_new) <> 'array' then
      raise exception 'Malformed jutsu upgrade target';
    end if;
  end if;

  -- Attached credits: must all exist, be unspent, and belong to this
  -- character. A credit is single-use — approval consumes every attached
  -- credit whole, even if its eligible tags listed several options.
  -- (Lock first, then aggregate: FOR UPDATE can't ride on an aggregate.)
  perform 1 from rp_credits where id = any(r.attached_credit_ids) for update;
  select count(*), coalesce(sum(credit_value), 0)
    into n_credits, sum_value
    from rp_credits
   where id = any(r.attached_credit_ids)
     and status = 'unspent'
     and character_id = r.character_id;
  if n_credits <> coalesce(array_length(r.attached_credit_ids, 1), 0) then
    raise exception 'One or more attached credits are missing, already spent, or belong to another character';
  end if;

  -- Soft rules — the reviewer may pass them, but only with a logged reason.
  if sum_value < r.computed_cost then
    needs_reason := 'insufficient credits';
  end if;
  used := approved_upgrades_this_cycle(r.character_id);
  if used >= 2 then
    needs_reason := coalesce(needs_reason || ' + ', '') || 'weekly cap reached';
  end if;
  if needs_reason is not null and coalesce(trim(p_override_reason), '') = '' then
    raise exception 'Override reason required (%). Approve again with a logged reason to proceed.', needs_reason;
  end if;

  -- Snapshot + apply. Depth is at most 2; make sure the parent object exists
  -- so jsonb_set cannot silently no-op on a sparse sheet.
  new_data := coalesce(cs.data, '{}'::jsonb);
  if array_length(t_path, 1) = 2 and (new_data -> t_path[1]) is null then
    new_data := jsonb_set(new_data, array[t_path[1]], '{}'::jsonb, true);
  end if;
  old_value := coalesce(new_data #> t_path, 'null'::jsonb);
  new_data  := jsonb_set(new_data, t_path, t_new, true);

  update character_sheets
     set data = new_data, updated_by = auth.uid()
   where id = r.character_id;

  update rp_credits
     set status = 'spent', spent_on_upgrade_id = r.id
   where id = any(r.attached_credit_ids);

  update upgrade_requests
     set status = 'approved',
         reviewer_id = auth.uid(),
         reviewed_at = now(),
         override_reason = nullif(trim(coalesce(p_override_reason, '')), ''),
         before_value = old_value,
         cycle_key = current_upgrade_cycle_key()
   where id = r.id;
end;
$$;

-- ─── GATE 2: reject_upgrade_request ──────────────────────────────────────────

create or replace function public.reject_upgrade_request(
  p_request_id uuid,
  p_reason     text default null
)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  r record;
begin
  if not is_reviewer_or_above() then
    raise exception 'Permission denied: must be reviewer or above';
  end if;

  select * into r from upgrade_requests where id = p_request_id for update;
  if not found then
    raise exception 'Upgrade request not found';
  end if;
  if r.status <> 'pending' then
    raise exception 'This request has already been reviewed';
  end if;

  update upgrade_requests
     set status = 'rejected', reviewer_id = auth.uid(), reviewed_at = now(),
         review_note = nullif(trim(coalesce(p_reason, '')), '')
   where id = r.id;
end;
$$;

-- ─── revert_upgrade ──────────────────────────────────────────────────────────
-- Reviewer/admin only (not available to players). approve_upgrade_request
-- recorded the before-state, so revert is the same operation run backward:
-- restores before_value to the sheet, refunds the attached credits to
-- unspent, marks the request reverted, and logs who reverted. Because the
-- weekly counter is derived from status = 'approved' rows, the revert also
-- frees the cycle slot automatically.

create or replace function public.revert_upgrade(p_request_id uuid)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  r        record;
  cs       record;
  t_path   text[];
  new_data jsonb;
begin
  if not is_reviewer_or_above() then
    raise exception 'Permission denied: must be reviewer or above';
  end if;

  select * into r from upgrade_requests where id = p_request_id for update;
  if not found then
    raise exception 'Upgrade request not found';
  end if;
  if r.status <> 'approved' then
    raise exception 'Only an approved upgrade can be reverted';
  end if;

  select * into cs from character_sheets where id = r.character_id for update;
  if not found then
    raise exception 'Character sheet no longer exists';
  end if;

  t_path := coalesce(array(select jsonb_array_elements_text(r.target -> 'path')), '{}');
  new_data := coalesce(cs.data, '{}'::jsonb);
  if array_length(t_path, 1) = 2 and (new_data -> t_path[1]) is null then
    new_data := jsonb_set(new_data, array[t_path[1]], '{}'::jsonb, true);
  end if;
  new_data := jsonb_set(new_data, t_path, coalesce(r.before_value, 'null'::jsonb), true);

  update character_sheets
     set data = new_data, updated_by = auth.uid()
   where id = r.character_id;

  update rp_credits
     set status = 'unspent', spent_on_upgrade_id = null
   where spent_on_upgrade_id = r.id;

  update upgrade_requests
     set status = 'reverted', reverted_by = auth.uid(), reverted_at = now()
   where id = r.id;
end;
$$;
