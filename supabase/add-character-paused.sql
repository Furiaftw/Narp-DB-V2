-- Adds the OC Submission gate to submission_controls, alongside the
-- existing jutsu/custom-item/summon pause flags.
-- Idempotent — safe to run more than once.

ALTER TABLE submission_controls
  ADD COLUMN IF NOT EXISTS character_paused boolean NOT NULL DEFAULT false;
