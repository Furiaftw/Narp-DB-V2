-- The jutsu sheet (replaces the old "Doc Link" — see src/constants/jutsuSheet.js
-- for the shape) lives directly on the jutsus row, mirroring how
-- character_sheets.data works: one jsonb column, a few things pulled out as
-- real columns only where something needs to query on them (nothing does yet
-- for jutsus, so this is the whole thing).
ALTER TABLE public.jutsus
  ADD COLUMN IF NOT EXISTS sheet jsonb NOT NULL DEFAULT '{}'::jsonb;

-- Review chat history, moved out of Discord (.txt attachment) and into the
-- database, attached to the approved jutsu. Reviewer+ only — same tier as
-- who could see the pending review chat in the first place.
CREATE TABLE IF NOT EXISTS public.jutsu_review_history (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  jutsu_id     uuid REFERENCES public.jutsus(id) ON DELETE CASCADE,
  item_name    text,
  operation    text,
  transcript   text NOT NULL,
  submitted_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  reviewed_by  uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS jutsu_review_history_jutsu_idx
  ON public.jutsu_review_history (jutsu_id, created_at DESC);

ALTER TABLE public.jutsu_review_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Staff+ can read jutsu review history" ON public.jutsu_review_history;
CREATE POLICY "Staff+ can read jutsu review history" ON public.jutsu_review_history
  FOR SELECT USING (is_staff_or_above());

DROP POLICY IF EXISTS "Staff+ can insert jutsu review history" ON public.jutsu_review_history;
CREATE POLICY "Staff+ can insert jutsu review history" ON public.jutsu_review_history
  FOR INSERT WITH CHECK (is_staff_or_above());

-- Carry jutsu_type, pve, and the new sheet through approval — the RPC only
-- ever wrote the original fixed column set, so both jutsu_type (added by
-- add-jutsu-type-tags.sql) and pve had been silently dropped on every
-- approval since those columns were introduced. Fixed here alongside adding
-- sheet, since leaving them broken would show up as "my sheet didn't save"
-- confusion otherwise.
CREATE OR REPLACE FUNCTION public.approve_pending_jutsu(pending_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  p record;
  d jsonb;
begin
  if not is_staff_or_above() then
    raise exception 'Permission denied: must be staff or above';
  end if;

  select * into p from pending_jutsus where id = pending_id;
  if not found then
    raise exception 'Pending entry not found';
  end if;

  if p.submitted_by = auth.uid() then
    raise exception 'You cannot approve your own submission';
  end if;

  d := p.data;

  if p.operation = 'insert' then
    insert into jutsus (
      id, name, nature, rank, cost, types, origin, spec, link, bloodline,
      custom_tags, limited, locked, multi_rank, bm_tier, slots,
      jutsu_type, pve, sheet,
      created_by, last_modified_by
    ) values (
      coalesce(nullif(d->>'id','')::uuid, gen_random_uuid()),
      d->>'name',
      nullif(d->>'nature',''),
      coalesce(array(select jsonb_array_elements_text(d->'rank')), '{}'),
      nullif(d->>'cost',''),
      coalesce(array(select jsonb_array_elements_text(d->'types')), '{}'),
      nullif(d->>'origin',''),
      coalesce(array(select jsonb_array_elements_text(d->'spec')), '{}'),
      nullif(d->>'link',''),
      nullif(d->>'bloodline',''),
      coalesce(array(select jsonb_array_elements_text(d->'custom_tags')), '{}'),
      coalesce((d->>'limited')::boolean, false),
      coalesce((d->>'locked')::boolean, false),
      coalesce((d->>'multi_rank')::boolean, false),
      nullif(d->>'bm_tier',''),
      d->'slots',
      coalesce(array(select jsonb_array_elements_text(d->'jutsu_type')), '{}'),
      coalesce((d->>'pve')::boolean, false),
      coalesce(d->'sheet', '{}'::jsonb),
      p.submitted_by,
      auth.uid()
    );

  elsif p.operation = 'update' then
    update jutsus set
      name             = d->>'name',
      nature           = nullif(d->>'nature',''),
      rank             = coalesce(array(select jsonb_array_elements_text(d->'rank')), '{}'),
      cost             = nullif(d->>'cost',''),
      types            = coalesce(array(select jsonb_array_elements_text(d->'types')), '{}'),
      origin           = nullif(d->>'origin',''),
      spec             = coalesce(array(select jsonb_array_elements_text(d->'spec')), '{}'),
      link             = nullif(d->>'link',''),
      bloodline        = nullif(d->>'bloodline',''),
      custom_tags      = coalesce(array(select jsonb_array_elements_text(d->'custom_tags')), '{}'),
      limited          = coalesce((d->>'limited')::boolean, false),
      locked           = coalesce((d->>'locked')::boolean, false),
      multi_rank       = coalesce((d->>'multi_rank')::boolean, false),
      bm_tier          = nullif(d->>'bm_tier',''),
      slots            = d->'slots',
      jutsu_type       = coalesce(array(select jsonb_array_elements_text(d->'jutsu_type')), '{}'),
      pve              = coalesce((d->>'pve')::boolean, false),
      sheet            = coalesce(d->'sheet', '{}'::jsonb),
      last_modified_by = auth.uid()
    where id = p.target_id;

    if not found then
      raise exception 'The jutsu this update targets no longer exists. Cancel and resubmit.';
    end if;

  elsif p.operation = 'delete' then
    delete from jutsus where id = p.target_id;
    -- Silently succeed if the jutsu was already deleted by an admin.
  end if;

  delete from pending_jutsus where id = pending_id;
end;
$function$;
