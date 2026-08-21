-- Tracks the true OC owner (the original submitter) on approved roster rows,
-- separate from created_by/approved_by which already record the reviewer who
-- ran the approval. Lets the site auto-calculate how many OCs a player has
-- (OCSubmissionModal's "which OC is this for you?") instead of trusting a
-- self-reported number. Set by netlify/functions/roster-auto-insert.mjs at
-- approval time, from the original pending_jutsus.submitted_by.
--
-- Existing rows predate this column and stay NULL -- there is no reliable
-- way to backfill who originally submitted a character that was approved
-- before this migration ran.

alter table public.roster_entries add column if not exists owner_id uuid references public.profiles(id) on delete set null;
alter table public.roster_squads  add column if not exists owner_id uuid references public.profiles(id) on delete set null;

create index if not exists roster_entries_owner_idx on public.roster_entries (owner_id);
create index if not exists roster_squads_owner_idx  on public.roster_squads  (owner_id);
