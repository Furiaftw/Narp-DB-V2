-- Member Board: remove/ban functionality (netlify/functions/moderate-member.js).
--
-- The actual auth-level ban (blocking login) and account deletion happen via
-- the Supabase Admin API (auth.admin.updateUserById / deleteUser) from that
-- function using the service role key -- RLS can't reach auth.users, so there
-- is nothing to grant here for those two actions.
--
-- banned_at is a read-side mirror only, written by the same service-role
-- function, so the Member Board can show a "Banned" badge without an extra
-- Admin API round-trip per row. It carries no enforcement by itself.

alter table public.profiles add column if not exists banned_at timestamptz;
