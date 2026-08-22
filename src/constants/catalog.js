/* ---------------------------------------------------------------------------
   CATALOG CONSTANTS — the single source of truth.

   These used to be duplicated: an inline copy in App.jsx (which the running
   app actually used) and a drifted copy here that nothing live imported. The
   two had diverged in ways that mattered — this file's MANAGE_TABLES was
   missing the jutsu_type field and the bloodline slot fields, and still
   carried the removed Doc Link / Pve options. The App.jsx copies are gone
   now; this is what everything imports.
   --------------------------------------------------------------------------- */

export const STORAGE = {
  CACHE:      'narp_db_cache_v30',
  ROLE:       'narp_role_v1',
  TAGS:       'narp_tags_v1',
  VIEW_MODE:  'narp_view_mode_v1',
  CART:       'narp_cart_v1',
  CHAT_READ:  'narp_chat_read_v1',
  SHUTDOWN_BANNER: 'narp_shutdown_banner_dismissed_v1',
};

// The read-only cutover date the shutdown banner counts down to.
export const SHUTDOWN_AT = new Date('2026-08-20T00:00:00Z').getTime();

export const SPECIALIZATION_OPTIONS = ['Bukijutsu', 'Fuinjutsu', 'Genjutsu', 'Medical Ninjutsu', 'Ninjutsu', 'Nintaijutsu', 'Taijutsu', 'Kinjutsu'];
export const NATURES                = ['Fire', 'Water', 'Lightning', 'Earth', 'Wind', 'Yang', 'Yin', 'Sound'];
export const JUTSU_TYPES            = ['1 Post', 'Continuous', 'Multi-Post', 'Battlemode'];
export const JUTSU_TYPE_TAG_OPTIONS = ['Offensive', 'Defensive', 'Mobility', 'Utility', 'Sensory', 'Multi-Purpose'];
export const RANKS                  = ['E', 'D', 'C', 'B', 'A', 'S'];
export const ORIGIN                 = ['Canon', 'Custom'];
export const BL_CATS                = ['Canon', 'Custom'];
export const BL_SUBCATS             = ['KKG', 'Hiden', 'Dojutsu', 'Specialization', 'Other'];
export const BM_TIERS               = ['Primary', 'Secondary', 'Tertiary'];
export const BM_TIER_TO_RANK        = { Primary: 'A', Secondary: 'B', Tertiary: 'C' };

export const RANK_COST_MAP = { E: '1 CU', D: '2 CU', C: '4 CU', B: '6 CU', A: '8 CU', S: '10 CU' };
export const RANK_COST_NUM = { E: 1, D: 2, C: 4, B: 6, A: 8, S: 10 };

/* ---------------------------------------------------------------------------
   DEV-MODE SEED DATA (used only when Supabase is not configured)
   --------------------------------------------------------------------------- */
const baseJutsus = [
  { name: 'Fireball',           nature: 'Fire',     rank: ['C'],         types: ['1 Post'],     origin: 'Canon',  spec: ['Ninjutsu'], bloodline: 'Sharingan' },
  { name: 'Chidori',             nature: 'Lightning', rank: ['B', 'A'],   types: ['1 Post'],     origin: 'Canon',  spec: ['Ninjutsu'], locked: true, multiRank: true },
  { name: 'Water Dragon',        nature: 'Water',     rank: ['B'],        types: ['1 Post'],     origin: 'Canon',  spec: ['Ninjutsu'] },
  { name: 'Earth Wall',          nature: 'Earth',     rank: ['B'],        types: ['Continuous'], origin: 'Canon',  spec: ['Ninjutsu'] },
  { name: 'Gentle Fist',         nature: '',          rank: ['D','C','B'], types: ['1 Post'],    origin: 'Canon',  spec: ['Taijutsu'], locked: true, multiRank: true },
  { name: 'Crystal Wall',        nature: '',          rank: ['B'],        types: ['Continuous'], origin: 'Custom', spec: ['Ninjutsu'], bloodline: 'Crystal Release', limited: true,
    slots: JSON.stringify([{ username: 'Rikimo Aki', discord_link: 'https://discord.com/channels/1473338897697214584/1504439366624481391' }, { username: '', discord_link: '' }]) },
  { name: 'Curse Mark Level 1',  nature: 'Senjutsu',  rank: ['C'],        types: ['Battlemode'], origin: 'Canon',  spec: ['Senjutsu'], bm_tier: 'Tertiary', locked: true },
  { name: 'Eight Gates',         nature: '',          rank: ['A'],        types: ['Battlemode'], origin: 'Canon',  spec: ['Taijutsu'], bm_tier: 'Primary' },
];

