-- Adds the "Jutsu Type" technique-tag catalog (Offensive, Defensive, Mobility,
-- Utility, Sensory, Multi-Purpose) and the per-jutsu column that stores which
-- tags apply. Mirrors the existing `specializations` table / `jutsus.spec`
-- column pattern. Run once in the Supabase SQL Editor. Idempotent and safe
-- to re-run.

create table if not exists public.jutsu_type_tags (
  id         uuid primary key default gen_random_uuid(),
  name       text not null unique,
  created_at timestamptz not null default now()
);

alter table public.jutsu_type_tags enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'jutsu_type_tags'
       and policyname = 'Anyone can read jutsu_type_tags'
  ) then
    create policy "Anyone can read jutsu_type_tags"
      on public.jutsu_type_tags for select
      using (true);
  end if;

  if not exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'jutsu_type_tags'
       and policyname = 'Staff can manage jutsu_type_tags'
  ) then
    create policy "Staff can manage jutsu_type_tags"
      on public.jutsu_type_tags for all
      using (exists (
        select 1 from public.profiles
         where id = auth.uid() and role in ('staff', 'admin', 'owner')
      ))
      with check (exists (
        select 1 from public.profiles
         where id = auth.uid() and role in ('staff', 'admin', 'owner')
      ));
  end if;
end $$;

insert into public.jutsu_type_tags (name)
values ('Offensive'), ('Defensive'), ('Mobility'), ('Utility'), ('Sensory'), ('Multi-Purpose')
on conflict (name) do nothing;

alter table public.jutsus
  add column if not exists jutsu_type jsonb not null default '[]'::jsonb;
