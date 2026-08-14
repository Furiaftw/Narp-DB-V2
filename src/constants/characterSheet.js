/*
 * The NARP OC sheet, as data.
 *
 * This mirrors the Google Doc character sheet the server used to hand out
 * (人 PERSONAL INFORMATION → 家 FAMILY → 具 EQUIPMENT → 力 STATS → 技 SKILLS →
 * 獣 SUMMON → 異 SPECIAL SKILLS → 限 LIMITED ABILITIES → 術 TECHNIQUES →
 * 基 ACADEMY JUTSUS / Battle Modes → 趣 OTHER → 歆 BACKGROUND → 画 IMAGES →
 * 僀 PUPPET CATALOGUE), section for section, so a player filling this in the
 * app ends up with the same document they used to keep in Drive.
 *
 * Everything here is the *shape*; the values live in character_sheets.data.
 * Fields whose option list the NARP documentation actually specifies are
 * dropdowns; the rest stay free text rather than inventing a vocabulary.
 */

// ─── OPTION LISTS ────────────────────────────────────────────────────────────

// Stat ranks. Chakra Level / Chakra Control also feed the CU formula below;
// F sits under E and is worth the same 0 units.
export const STAT_RANKS = ['F', 'E', 'D', 'C', 'B', 'A', 'S'];
export const STAT_CU = { F: 0, E: 0, D: 5, C: 10, B: 15, A: 20, S: 25 };
export const BASE_CU = 5; // everyone starts with +5

// Skills are tracked as a percentage, 0–100 in steps of 10.
export const SKILL_LEVELS = ['0%', '10%', '20%', '30%', '40%', '50%', '60%', '70%', '80%', '90%', '100%'];

export const SHINOBI_RANKS = [
  'Academy Student', 'Genin', 'Chūnin', 'Special Jōnin',
  'Jōnin', 'Anbu', 'Elite Jōnin', 'Kage-Class',
];

export const SHEET_VILLAGES = [
  'Konohagakure', 'Kumogakure', 'Kirigakure', 'Iwagakure', 'Sunagakure',
  'Wanderer', 'Rogue',
];

// Bingo-book style threat rating, using the same letter scale as jutsu ranks.
export const THREAT_LEVELS = ['Unranked', 'E', 'D', 'C', 'B', 'A', 'S'];

export const CHARACTER_SLOTS = ['First OC', 'Second OC', 'Third OC'];

export const ECONOMIC_STATUS = ['Destitute', 'Poor', 'Lower Class', 'Middle Class', 'Upper Class', 'Wealthy'];

export const GENDERS = ['Male', 'Female', 'Non-binary', 'Other', 'Unspecified'];

export const BLOOD_TYPES = ['A', 'B', 'AB', 'O'];

export const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

export const FAMILY_STATUS = ['Alive', 'Deceased', 'Missing', 'Unknown', 'Other'];

export const SHEET_NATURES = [
  'Fire', 'Water', 'Lightning', 'Earth', 'Wind', 'Yin', 'Yang', 'Sound',
];

export const JUTSU_RANKS = ['E', 'D', 'C', 'B', 'A', 'S'];

export const APPROVED_STATES = ['Yes', 'No', 'Pending'];

export const SUMMON_LEVELS = [
  'Boss Summon', 'Major Summon 1', 'Major Summon 2',
  'Minor Summon 1', 'Minor Summon 2', 'Minor Summon 3', 'Minor Summon 4',
];

export const BATTLE_MODE_SLOTS = [
  'Tertiary Battle Mode', 'Tertiary Battle Mode',
  'Secondary Battle Mode', 'Primary Battle Mode',
];

// Everyone has these — the sheet prints them as a fixed checklist.
export const ACADEMY_JUTSUS = [
  'Basic Sealing Technique', 'Basic Unsealing Technique',
  'Bodyflicker Technique', 'Body Replacement Technique',
  'Water Walking Technique', 'Chakra Climbing Technique',
  'Transformation Technique', 'Basic Clone Technique',
  'Light Ball', 'Chakra Suppression Technique',
];

// Sheet limits straight from the doc.
export const LIMITS = {
  tools: 6,            // "Limit of 20 per tool" — 4 printed rows, a little room
  scrolls: 4,          // "Limit of 4 scrolls per character"
  specialWeapons: 2,   // "Limit of 2 Special Weapons & Items"
  specialTools: 2,
  family: 5,           // 2 parents + 3 other
  jutsuSlots: 30,
  pveSlots: 5,
  puppets: 12,
  images: 6,
};

