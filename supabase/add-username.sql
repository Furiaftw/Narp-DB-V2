-- Adds the per-user `username` that every member must choose on first sign-in.
-- Run this once in the Supabase SQL Editor (Dashboard > SQL Editor > New query)
-- after the main schema. It is idempotent and safe to re-run.

-- 1) Column: nullable so existing/new users start without one and are prompted
--    in-app to choose. Unique so no two members can share a username.
alter table public.profiles
  add column if not exists username text;

create unique index if not exists profiles_username_key
  on public.profiles (lower(username))
  where username is not null;

-- 2) Let signed-in users set their own username (the app uses the user's own
--    session to write it). Adjust to taste if you already have stricter RLS.
do $$
begin
  if not exists (
    select 1 from pg_policies
     where schemaname = 'public'
       and tablename  = 'profiles'
       and policyname  = 'Users can update own username'
  ) then
    create policy "Users can update own username"
      on public.profiles
      for update
      using (auth.uid() = id)
      with check (auth.uid() = id);
  end if;
end $$;
