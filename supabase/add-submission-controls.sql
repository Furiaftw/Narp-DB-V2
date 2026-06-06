-- Submission controls table
-- Allows the owner to pause/reopen submission creation per entry type.
-- Single-row table enforced by CHECK constraint.

CREATE TABLE IF NOT EXISTS submission_controls (
  id                 int PRIMARY KEY DEFAULT 1,
  jutsu_paused       boolean NOT NULL DEFAULT false,
  custom_item_paused boolean NOT NULL DEFAULT false,
  summon_paused      boolean NOT NULL DEFAULT false,
  updated_by         uuid REFERENCES profiles(id) ON DELETE SET NULL,
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT single_row CHECK (id = 1)
);

INSERT INTO submission_controls (id, jutsu_paused, custom_item_paused, summon_paused)
VALUES (1, false, false, false)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE submission_controls ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read submission_controls"
  ON submission_controls FOR SELECT
  USING (true);

CREATE POLICY "Only owner can update submission_controls"
  ON submission_controls FOR UPDATE
  USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'owner')
  );