/*
 * Starting / max-out ceilings per shinobi rank, quoted from the NARP
 * documentation. Shown next to the Stats and Skills sections so a player
 * filling the sheet doesn't have to go looking for the rules.
 */
export const RANK_LIMITS = {
  'Genin': {
    age: '13+',
    stats: 'Start: all at D or F · Max out: 2 at C, other 2 at D',
    skills: 'Start: all at 20% or lower · Max out: 3 at 40%, rest 20% or lower',
    techniques: 'Start: 1 nature | 5 jutsu (1 B, 4 C or below) · Max out: 2 natures | 10 jutsu',
  },
  'Chūnin': {
    age: '14+',
    stats: 'Start: 2 at C, rest at D or F · Max out: 2 at B, 2 at C or lower',
    skills: 'Start: 3 at 40%, rest 20% or lower · Max out: 3 at 50%, rest 40% or lower',
    techniques: 'Start: 2 natures | 10 jutsu (2 B, 8 C or below) · Max out: 2 natures | 15 jutsu',
  },
  'Special Jōnin': {
    age: '17+',
    stats: 'Start: 2 at B, rest at C or lower · Max out: 2 at A, rest B or lower',
    skills: 'Start: 3 at 50%, rest 40% or lower · Max out: 3 at 60%, rest 50% or lower',
    techniques: 'Start: 2 natures | 15 jutsu (1 A, 11 B or below) · Max out: 3 natures | 20 jutsu',
  },
  'Jōnin': {
    age: '18+',
    stats: 'Start: 2 at A, rest at B or lower · Max out: 2 at S, rest A or lower',
    skills: 'Start: 3 at 60%, rest 50% or lower · Max out: 3 at 80%, rest 60% or lower',
    techniques: 'Start: 3 natures | 20 jutsu (1 S, rest A or below) · Max out: 25 jutsu',
  },
  'Elite Jōnin': {
    age: 'Cannot be taken at creation',
    stats: 'Max out: 3 at S, rest at A or lower',
    skills: 'Max out: 2 at 100%, rest at 80% or lower',
    techniques: 'Max out: 4 natures | 30 jutsu (3 S, rest A or below)',
  },
};

// ─── EMPTY SHEET ─────────────────────────────────────────────────────────────

const rows = (n, shape) => Array.from({ length: n }, () => ({ ...shape }));

export const emptySheet = () => ({
  personal: {
    submitted_by: '', character_slot: '', aliases: '', village: '',
    threat_level: '', shinobi_rank: '', clan_kkg: '', economic_status: '',
    age: '', birthday_day: '', birthday_month: '', gender: '', blood_type: '',
    height: '', weight: '', personality: '', goals: '',
  },
  family: [
    { relation: 'Parent 1', name: '', status: '' },
    { relation: 'Parent 2', name: '', status: '' },
    ...rows(3, { relation: 'Other', name: '', status: '' }),
  ],
  equipment: {
    tools: rows(LIMITS.tools, { name: '', amount: '' }),
    scrolls: rows(LIMITS.scrolls, { name: '', contents: '' }),
    special_weapons: rows(LIMITS.specialWeapons, { name: '', link: '' }),
    special_tools: rows(LIMITS.specialTools, { name: '', link: '' }),
    special_items: '',
    prosthetic: '',
  },
  stats: {
    chakra_level: '', chakra_control: '', speed: '', strength: '',
    extra_cu: '', extra_cu_source: '',
  },
  skills: {
    ninjutsu: '', taijutsu: '', genjutsu: '',
    fuinjutsu: '', bukijutsu: '', medical: '',
  },
  summon: {
    contract: '', skill: '',
    entries: SUMMON_LEVELS.map(level => ({ level, name: '', link: '' })),
  },
  special: { special: '', ability: '', level: '' },
  limited: {
    dojutsu_name: '', dojutsu_stage: '', dojutsu_skill: '',
    clan_nature: '', natures: ['', '', '', '', ''],
  },
  techniques: {
    jutsu: rows(LIMITS.jutsuSlots, { name: '', rank: '', nature: '', approved: '', link: '' }),
    pve: rows(LIMITS.pveSlots, { name: '', rank: '', nature: '', approved: '', link: '' }),
  },
  battle_modes: {
    slots: BATTLE_MODE_SLOTS.map(slot => ({ slot, name: '', link: '' })),
    awakening_level: '',
    awakening_link: '',
    primary_abilities: rows(2, { name: '', link: '' }),
  },
  other: {
    foods: '', colors: '', hobbies: '', likes: '',
    dislikes: '', beliefs: '', locations: '',
  },
  background: '',
  images: [],
  puppets: [],
});

