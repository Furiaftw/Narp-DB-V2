import { LS, toArray, getSortKey } from './helpers';
import { STORAGE, RANK_COST_MAP, RANK_COST_NUM, STATIC_SEED } from '../constants/catalog';
import { isSupabaseConfigured, fetchAllFromSupabase } from '../lib/supabase';

/* ============================================================================
   DATABASE LOADING
   normalizeDB maps raw rows into the shape the catalog renders; loadDB is the
   cache-then-network read, falling back to STATIC_SEED only in dev mode (no
   Supabase configured) so a temporarily unreachable backend never poisons the
   cache with demo data.
   ============================================================================ */





export const normalizeDB = (d) => ({
  jutsus: (d.jutsus || []).map((j, i) => {
    const rArr = toArray(j.rank).slice().sort((a, b) => (RANK_COST_NUM[a] || 0) - (RANK_COST_NUM[b] || 0));
    let cost = j.cost || '';
    if (cost) {
      const sumCU  = rArr.reduce((s, r) => s + (RANK_COST_NUM[r] || 0), 0) + ' CU';
      const slash  = rArr.map(r => RANK_COST_MAP[r]).filter(Boolean).join(' / ');
      const dash   = rArr.map(r => RANK_COST_MAP[r]).filter(Boolean).join(' - ');
      const single = rArr.length === 1 ? RANK_COST_MAP[rArr[0]] : null;
      if (cost === sumCU || cost === slash || cost === dash || cost === single) cost = '';
    }
    return {
      ...j,
      _id:         j._id || `j-${i}`,
      name:        j.name || '',
      nature:      j.nature || '',
      rank:        rArr,
      types:       toArray(j.types),
      jutsu_type:  toArray(j.jutsu_type),
      origin:      j.origin || '',
      spec:        toArray(j.spec),
      link:        j.link || '',
      bloodline:   j.bloodline || '',
      custom_tags: toArray(j.custom_tags),
      limited:     !!j.limited,
      locked:      !!j.locked || !!j.mustLearnIC,
      multiRank:   !!j.multiRank,
      bm_tier:     j.bm_tier || '',
      slots:       j.slots || '',
      cost,
      _createdAt:  j._createdAt || j.created_at || null,
    };
  }),

  bloodlines: Array.isArray(d.bloodlines)
    ? d.bloodlines.map((b, i) => ({
        ...b,
        _id:                      b._id || `b-${i}`,
        name:                     b.name || '',
        category:                 b.category    || 'Custom',
        subcategory:              b.subcategory || 'Other',
        custom_tags:              toArray(b.custom_tags),
        link:                     b.link || b.doc_link || '',
        proprietary_ability_link: b.proprietary_ability_link || '',
        max_slots:                b.max_slots != null ? Number(b.max_slots) : 5,
        slots:                    b.slots || '',
        _createdAt:               b._createdAt || b.created_at || null,
      }))
    : STATIC_SEED.bloodlines,

  specializations: Array.isArray(d.specializations) ? d.specializations : STATIC_SEED.specializations,
  jutsuTypeTags:   Array.isArray(d.jutsuTypeTags) ? d.jutsuTypeTags : STATIC_SEED.jutsuTypeTags,
});

export const loadDB = async () => {
  try {
    if (isSupabaseConfigured()) {
      try {
        // 10s timeout — Safari/Mac needs more time for TLS handshake on cold Supabase connections
        const fetchPromise = fetchAllFromSupabase();
        const timeoutPromise = new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Supabase fetch timeout')), 10000)
        );
        const remote = await Promise.race([fetchPromise, timeoutPromise]);
        if (remote) {
          const normalized = normalizeDB(remote);
          LS.set(STORAGE.CACHE, { ...normalized, ts: Date.now() });
          return normalized;
        }
      } catch (err) {
        console.warn('[NARP] Supabase fetch failed; falling back to local cache.', err);
      }
    }
    const cached = LS.get(STORAGE.CACHE, null);
    // Skip a stale STATIC_SEED cache when Supabase is configured — seed IDs are shaped like
    // 'j-0-0'. Serving those would show fake demo data instead of retrying the real DB.
    const isSeedCache = /^j-\d+-\d+$/.test(cached?.jutsus?.[0]?.id ?? '');
    if (cached?.jutsus?.length && !(isSupabaseConfigured() && isSeedCache)) {
      try {
        return normalizeDB(cached);
      } catch (cachedErr) {
        console.warn('[NARP] Cached DB normalization failed; falling back to static seed.', cachedErr);
      }
    }
  } catch (globalErr) {
    console.warn('[NARP] Unexpected error in loadDB, falling back to static seed.', globalErr);
  }
  // Only persist STATIC_SEED to localStorage in pure offline/dev mode (no Supabase configured).
  // When Supabase IS configured but temporarily unreachable, don't poison the cache —
  // the next load should retry the real DB rather than serving fake demo data.
  if (!isSupabaseConfigured()) {
    LS.set(STORAGE.CACHE, { ...STATIC_SEED, ts: Date.now() });
  }
  return normalizeDB(STATIC_SEED);
};
