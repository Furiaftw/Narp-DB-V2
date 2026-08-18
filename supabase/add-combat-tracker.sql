-- ============================================================================
-- COMBAT TRACKER (Phase 1: lifecycle + basic 1-post turns)
-- ============================================================================
-- Manual, turn-by-turn combat tracker. Players declare each action
-- explicitly; nothing here parses RP text. A "battle" is one combat
-- instance bound to an RP thread; multiple battles run concurrently without
-- colliding. CU pool and jutsu list are read live from character_sheets —
-- this table never re-enters cost data, it just spends/logs against it.
--
-- Phase 1 scope only: battle creation, open-lobby/invite-only rosters, host
-- locks a fixed turn order, strict turn enforcement, and 1-post technique
-- turns (base rank cost, straight CU deduction). Explicitly NOT in this
-- migration — future phases, once this foundation is proven:
--   - Multi-post Battery techniques and their per-turn drain
--   - Continuous techniques (recurring per-turn cost, halts on interrupt)
--   - Genjutsu's cost-flip-to-target rule
--   - The defensive resolution engine (hit-thresholds, partial-damage
--     conversion, piercing, elemental advantage) — Defend/Assault are
--     therefore not declarable action types yet; adding them without the
--     engine behind them would just be two buttons that don't do anything
--   - Zero/negative-CU unconsciousness and death flagging
--   - Discord slash-command shortcut layer
--
-- Depends on: migrate-roles-grader-reviewer.sql (is_reviewer_or_above /
-- is_admin_or_above), character_sheets (add-character-sheets.sql). Run
-- after both. Idempotent: safe to re-run.
-- ============================================================================

-- ─── TABLES ──────────────────────────────────────────────────────────────────

create table if not exists public.battles (
  id                  uuid primary key default gen_random_uuid(),
  thread_url          text not null,
  host_id             uuid not null references public.profiles(id),
  visibility_mode     text not null check (visibility_mode in ('open', 'invite')),
  status              text not null default 'draft' check (status in ('draft', 'active', 'completed', 'voided')),
  turn_order          uuid[] not null default '{}',  -- character_sheets.id, in play order
  current_turn_index  int not null default 0,
  round_number        int not null default 1,
  created_at          timestamptz not null default now(),
  locked_at           timestamptz,
  ended_at            timestamptz
);

create table if not exists public.battle_participants (
  id             uuid primary key default gen_random_uuid(),
  battle_id      uuid not null references public.battles(id) on delete cascade,
  character_id   uuid not null references public.character_sheets(id),
  user_id        uuid not null references public.profiles(id),
  -- 'invited': host tagged them (invite-only), awaiting accept.
  -- 'joined': in the roster — either accepted an invite or joined an open lobby.
  invite_status  text not null default 'joined' check (invite_status in ('invited', 'joined')),
  -- Snapshotted from computeCU(character.data.stats) when the host locks the
  -- battle. This is the live combat pool for this battle only — it is never
  -- written back to character_sheets, matching "CU resets between RP
  -- sessions" (that reset is the sheet's own concern, not this table's).
  max_cu         int,
  current_cu     int,
  joined_at      timestamptz not null default now(),
  unique (battle_id, character_id)
);

create table if not exists public.battle_turn_log (
  id                    uuid primary key default gen_random_uuid(),
  battle_id             uuid not null references public.battles(id) on delete cascade,
  round_number          int not null,
  turn_index            int not null,  -- position in turn_order at the time, for audit/replay
  actor_character_id    uuid not null references public.character_sheets(id),
  actor_user_id         uuid not null references public.profiles(id),
  action_type           text not null check (action_type in ('use_technique', 'pass')),
  -- Snapshot of the jutsu as declared, not a live join — a jutsu's rank or
  -- name can change after the fact, but the turn log is a historical record.
  jutsu_name            text,
  jutsu_rank            text,
  jutsu_nature           text,
  cu_cost               int not null default 0,
  cu_remaining_after    int not null,
  resolution_summary    text not null,
  created_at            timestamptz not null default now()
);

create index if not exists battle_participants_battle_idx on public.battle_participants(battle_id);
create index if not exists battle_participants_user_idx   on public.battle_participants(user_id);
create index if not exists battle_turn_log_battle_idx     on public.battle_turn_log(battle_id, created_at);
create index if not exists battles_status_idx             on public.battles(status);