/*
 * Merge a stored sheet over the empty shape so a sheet saved before a section
 * existed still renders (and so a half-written `data` can never crash the UI).
 * Arrays are taken from the stored sheet wholesale but padded back up to the
 * printed row count.
 */
export const normalizeSheet = (stored) => {
  const base = emptySheet();
  if (!stored || typeof stored !== 'object') return base;

  const mergeRows = (baseArr, storedArr) => {
    if (!Array.isArray(storedArr)) return baseArr;
    const out = storedArr.map((row, i) => ({ ...(baseArr[i] || baseArr[0] || {}), ...row }));
    while (out.length < baseArr.length) out.push({ ...baseArr[out.length] });
    return out;
  };

  return {
    personal:   { ...base.personal, ...(stored.personal || {}) },
    family:     mergeRows(base.family, stored.family),
    equipment: {
      ...base.equipment,
      ...(stored.equipment || {}),
      tools:           mergeRows(base.equipment.tools, stored.equipment?.tools),
      scrolls:         mergeRows(base.equipment.scrolls, stored.equipment?.scrolls),
      special_weapons: mergeRows(base.equipment.special_weapons, stored.equipment?.special_weapons),
      special_tools:   mergeRows(base.equipment.special_tools, stored.equipment?.special_tools),
    },
    stats:      { ...base.stats, ...(stored.stats || {}) },
    skills:     { ...base.skills, ...(stored.skills || {}) },
    summon: {
      ...base.summon,
      ...(stored.summon || {}),
      entries: mergeRows(base.summon.entries, stored.summon?.entries),
    },
    special:    { ...base.special, ...(stored.special || {}) },
    limited: {
      ...base.limited,
      ...(stored.limited || {}),
      natures: Array.isArray(stored.limited?.natures)
        ? [...stored.limited.natures, '', '', '', '', ''].slice(0, 5)
        : base.limited.natures,
    },
    techniques: {
      jutsu: mergeRows(base.techniques.jutsu, stored.techniques?.jutsu),
      pve:   mergeRows(base.techniques.pve, stored.techniques?.pve),
    },
    battle_modes: {
      ...base.battle_modes,
      ...(stored.battle_modes || {}),
      slots:             mergeRows(base.battle_modes.slots, stored.battle_modes?.slots),
      primary_abilities: mergeRows(base.battle_modes.primary_abilities, stored.battle_modes?.primary_abilities),
    },
    other:      { ...base.other, ...(stored.other || {}) },
    background: typeof stored.background === 'string' ? stored.background : '',
    images:     Array.isArray(stored.images) ? stored.images : [],
    puppets:    Array.isArray(stored.puppets) ? stored.puppets : [],
  };
};

// ─── DERIVED VALUES ──────────────────────────────────────────────────────────

/*
 * Base CU = Chakra Level units + Chakra Control units + the flat +5 everyone
 * starts with (Chakra System, NARP documentation). Extra CU is free text
 * ("amount and from what"), so only its leading number counts toward the total.
 */
export const computeCU = (stats = {}) => {
  const level = STAT_CU[stats.chakra_level] ?? 0;
  const control = STAT_CU[stats.chakra_control] ?? 0;
  const base = level + control + BASE_CU;
  const extra = parseInt(String(stats.extra_cu ?? '').trim(), 10);
  const extraNum = Number.isFinite(extra) ? extra : 0;
  return { base, extra: extraNum, total: base + extraNum };
};

// A sheet is "started" once anything meaningful is in it — used to show an
// empty state instead of a page of dashes.
export const sheetHasContent = (sheet) => {
  if (!sheet) return false;
  const p = sheet.personal || {};
  return Boolean(
    p.village || p.shinobi_rank || p.age || p.personality ||
    sheet.background || (sheet.techniques?.jutsu || []).some(j => j.name)
  );
};

// Roster rows are matched to sheets by character name.
export const sheetKey = (name) => (name || '').trim().toLowerCase();
