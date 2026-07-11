-- One-time "Wanderer ticket" system: an admin grants a specific user
-- permission to submit exactly one Wanderer-faction OC (after they've
-- worked it out with an admin in Discord). The ticket is consumed the
-- moment the user submits a Wanderer OC — cancelling the submission does
-- NOT refund it; the user has to ask an admin for a new one.
--
-- Both mutations go through SECURITY DEFINER RPCs rather than a raw table
-- grant, so a user can't just flip their own wanderer_ticket column.
-- Run once in the Supabase SQL Editor.

alter table public.profiles
  add column if not exists wanderer_ticket boolean not null default false,
  add column if not exists wanderer_ticket_granted_by uuid references public.profiles(id),
  add column if not exists wanderer_ticket_granted_at timestamptz;

-- Admin/owner-only: grant a fresh ticket to a user.
create or replace function public.grant_wanderer_ticket(target_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_role text;
begin
  select role into caller_role from public.profiles where id = auth.uid();
  if caller_role not in ('admin', 'owner') then
    raise exception 'Admin access required';
  end if;

  update public.profiles
     set wanderer_ticket = true,
         wanderer_ticket_granted_by = auth.uid(),
         wanderer_ticket_granted_at = now()
   where id = target_user_id;

  if not found then
    raise exception 'User not found';
  end if;
end;
$$;

-- Self-service: atomically consume the caller's own ticket at submission
-- time. Returns true if a ticket was actually consumed, false if the
-- caller had none (so the client can block the submission).
create or replace function public.consume_wanderer_ticket()
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  consumed boolean;
begin
  update public.profiles
     set wanderer_ticket = false
   where id = auth.uid() and wanderer_ticket = true;

  consumed := found;
  return consumed;
end;
$$;

grant execute on function public.grant_wanderer_ticket(uuid) to authenticated;
grant execute on function public.consume_wanderer_ticket() to authenticated;
