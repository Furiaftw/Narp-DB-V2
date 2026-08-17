/*
 * The jutsu write-up, as data — the in-database replacement for the Google
 * Doc a submission used to link to (NARP Jutsu Template). Lives in
 * `jutsus.sheet` (jsonb) / `pending_jutsus.data.sheet` while a submission is
 * in the queue; the taxonomy fields it doesn't cover (nature, origin, rank,
 * specialization, bloodline, limited status) stay on the jutsu row itself,
 * unchanged.
 *
 * A multi-rank jutsu (rank.length > 1) doesn't share one write-up across
 * ranks — each rank gets its own documentation, since the mechanics usually
 * differ. For those, `sheet` holds a map of rank -> single-doc shape instead
 * of a single-doc shape directly; the reader picks a rank before opening one.
 *
 * Fields the original template also had — a top-level Mechanics category,
 * Casting Category, and a pair of Combat Type selects — are intentionally
 * left out: there's no existing vocabulary for them in this app yet.
 */

const rows = (n, shape) => Array.from({ length: n }, () => ({ ...shape }));

export const emptyDevelopedBy = () => ({ type: 'unknown', oc_name: '', npc_name: '' });

export const emptyJutsuSheet = () => ({
  developed_by: emptyDevelopedBy(),
  prerequisites: '',
  description: '',
  mechanics_steps: rows(7, { text: '' }),
  restrictions: '',
  wiki_link: '',
});

/*
 * Merge a stored sheet over the empty shape so a sheet saved before a section
 * existed still renders, and so a half-written blob can never crash the UI.
 */
export const normalizeJutsuSheet = (stored) => {
  const base = emptyJutsuSheet();
  if (!stored || typeof stored !== 'object') return base;

  const mergeRows = (baseArr, storedArr) => {
    if (!Array.isArray(storedArr)) return baseArr;
    const out = storedArr.map((row, i) => ({ ...(baseArr[i] || baseArr[0] || {}), ...row }));
    while (out.length < baseArr.length) out.push({ ...baseArr[out.length] });
    return out.slice(0, baseArr.length);
  };

  // Older sheets stored developed_by as a plain free-text name — treat any
  // non-empty legacy string as an NPC name rather than dropping it.
  let developedBy = emptyDevelopedBy();
  if (stored.developed_by && typeof stored.developed_by === 'object') {
    developedBy = { ...emptyDevelopedBy(), ...stored.developed_by };
  } else if (typeof stored.developed_by === 'string' && stored.developed_by.trim()) {
    developedBy = { ...emptyDevelopedBy(), type: 'npc', npc_name: stored.developed_by.trim() };
  }

  return {
    developed_by:   developedBy,
    prerequisites:  typeof stored.prerequisites === 'string' ? stored.prerequisites : '',
    description:    typeof stored.description === 'string' ? stored.description : '',
    mechanics_steps: mergeRows(base.mechanics_steps, stored.mechanics_steps),
    restrictions:   typeof stored.restrictions === 'string' ? stored.restrictions : '',
    wiki_link:      typeof stored.wiki_link === 'string' ? stored.wiki_link : '',
  };
};

// A sheet is "started" once anything meaningful is in it — used to show an
// empty state instead of a page of dashes.
export const jutsuSheetHasContent = (sheet) => {
  if (!sheet) return false;
  const db = sheet.developed_by;
  const developedByFilled = db && typeof db === 'object'
    ? ((db.type === 'oc' && db.oc_name) || (db.type === 'npc' && db.npc_name))
    : !!db;
  return Boolean(
    sheet.description || sheet.restrictions || developedByFilled || sheet.prerequisites ||
    (sheet.mechanics_steps || []).some(s => s.text)
  );
};

// Same check, but for the rank -> doc map a multi-rank jutsu stores.
export const jutsuDocsHaveContent = (sheetOrMap, isMultiRank) => {
  if (!sheetOrMap) return false;
  if (isMultiRank) return Object.values(sheetOrMap).some(jutsuSheetHasContent);
  return jutsuSheetHasContent(sheetOrMap);
};
