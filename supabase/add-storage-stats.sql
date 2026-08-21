-- Storage calculator for System Tools: how much data the Jutsu/Battlemode
-- catalog, Bloodlines, and Roster sections actually hold. Admin+ only.
--
-- Reports both an estimated "data size" (sum of pg_column_size() per row --
-- the row's own bytes, not counting index/TOAST overhead) split Jutsu vs.
-- Battlemode, and the real on-disk "table size" (pg_total_relation_size(),
-- includes indexes and TOAST) per table for context. The two numbers won't
-- match exactly -- that's expected, they're measuring different things.

create or replace function public.get_storage_stats()
returns table (
  category text,
  row_count bigint,
  data_bytes bigint,
  table_bytes bigint
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from profiles where id = auth.uid() and role in ('admin', 'owner')
  ) then
    raise exception 'Admin access required';
  end if;

  return query
  select 'Jutsu'::text,
         count(*) filter (where not (j.types @> array['Battlemode']::text[]))::bigint,
         coalesce(sum(pg_column_size(j)) filter (where not (j.types @> array['Battlemode']::text[])), 0)::bigint,
         null::bigint
  from jutsus j
  union all
  select 'Battlemode'::text,
         count(*) filter (where j.types @> array['Battlemode']::text[])::bigint,
         coalesce(sum(pg_column_size(j)) filter (where j.types @> array['Battlemode']::text[]), 0)::bigint,
         null::bigint
  from jutsus j
  union all
  select 'Jutsus table (on disk)'::text,
         (select count(*) from jutsus)::bigint,
         null::bigint,
         pg_total_relation_size('public.jutsus')
  union all
  select 'Bloodlines'::text,
         (select count(*) from bloodlines)::bigint,
         (select coalesce(sum(pg_column_size(b)), 0) from bloodlines b)::bigint,
         pg_total_relation_size('public.bloodlines')
  union all
  select 'Roster (entries + squads)'::text,
         (select count(*) from roster_entries) + (select count(*) from roster_squads),
         (select coalesce(sum(pg_column_size(e)), 0) from roster_entries e)
           + (select coalesce(sum(pg_column_size(s)), 0) from roster_squads s),
         pg_total_relation_size('public.roster_entries') + pg_total_relation_size('public.roster_squads')
  union all
  select 'Character sheets'::text,
         (select count(*) from character_sheets)::bigint,
         (select coalesce(sum(pg_column_size(c)), 0) from character_sheets c)::bigint,
         pg_total_relation_size('public.character_sheets');
end;
$$;

revoke all on function public.get_storage_stats() from public;
grant execute on function public.get_storage_stats() to authenticated;
