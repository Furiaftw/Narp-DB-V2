-- Tracks how many times the reviewer team has been pinged requesting a
-- second reviewer for a pending_approval entry, and when the last ping
-- went out, so the UI can enforce a 24h cooldown between manual re-pings.
ALTER TABLE public.pending_jutsus
  ADD COLUMN IF NOT EXISTS second_approval_ping_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_second_approval_ping_at TIMESTAMPTZ DEFAULT NULL;