const baseBloodlines = [
  { name: 'Sharingan',       category: 'Canon',  subcategory: 'Dojutsu', link: '#' },
  { name: 'Crystal Release', category: 'Custom', subcategory: 'KKG',     link: '#' },
  { name: 'Uzumaki',         category: 'Canon',  subcategory: 'Other',   link: '#' },
  { name: 'Storm Release',   category: 'Custom', subcategory: 'KKG',     link: '#' },
];

const multiplyData = (arr, prefix, times) => {
  const out = [];
  for (let i = 0; i < times; i++) {
    arr.forEach((item, idx) => out.push({
      ...item,
      _id: `${prefix}-${idx}-${i}`,
      name: `${item.name}${i > 0 ? ` V${i + 1}` : ''}`,
    }));
  }
  return out;
};
export const STATIC_SEED = {
  jutsus:          multiplyData(baseJutsus, 'j', 8),
  bloodlines:      multiplyData(baseBloodlines, 'bl', 8),
  specializations: SPECIALIZATION_OPTIONS,
  jutsuTypeTags:   JUTSU_TYPE_TAG_OPTIONS,
};

/* ---------------------------------------------------------------------------
   FORM SCHEMA

/* ---------------------------------------------------------------------------
   FORM SCHEMA — drives AdminFormModal's field rendering.
   --------------------------------------------------------------------------- */
export const MANAGE_TABLES = {
  jutsus: {
    label: 'Jutsus',
    fields: [
      { k: 'name',        l: 'Jutsu Name',                 req: true, col: 1 },
      { k: 'nature',      l: 'Nature Type',     t: 'chip', opts: [...NATURES, 'N/A'], multi: true, req: true, col: 2 },
      { k: 'types',       l: 'Jutsu Category',  t: 'chip', opts: JUTSU_TYPES, multi: true, req: true, col: 1 },
      { k: 'jutsu_type',  l: 'Jutsu Type',      t: 'ttag-dd', req: true, hideIfInc: { f: 'types', v: 'Battlemode' }, col: 1 },
      { k: 'rank',        l: 'Rank',            t: 'chip', opts: RANKS, multi: true, req: true, hideIfInc:    { f: 'types', v: 'Battlemode' }, col: 1 },
      { k: 'bm_tier',     l: 'Battlemode Tier', t: 'chip', opts: BM_TIERS,             hideUnlessInc:{ f: 'types', v: 'Battlemode' }, col: 1 },
      { k: 'origin',      l: 'Origin',          t: 'chip', opts: ORIGIN, req: true, col: 1 },
      { k: 'conditions',  l: 'Conditions',      t: 'chip', opts: ['Locked', 'Limited'], multi: true, col: 1 },
      { k: 'spec',        l: 'Specialization',  t: 'spec-dd', req: true, col: 1 },
      { k: 'bloodline',   l: 'Bloodline',       t: 'bl-select', col: 1 },
      { k: 'custom_tags', l: 'Custom Tags (comma separated)', col: 2 },
      { k: 'cost',        l: 'Cost', hidden: true },
      { k: 'slots',       l: 'Slots', t: 'slots', hideUnlessInc: { f: 'conditions', v: 'Limited' }, col: 2 },
    ],
  },
  bloodlines: {
    label: 'Bloodlines',
    fields: [
      { k: 'name',                   l: 'Name',                                req: true, col: 1 },
      { k: 'link',                   l: 'Doc Link',                                       col: 1 },
      { k: 'proprietary_ability_link', l: 'Proprietary Ability Doc Link',                 col: 1 },
      { k: 'category',               l: 'Category',    t: 'chip', opts: BL_CATS,    req: true, col: 1 },
      { k: 'subcategory',            l: 'Subcategory', t: 'chip', opts: BL_SUBCATS, req: true, col: 1 },
      { k: 'max_slots',              l: 'Max Slots',                                       col: 1 },
      { k: 'slots',                  l: 'Slots',       t: 'slots', defCountField: 'max_slots', col: 2 },
      { k: 'custom_tags',            l: 'Custom Tags (comma separated)',                   col: 2 },
    ],
  },
};
