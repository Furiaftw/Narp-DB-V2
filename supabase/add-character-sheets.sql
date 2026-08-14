-- In-database OC (character) sheets — the Google Sheet replacement.
--
-- One row per character. The volatile part of the sheet lives in `data`
-- (jsonb, shaped by src/constants/characterSheet.js); the few columns pulled
-- out of it are the ones the roster and any future filtering need to query.
--
-- Roster rows (roster_entries / roster_squads) are matched to a sheet by
-- character name, so the name is uniquely indexed case-insensitively.
--
-- Idempotent: safe to re-run.

CREATE TABLE IF NOT EXISTS public.character_sheets (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id       uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  character_name text NOT NULL,
  village        text,
  ninja_rank     text,
  bloodline      text,
  data           jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  updated_by     uuid REFERENCES public.profiles(id) ON DELETE SET NULL
);

-- One sheet per character name (trimmed, case-insensitive) so the roster's
-- name → sheet lookup can never be ambiguous.
CREATE UNIQUE INDEX IF NOT EXISTS character_sheets_name_key
  ON public.character_sheets (lower(btrim(character_name)));

CREATE INDEX IF NOT EXISTS character_sheets_owner_idx
  ON public.character_sheets (owner_id);

-- Keep updated_at honest without relying on the client.
CREATE OR REPLACE FUNCTION public.touch_character_sheet()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS character_sheets_touch ON public.character_sheets;
CREATE TRIGGER character_sheets_touch
  BEFORE UPDATE ON public.character_sheets
  FOR EACH ROW EXECUTE FUNCTION public.touch_character_sheet();

ALTER TABLE public.character_sheets ENABLE ROW LEVEL SECURITY;

-- Sheets are public reference material, same as the jutsu catalogue.
DROP POLICY IF EXISTS "Anyone can read character sheets" ON public.character_sheets;
CREATE POLICY "Anyone can read character sheets" ON public.character_sheets
  FOR SELECT USING (true);

-- A signed-in player creates sheets for themselves; staff+ can create a sheet
-- on anyone's behalf (e.g. backfilling an existing roster entry).
DROP POLICY IF EXISTS "Owner or staff creates character sheets" ON public.character_sheets;
CREATE POLICY "Owner or staff creates character sheets" ON public.character_sheets
  FOR INSERT WITH CHECK (
    owner_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role IN ('staff', 'oc_staff', 'admin', 'owner')
    )
  );

DROP POLICY IF EXISTS "Owner or staff updates character sheets" ON public.character_sheets;
CREATE POLICY "Owner or staff updates character sheets" ON public.character_sheets
  FOR UPDATE USING (
    owner_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role IN ('staff', 'oc_staff', 'admin', 'owner')
    )
  );

-- Deleting a sheet throws away a player's whole character record, so it stays
-- with the owner themselves and admin+.
DROP POLICY IF EXISTS "Owner or admin deletes character sheets" ON public.character_sheets;
CREATE POLICY "Owner or admin deletes character sheets" ON public.character_sheets
  FOR DELETE USING (
    owner_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role IN ('admin', 'owner')
    )
  );