-- ─── ROW-LEVEL SECURITY ──────────────────────────────────────────────────────
-- Open-lobby drafts are visible to everyone (that's the point of a lobby);
-- invite-only drafts, and any locked/active/completed/voided battle, are
-- visible to the host, participants, and reviewer+ (who can intervene per
-- the stall rule). All writes go through the SECURITY DEFINER functions
-- below — no direct insert/update/delete policies on any of these tables.

alter table public.battles           enable row level security;
alter table public.battle_participants enable row level security;
alter table public.battle_turn_log   enable row level security;

drop policy if exists "battles_select" on public.battles;
create policy "battles_select"
  on public.battles for select
  using (
    (status = 'draft' and visibility_mode = 'open')
    or host_id = auth.uid()
    or public.is_reviewer_or_above()
    or id in (select battle_id from battle_participants where user_id = auth.uid())
  );

drop policy if exists "battle_participants_select" on public.battle_participants;
create policy "battle_participants_select"
  on public.battle_participants for select
  using (
    user_id = auth.uid()
    or public.is_reviewer_or_above()
    or battle_id in (
      select id from battles
      where host_id = auth.uid()
         or (status = 'draft' and visibility_mode = 'open')
    )
    or battle_id in (select battle_id from battle_participants bp2 where bp2.user_id = auth.uid())
  );

drop policy if exists "battle_turn_log_select" on public.battle_turn_log;
create policy "battle_turn_log_select"
  on public.battle_turn_log for select
  using (
    public.is_reviewer_or_above()
    or battle_id in (select id from battles where host_id = auth.uid())
    or battle_id in (select battle_id from battle_participants where user_id = auth.uid())
  );

-- ─── HELPERS ─────────────────────────────────────────────────────────────────

-- Mirrors src/constants/characterSheet.js STAT_CU / BASE_CU exactly — keep
-- both in sync if the chakra rules change.
create or replace function public.compute_character_max_cu(p_character_id uuid)
returns int
language sql stable security definer
set search_path = public
as $$
  select coalesce(
    (case cs.data#>>'{stats,chakra_level}'
       when 'D' then 5 when 'C' then 10 when 'B' then 15 when 'A' then 20 when 'S' then 25 else 0 end)
    + (case cs.data#>>'{stats,chakra_control}'
       when 'D' then 5 when 'C' then 10 when 'B' then 15 when 'A' then 20 when 'S' then 25 else 0 end)
    + 5, 5)
  from character_sheets cs where cs.id = p_character_id;
$$;

-- Base 1-post/continuous-per-turn technique cost by rank (Technique Rank
-- table in the chakra rules). Multi-post has its own Min CU Cost table —
-- deliberately not referenced here; that table is Phase 2+.
create or replace function public.technique_base_cost(p_rank text)
returns int
language sql immutable
set search_path = public
as $$
  select case p_rank
    when 'E' then 1 when 'D' then 2 when 'C' then 4
    when 'B' then 6 when 'A' then 8 when 'S' then 10
    else null
  end;
$$;

-- ─── create_battle ────────────────────────────────────────────────────────────
-- Any signed-in user may host — this is a coordination tool, not a
-- moderation action (per the open item in the plan doc).

create or replace function public.create_battle(p_thread_url text, p_visibility_mode text)
returns uuid
language plpgsql security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if p_visibility_mode not in ('open', 'invite') then
    raise exception 'Invalid visibility_mode';
  end if;
  if coalesce(trim(p_thread_url), '') = '' then
    raise exception 'A thread link is required';
  end if;

  insert into battles (thread_url, host_id, visibility_mode)
  values (trim(p_thread_url), auth.uid(), p_visibility_mode)
  returning id into v_id;

  return v_id;
end;
$$;

-- ─── join_battle ──────────────────────────────────────────────────────────────
-- Open-lobby self-join. Invite-only battles use invite_to_battle instead.

create or replace function public.join_battle(p_battle_id uuid, p_character_id uuid)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  b record;
begin
  select * into b from battles where id = p_battle_id for update;
  if not found then raise exception 'Battle not found'; end if;
  if b.status <> 'draft' then raise exception 'This battle''s roster is no longer open'; end if;
  if b.visibility_mode <> 'open' then raise exception 'This battle is invite-only'; end if;

  if not exists (select 1 from character_sheets where id = p_character_id and owner_id = auth.uid()) then
    raise exception 'You can only join with your own character';
  end if;

  insert into battle_participants (battle_id, character_id, user_id, invite_status)
  values (p_battle_id, p_character_id, auth.uid(), 'joined')
  on conflict (battle_id, character_id) do nothing;
end;
$$;

-- ─── invite_to_battle / accept_battle_invite ─────────────────────────────────

create or replace function public.invite_to_battle(p_battle_id uuid, p_character_id uuid, p_user_id uuid)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  b record;
begin
  select * into b from battles where id = p_battle_id for update;
  if not found then raise exception 'Battle not found'; end if;
  if b.host_id <> auth.uid() then raise exception 'Only the host can invite'; end if;
  if b.status <> 'draft' then raise exception 'This battle''s roster is no longer open'; end if;
  if b.visibility_mode <> 'invite' then raise exception 'This battle is not invite-only'; end if;
  if not exists (select 1 from character_sheets where id = p_character_id and owner_id = p_user_id) then
    raise exception 'That character does not belong to the invited user';
  end if;

  insert into battle_participants (battle_id, character_id, user_id, invite_status)
  values (p_battle_id, p_character_id, p_user_id, 'invited')
  on conflict (battle_id, character_id) do nothing;
end;
$$;

create or replace function public.accept_battle_invite(p_battle_id uuid, p_character_id uuid)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  b record;
  p record;
begin
  select * into b from battles where id = p_battle_id for update;
  if not found then raise exception 'Battle not found'; end if;
  if b.status <> 'draft' then raise exception 'This battle''s roster is no longer open'; end if;

  select * into p from battle_participants
   where battle_id = p_battle_id and character_id = p_character_id for update;
  if not found then raise exception 'No invite found for that character'; end if;
  if p.user_id <> auth.uid() then raise exception 'This invite is not yours to accept'; end if;

  update battle_participants set invite_status = 'joined' where id = p.id;
end;
$$;

-- ─── remove_participant ───────────────────────────────────────────────────────
-- Host fixing a roster mistake, or a player leaving before lock. Draft only —
-- once locked the turn order is a fixed mechanical fact (Section 3/8).

create or replace function public.remove_participant(p_battle_id uuid, p_character_id uuid)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  b record;
begin
  select * into b from battles where id = p_battle_id for update;
  if not found then raise exception 'Battle not found'; end if;
  if b.status <> 'draft' then raise exception 'The roster is locked — remove players via staff intervention instead'; end if;
  if b.host_id <> auth.uid()
     and not exists (select 1 from battle_participants where battle_id = p_battle_id and character_id = p_character_id and user_id = auth.uid()) then
    raise exception 'Only the host or that character''s player can remove them';
  end if;

  delete from battle_participants where battle_id = p_battle_id and character_id = p_character_id;
end;
$$;

-- ─── lock_battle ──────────────────────────────────────────────────────────────
-- Host sets the fixed turn order and combat begins. Snapshots each joined
-- participant's max/current CU from their sheet at this instant.

create or replace function public.lock_battle(p_battle_id uuid, p_turn_order uuid[])
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  b            record;
  v_joined_ids uuid[];
begin
  select * into b from battles where id = p_battle_id for update;
  if not found then raise exception 'Battle not found'; end if;
  if b.host_id <> auth.uid() then raise exception 'Only the host can lock the battle'; end if;
  if b.status <> 'draft' then raise exception 'This battle is already locked'; end if;

  select array_agg(character_id order by character_id) into v_joined_ids
    from battle_participants where battle_id = p_battle_id and invite_status = 'joined';

  if v_joined_ids is null or array_length(v_joined_ids, 1) < 2 then
    raise exception 'A battle needs at least two joined participants to lock';
  end if;
  if (select array_agg(x order by x) from unnest(p_turn_order) x) <> v_joined_ids then
    raise exception 'Turn order must contain exactly the joined participants, no more and no less';
  end if;

  update battle_participants bp
     set max_cu = public.compute_character_max_cu(bp.character_id),
         current_cu = public.compute_character_max_cu(bp.character_id)
   where bp.battle_id = p_battle_id;

  update battles
     set status = 'active', turn_order = p_turn_order,
         current_turn_index = 0, round_number = 1, locked_at = now()
   where id = p_battle_id;
end;
$$;

-- ─── declare_turn ─────────────────────────────────────────────────────────────
-- Strict enforcement: only the character currently up may act. 'pass'
-- spends nothing. 'use_technique' looks up the jutsu on the ACTOR's own
-- sheet (not the global jutsu catalog — the sheet is what staff approved
-- them to know, at the rank they know it), and deducts its base 1-post
-- cost. Per the "Running out of CU" rule a character may push into the
-- negative; this migration does not yet flag unconsciousness/death for
-- that (Phase 2), so current_cu is allowed to go negative unguarded.

create or replace function public.declare_turn(
  p_battle_id  uuid,
  p_action_type text,
  p_jutsu_name  text default null
)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  b            record;
  actor_char   uuid;
  actor        record;
  cs           record;
  jutsu_row    jsonb;
  v_rank       text;
  v_nature     text;
  v_cost       int := 0;
  v_summary    text;
  v_next_index int;
begin
  if p_action_type not in ('use_technique', 'pass') then
    raise exception 'Unsupported action type: %', p_action_type;
  end if;

  select * into b from battles where id = p_battle_id for update;
  if not found then raise exception 'Battle not found'; end if;
  if b.status <> 'active' then raise exception 'This battle is not active'; end if;

  actor_char := b.turn_order[b.current_turn_index + 1]; -- pg arrays are 1-indexed

  select * into actor from battle_participants
   where battle_id = p_battle_id and character_id = actor_char for update;
  if not found then raise exception 'Turn state is inconsistent — the acting character is not a participant'; end if;
  if actor.user_id <> auth.uid() then
    raise exception 'It is not your turn';
  end if;

  if p_action_type = 'use_technique' then
    if coalesce(trim(p_jutsu_name), '') = '' then
      raise exception 'Pick a technique to use';
    end if;

    select * into cs from character_sheets where id = actor_char;
    select elem into jutsu_row
      from jsonb_array_elements(coalesce(cs.data #> '{techniques,jutsu}', '[]'::jsonb)) elem
     where lower(trim(elem->>'name')) = lower(trim(p_jutsu_name))
     limit 1;
    if jutsu_row is null then
      raise exception 'That technique is not on this character''s sheet';
    end if;
    if coalesce(jutsu_row->>'approved', '') <> 'Yes' then
      raise exception 'That technique is not marked Approved on the sheet';
    end if;

    v_rank := jutsu_row->>'rank';
    v_nature := jutsu_row->>'nature';
    v_cost := public.technique_base_cost(v_rank);
    if v_cost is null then
      raise exception 'That technique has no recognized rank set on the sheet';
    end if;

    update battle_participants set current_cu = current_cu - v_cost where id = actor.id;
    v_summary := format('%s used %s-Rank %s — %s CU spent, %s CU remaining.',
      coalesce(cs.character_name, 'Unknown'), v_rank, jutsu_row->>'name', v_cost, actor.current_cu - v_cost);
  else
    v_rank := null; v_nature := null; v_cost := 0;
    select character_name into v_summary from character_sheets where id = actor_char;
    v_summary := format('%s passed.', coalesce(v_summary, 'Unknown'));
  end if;

  insert into battle_turn_log (
    battle_id, round_number, turn_index, actor_character_id, actor_user_id,
    action_type, jutsu_name, jutsu_rank, jutsu_nature,
    cu_cost, cu_remaining_after, resolution_summary
  ) values (
    p_battle_id, b.round_number, b.current_turn_index, actor_char, auth.uid(),
    p_action_type, case when p_action_type = 'use_technique' then jutsu_row->>'name' else null end,
    v_rank, v_nature, v_cost,
    (select current_cu from battle_participants where id = actor.id),
    v_summary
  );

  v_next_index := (b.current_turn_index + 1) % array_length(b.turn_order, 1);
  update battles
     set current_turn_index = v_next_index,
         round_number = round_number + (case when v_next_index = 0 then 1 else 0 end)
   where id = p_battle_id;
end;
$$;

-- ─── end_battle ───────────────────────────────────────────────────────────────
-- Host ends it manually (completed), or reviewer+ voids it (staff
-- intervention — Section 8). Draft battles can also be withdrawn by the host.

create or replace function public.end_battle(p_battle_id uuid, p_status text)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  b record;
begin
  if p_status not in ('completed', 'voided') then
    raise exception 'Invalid end status';
  end if;

  select * into b from battles where id = p_battle_id for update;
  if not found then raise exception 'Battle not found'; end if;
  if b.status in ('completed', 'voided') then raise exception 'This battle has already ended'; end if;

  if b.host_id <> auth.uid() and not public.is_reviewer_or_above() then
    raise exception 'Only the host or a reviewer can end this battle';
  end if;

  update battles set status = p_status, ended_at = now() where id = p_battle_id;
end;
$$;

-- ─── force_advance_turn ───────────────────────────────────────────────────────
-- Staff intervention (Section 8): force-skip a stalled turn. Logs a 'pass'
-- on the stalled character's behalf so the turn log stays a complete record
-- of who acted (or didn't) each round.

create or replace function public.force_advance_turn(p_battle_id uuid)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  b            record;
  actor_char   uuid;
  v_name       text;
  v_next_index int;
begin
  if not public.is_reviewer_or_above() then
    raise exception 'Permission denied: must be reviewer or above';
  end if;

  select * into b from battles where id = p_battle_id for update;
  if not found then raise exception 'Battle not found'; end if;
  if b.status <> 'active' then raise exception 'This battle is not active'; end if;

  actor_char := b.turn_order[b.current_turn_index + 1];
  select character_name into v_name from character_sheets where id = actor_char;

  insert into battle_turn_log (
    battle_id, round_number, turn_index, actor_character_id, actor_user_id,
    action_type, cu_cost, cu_remaining_after, resolution_summary
  ) values (
    p_battle_id, b.round_number, b.current_turn_index, actor_char, auth.uid(),
    'pass', 0,
    coalesce((select current_cu from battle_participants where battle_id = p_battle_id and character_id = actor_char), 0),
    format('%s''s turn was force-skipped by staff (stall rule).', coalesce(v_name, 'Unknown'))
  );

  v_next_index := (b.current_turn_index + 1) % array_length(b.turn_order, 1);
  update battles
     set current_turn_index = v_next_index,
         round_number = round_number + (case when v_next_index = 0 then 1 else 0 end)
   where id = p_battle_id;
end;
$$;

-- ─── FUNCTION GRANTS ─────────────────────────────────────────────────────────
-- Mutation RPCs: authenticated callers only, matching the RP grading
-- functions' hardening.

revoke execute on function public.create_battle(text, text) from public, anon;
grant  execute on function public.create_battle(text, text) to authenticated, service_role;

revoke execute on function public.join_battle(uuid, uuid) from public, anon;
grant  execute on function public.join_battle(uuid, uuid) to authenticated, service_role;

revoke execute on function public.invite_to_battle(uuid, uuid, uuid) from public, anon;
grant  execute on function public.invite_to_battle(uuid, uuid, uuid) to authenticated, service_role;

revoke execute on function public.accept_battle_invite(uuid, uuid) from public, anon;
grant  execute on function public.accept_battle_invite(uuid, uuid) to authenticated, service_role;

revoke execute on function public.remove_participant(uuid, uuid) from public, anon;
grant  execute on function public.remove_participant(uuid, uuid) to authenticated, service_role;

revoke execute on function public.lock_battle(uuid, uuid[]) from public, anon;
grant  execute on function public.lock_battle(uuid, uuid[]) to authenticated, service_role;

revoke execute on function public.declare_turn(uuid, text, text) from public, anon;
grant  execute on function public.declare_turn(uuid, text, text) to authenticated, service_role;

revoke execute on function public.end_battle(uuid, text) from public, anon;
grant  execute on function public.end_battle(uuid, text) to authenticated, service_role;

revoke execute on function public.force_advance_turn(uuid) from public, anon;
grant  execute on function public.force_advance_turn(uuid) to authenticated, service_role;

-- ─── FUNCTION HARDENING ──────────────────────────────────────────────────────
-- compute_character_max_cu and technique_base_cost are only ever called
-- internally (by lock_battle / declare_turn, both SECURITY DEFINER — the
-- internal call executes as the function owner regardless of these grants),
-- never directly by the client. No direct API caller needs them.

revoke execute on function public.compute_character_max_cu(uuid) from public, anon, authenticated;
revoke execute on function public.technique_base_cost(text) from public, anon, authenticated;
