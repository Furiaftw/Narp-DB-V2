-- Tracks whether a user's role has ever been assigned from Discord.
-- NULL  = first login hasn't synced yet; Discord-derived role will be applied.
-- Set   = role was already synced on first login; manual member-board changes are preserved.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS discord_role_synced_at TIMESTAMPTZ DEFAULT NULL;
