export const SPECIALIZATION_OPTIONS = ['Bukijutsu', 'Fuinjutsu', 'Genjutsu', 'Medical Ninjutsu', 'Ninjutsu', 'Nintaijutsu', 'Taijutsu', 'Kinjutsu'];
export const NATURES                = ['Fire', 'Water', 'Lightning', 'Earth', 'Wind', 'Yang', 'Yin', 'Sound'];
export const JUTSU_TYPES            = ['1 Post', 'Continuous', 'Multi-Post', 'Battlemode', 'Defensive'];
export const RANKS                  = ['E', 'D', 'C', 'B', 'A', 'S'];
export const ORIGIN                 = ['Canon', 'Custom'];
export const BL_CATS                = ['Canon', 'Custom'];
export const BL_SUBCATS             = ['KKG', 'Hiden', 'Dojutsu', 'Specialization', 'Other'];
export const BM_TIERS               = ['Primary', 'Secondary', 'Tertiary'];
export const BM_TIER_TO_RANK        = { Primary: 'A', Secondary: 'B', Tertiary: 'C' };

export const RANK_COST_MAP = { E: '1 CU', D: '2 CU', C: '4 CU', B: '6 CU', A: '8 CU', S: '10 CU' };
export const RANK_COST_NUM = { E: 1, D: 2, C: 4, B: 6, A: 8, S: 10 };

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
};

export const STORAGE = {
  CACHE:      'narp_db_cache_v30',
  ROLE:       'narp_role_v1',
  TAGS:       'narp_tags_v1',
  VIEW_MODE:  'narp_view_mode_v1',
};

export const MANAGE_TABLES = {
  jutsus: {
    label: 'Jutsus',
    fields: [
      { k: 'name',        l: 'Jutsu Name',                 req: true, col: 1 },
      { k: 'link',        l: 'Doc Link',                               col: 1 },
      { k: 'nature',      l: 'Nature Type',     t: 'chip', opts: [...NATURES, 'N/A'], multi: true, col: 2 },
      { k: 'types',       l: 'Jutsu Types',     t: 'chip', opts: JUTSU_TYPES, multi: true, col: 1 },
      { k: 'rank',        l: 'Rank',            t: 'chip', opts: RANKS, multi: true, hideIfInc:    { f: 'types', v: 'Battlemode' }, col: 1 },
      { k: 'bm_tier',     l: 'Battlemode Tier', t: 'chip', opts: BM_TIERS,             hideUnlessInc:{ f: 'types', v: 'Battlemode' }, col: 1 },
      { k: 'origin',      l: 'Origin',          t: 'chip', opts: ORIGIN, col: 1 },
      { k: 'conditions',  l: 'Conditions',      t: 'chip', opts: ['Locked', 'Limited', 'Pve'], multi: true, col: 1 },
      { k: 'spec',        l: 'Specialization',  t: 'spec-dd', col: 1 },
      { k: 'bloodline',   l: 'Bloodline',       t: 'bl-select', col: 1 },
      { k: 'custom_tags', l: 'Custom Tags (comma separated)', col: 2 },
      { k: 'cost',        l: 'Cost', hidden: true },
      { k: 'slots',       l: 'Slots', t: 'slots', hideUnlessInc: { f: 'conditions', v: 'Limited' }, col: 2 },
    ],
  },
  bloodlines: {
    label: 'Bloodlines',
    fields: [
      { k: 'name',        l: 'Name',            req: true, col: 1 },
      { k: 'link',        l: 'Doc Link',                   col: 1 },
      { k: 'category',    l: 'Category',        t: 'chip', opts: BL_CATS,    req: true, col: 1 },
      { k: 'subcategory', l: 'Subcategory',     t: 'chip', opts: BL_SUBCATS, req: true, col: 1 },
      { k: 'custom_tags', l: 'Custom Tags (comma separated)', col: 2 },
    ],
  },
};
