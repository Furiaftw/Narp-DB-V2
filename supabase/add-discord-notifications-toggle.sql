-- A single owner-toggleable switch that mutes every outbound Discord
-- notification tied to submission activity: new-submission pings, the
-- second-reviewer-needed ping, the reviewer nudge DM, the approval/denial
-- log post, and the per-reviewer work-log embed. Checked server-side inside
-- each Netlify function (reviewer-ping.mjs, nudge-reviewer.mjs,
-- send-discord-log.mjs, reviewer-work-log.mjs) so it can't be bypassed by
-- stale client state.
--
-- Idempotent: safe to re-run.

ALTER TABLE public.submission_controls
  ADD COLUMN IF NOT EXISTS discord_notifications_paused boolean NOT NULL DEFAULT false;

-- Summon and Custom Item submissions are being disabled for now — their
-- forms only ever captured a mandatory Google Doc link and nothing else,
-- and that link requirement is going away server-wide. Proper in-app forms
-- for these are a future update; until then, keep them paused via the
-- existing gate (owner can re-open from System Tools once that ships).
UPDATE public.submission_controls
  SET summon_paused = true, custom_item_paused = true
  WHERE id = 1;
