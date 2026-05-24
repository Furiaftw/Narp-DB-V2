-- Auto-create a profile row whenever a new user signs up via Supabase Auth.
-- Run this in the Supabase SQL Editor (Dashboard > SQL Editor > New query).

-- 1) Function: copies basic info from auth.users into public.profiles
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
declare
  _role text := 'user';
  _wl   record;
begin
  -- Check whitelist first
  select role into _wl
    from public.whitelist
   where email = lower(new.email)
   limit 1;

  if found then
    _role := _wl.role;
    -- Remove from whitelist after use
    delete from public.whitelist where email = lower(new.email);
  end if;

  insert into public.profiles (id, email, full_name, avatar_url, role)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name', ''),
    coalesce(new.raw_user_meta_data ->> 'avatar_url', new.raw_user_meta_data ->> 'picture', ''),
    _role
  )
  on conflict (id) do update set
    email      = excluded.email,
    full_name  = excluded.full_name,
    avatar_url = excluded.avatar_url;

  return new;
end;
$$;

-- 2) Trigger: fires after every new auth.users row
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
