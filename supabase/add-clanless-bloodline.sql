-- Clanless bloodline with unlimited slots.
-- The app treats max_slots = -1 (or the name 'Clanless') as unlimited capacity:
-- it never shows Full / Ask a Reviewer, and approved OCs are appended without a cap.
-- Idempotent — safe to run more than once in the Supabase SQL Editor.

INSERT INTO public.bloodlines (name, category, subcategory, link, max_slots)
SELECT 'Clanless', 'Canon', 'Other', '', -1
WHERE NOT EXISTS (SELECT 1 FROM public.bloodlines WHERE lower(name) = 'clanless');

UPDATE public.bloodlines SET max_slots = -1 WHERE lower(name) = 'clanless';
