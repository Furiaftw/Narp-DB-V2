/*
 * The jutsu write-up, as data — the in-database replacement for the Google
 * Doc a submission used to link to (NARP Jutsu Template). Lives in
 * `jutsus.sheet` (jsonb) / `pending_jutsus.data.sheet` while a submission is
 * in the queue; the taxonomy fields it doesn't cover (nature, origin, rank,
 * specialization, bloodline, limited status) stay on the jutsu row itself,
 * unchanged.
 *
 * Fields the original template also had — a top-level Mechanics category,
 * Casting Category, and a pair of Combat Type selects — are intentionally
 * left out: there's no existing vocabulary for them in this app yet.
 */

export const JUTSU_RANKS_ORDER = ['E', 'D', 'C', 'B', 'A', 'S'];

const rows = (n, shape) => Array.from({ length: n }, () => ({ ...shape }));

export const emptyJutsuSheet = () => ({
  image: '',
  developed_by: '',
  prerequisites: '',
  description: '',
  mechanics_steps: rows(7, { text: '' }),
  restrictions: '',
  wiki_link: '',
  multi_rank: {
    stat: JUTSU_RANKS_ORDER.map(rank => ({ rank, scaled: '', details: '', casting_types: '', mechanics: '' })),
    skill: JUTSU_RANKS_ORDER.map(rank => ({ rank, scaled: '', details: '', casting_types: '', mechanics: '' })),
  },
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

  return {
    image:          typeof stored.image === 'string' ? stored.image : '',
    developed_by:   typeof stored.developed_by === 'string' ? stored.developed_by : '',
    prerequisites:  typeof stored.prerequisites === 'string' ? stored.prerequisites : '',
    description:    typeof stored.description === 'string' ? stored.description : '',
    mechanics_steps: mergeRows(base.mechanics_steps, stored.mechanics_steps),
    restrictions:   typeof stored.restrictions === 'string' ? stored.restrictions : '',
    wiki_link:      typeof stored.wiki_link === 'string' ? stored.wiki_link : '',
    multi_rank: {
      stat:  mergeRows(base.multi_rank.stat, stored.multi_rank?.stat),
      skill: mergeRows(base.multi_rank.skill, stored.multi_rank?.skill),
    },
  };
};

// A sheet is "started" once anything meaningful is in it — used to show an
// empty state instead of a page of dashes.
export const jutsuSheetHasContent = (sheet) => {
  if (!sheet) return false;
  return Boolean(
    sheet.description || sheet.restrictions || sheet.developed_by || sheet.prerequisites ||
    (sheet.mechanics_steps || []).some(s => s.text) ||
    (sheet.multi_rank?.stat || []).some(r => r.scaled || r.details) ||
    (sheet.multi_rank?.skill || []).some(r => r.scaled || r.details)
  );
};
