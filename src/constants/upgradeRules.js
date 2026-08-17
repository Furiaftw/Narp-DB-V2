/*
 * Phase-1 grading & upgrade rules, as data.
 *
 * Everything the RP credit economy needs to compute client-side: the
 * trainable-tag vocabulary graders grant credits against, the cost tables
 * (in credits = graded RPs), the per-shinobi-rank max-out ceilings in
 * machine-readable form, the soft-warning engine the reviewer sees at
 * Gate 2, and the weekly-cycle key (Monday 00:00 America/New_York — must
 * stay in lockstep with current_upgrade_cycle_key() in
 * supabase/add-rp-grading-upgrades.sql).
 *
 * Nothing here blocks: warnings are advice for the reviewer, who can
 * approve with a logged override reason. The hard invariants (self-grading,
 * self-OC approval, spent credits) live in the SECURITY DEFINER functions.
 */

import { STAT_RANKS } from './characterSheet';

// ─── UPGRADABLE FIELDS ───────────────────────────────────────────────────────
// Keys are the character sheet's data paths; labels double as the trainable
// tags a grader can put on a credit.

export const UPGRADE_STATS = [
  { key: 'chakra_level',  label: 'Chakra Level' },
  { key: 'chakra_control', label: 'Chakra Control' },
  { key: 'speed',    label: 'Speed' },
  { key: 'strength', label: 'Strength' },
];

export const UPGRADE_SKILLS = [
  { key: 'ninjutsu',  label: 'Ninjutsu' },
  { key: 'taijutsu',  label: 'Taijutsu' },
  { key: 'genjutsu',  label: 'Genjutsu' },
  { key: 'fuinjutsu', label: 'Fuinjutsu' },
  { key: 'bukijutsu', label: 'Bukijutsu' },
  { key: 'medical',   label: 'Medical' },
];

// The full vocabulary of tags a graded RP's credit can carry.
export const TRAINABLE_TAGS = [
  ...UPGRADE_STATS.map(s => s.label),
  ...UPGRADE_SKILLS.map(s => s.label),
  'Dojutsu',
  'Jutsu',
];

export const RP_TYPES = ['Regular', 'Event', 'Mission', 'Bounty', 'Squad'];

// ─── COST TABLES (in credits — one credit = one graded RP) ───────────────────

// Learn a new technique, by the jutsu's DB rank.
export const jutsuCost = (rank) =>
  rank === 'S' ? 3 : (rank === 'A' || rank === 'B') ? 2 : 1;

// Upgrade a stat by one level; cost = the level being REACHED.
export const statCost = (toRank) => ({ B: 2, A: 3, S: 4 }[toRank] ?? 1);

// Upgrade a skill by 10%; cost depends on the band being ENTERED.
export const skillCost = (toPct) =>
  toPct >= 100 ? 4 : toPct >= 80 ? 3 : toPct >= 50 ? 2 : 1;

// Dojutsu skills climb on their own table (and skip the shinobi-rank cap).
export const dojutsuCost = (toPct) =>
  toPct >= 100 ? 4 : toPct >= 70 ? 3 : toPct >= 40 ? 2 : 1;

// ─── STEP HELPERS ────────────────────────────────────────────────────────────
// Upgrades move exactly one step per request; cost depends on the current
// value (a skill at 40% → 50% costs 2, not 1), which is why the sheet keeps
// these as structured dropdown values rather than free text.

export const pctToNumber = (v) => parseInt(String(v || '0').replace('%', ''), 10) || 0;

export const nextStatRank = (cur) => {
  const i = STAT_RANKS.indexOf(cur || 'F');
  const from = i >= 0 ? i : 0;
  return from < STAT_RANKS.length - 1 ? STAT_RANKS[from + 1] : null;
};

export const nextSkillPct = (cur) => {
  const n = pctToNumber(cur);
  return n >= 100 ? null : n + 10;
};

export const statRankIndex = (r) => STAT_RANKS.indexOf(r || 'F');

// ─── WEEKLY CYCLE ────────────────────────────────────────────────────────────
// Grants are capped at 2 per character per cycle; the cycle resets Monday
// 00:00 America/New_York and is keyed by ISO year-week evaluated in ET
// (e.g. "2026-W34"), stamped at approval time. This must produce the same
// string as Postgres to_char(now() at time zone 'America/New_York',
// 'IYYY-"W"IW').

export const WEEKLY_UPGRADE_CAP = 2;

export const currentCycleKey = (now = new Date()) => {
  // en-CA gives YYYY-MM-DD; evaluate the calendar date in ET first.
  const [y, m, d] = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' })
    .format(now).split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  const day = date.getUTCDay() || 7;             // Mon=1 … Sun=7
  date.setUTCDate(date.getUTCDate() + 4 - day);  // the Thursday decides the ISO year
  const isoYear = date.getUTCFullYear();
  const jan1 = new Date(Date.UTC(isoYear, 0, 1));
  const week = Math.ceil(((date - jan1) / 86400000 + 1) / 7);
  return `${isoYear}-W${String(week).padStart(2, '0')}`;
};

// ─── RANK CEILINGS (machine-readable max-out caps) ───────────────────────────
// The prose version lives in characterSheet.js RANK_LIMITS; this is the same
// table structured for the warning engine: each rank allows `high.count`
// stats/skills up to `high` and the rest up to `rest`. Ranks without an
// entry (Academy Student, Anbu, Kage-Class) skip the ceiling warning.

export const RANK_CAPS = {
  'Genin':         { stats: { high: { count: 2, rank: 'C' }, rest: 'D' }, skills: { high: { count: 3, pct: 40 },  rest: 20 }, jutsuMax: 10 },
  'Chūnin':        { stats: { high: { count: 2, rank: 'B' }, rest: 'C' }, skills: { high: { count: 3, pct: 50 },  rest: 40 }, jutsuMax: 15 },
  'Special Jōnin': { stats: { high: { count: 2, rank: 'A' }, rest: 'B' }, skills: { high: { count: 3, pct: 60 },  rest: 50 }, jutsuMax: 20 },
  'Jōnin':         { stats: { high: { count: 2, rank: 'S' }, rest: 'A' }, skills: { high: { count: 3, pct: 80 },  rest: 60 }, jutsuMax: 25 },
  'Elite Jōnin':   { stats: { high: { count: 3, rank: 'S' }, rest: 'A' }, skills: { high: { count: 2, pct: 100 }, rest: 80 }, jutsuMax: 30, maxS: 3 },
};

// ─── TARGET BUILDERS ─────────────────────────────────────────────────────────
// An upgrade target is what approve_upgrade_request() applies atomically:
// { label, tag, path (into character_sheets.data), new_value }, plus the
// display fields the queues show. Builders return null when the field is
// already maxed.

export const buildStatTarget = (sheet, statKey) => {
  const def = UPGRADE_STATS.find(s => s.key === statKey);
  const cur = sheet?.stats?.[statKey] || 'F';
  const next = nextStatRank(cur);
  if (!def || !next) return null;
  return {
    label: `${def.label} ${cur} → ${next}`,
    tag: def.label,
    path: ['stats', statKey],
    new_value: next,
    from: cur, to: next,
    cost: statCost(next),
  };
};

export const buildSkillTarget = (sheet, skillKey) => {
  const def = UPGRADE_SKILLS.find(s => s.key === skillKey);
  const cur = pctToNumber(sheet?.skills?.[skillKey]);
  const next = nextSkillPct(cur);
  if (!def || next === null) return null;
  return {
    label: `${def.label} ${cur}% → ${next}%`,
    tag: def.label,
    path: ['skills', skillKey],
    new_value: `${next}%`,
    from: cur, to: next,
    cost: skillCost(next),
  };
};

export const buildDojutsuTarget = (sheet) => {
  const cur = pctToNumber(sheet?.limited?.dojutsu_skill);
  const next = nextSkillPct(cur);
  if (next === null) return null;
  const name = sheet?.limited?.dojutsu_name || 'Dojutsu';
  return {
    label: `${name} skill ${cur}% → ${next}%`,
    tag: 'Dojutsu',
    path: ['limited', 'dojutsu_skill'],
    new_value: `${next}%`,
    from: cur, to: next,
    cost: dojutsuCost(next),
  };
};

// Learning a jutsu rewrites the whole techniques.jutsu array: the new entry
// goes into the first empty slot, or replaces `dropIndex` when the player
// has to drop a technique to make room.
export const buildJutsuTarget = (sheet, { name, rank, nature, dropIndex }) => {
  if (!name || !rank) return null;
  const rows = (sheet?.techniques?.jutsu || []).map(r => ({ ...r }));
  const entry = { name, rank, nature: nature || '', approved: 'Yes', link: '' };
  let slot = Number.isInteger(dropIndex) && dropIndex >= 0 ? dropIndex : rows.findIndex(r => !r.name);
  if (slot === -1) slot = rows.length; // no empty row — append (warned below)
  rows[slot] = { ...(rows[slot] || {}), ...entry };
  return {
    label: `Learn ${name} (${rank}-rank)`,
    tag: 'Jutsu',
    path: ['techniques', 'jutsu'],
    new_value: rows,
    jutsu: { name, rank, nature: nature || '' },
    dropIndex: Number.isInteger(dropIndex) && dropIndex >= 0 ? dropIndex : null,
    cost: jutsuCost(rank),
  };
};

// ─── SOFT-WARNING ENGINE (Gate 2) ────────────────────────────────────────────
// Computes every advisory rule check for a request. The reviewer sees these
// and decides: approving past a warning requires a logged override reason.

export const computeUpgradeWarnings = ({
  sheet,             // normalized sheet (character_sheets.data)
  upgradeType,       // 'stat' | 'skill' | 'dojutsu_skill' | 'jutsu'
  target,            // from a builder above
  attachedCredits,   // rp_credits rows attached to the request
  approvedThisCycle, // count of grants already landed this cycle
}) => {
  const warnings = [];
  const credits = attachedCredits || [];
  const cost = target?.cost ?? 1;

  if ((approvedThisCycle ?? 0) >= WEEKLY_UPGRADE_CAP) {
    warnings.push({
      code: 'weekly_cap',
      message: `Weekly cap: this character already has ${approvedThisCycle} of ${WEEKLY_UPGRADE_CAP} upgrades this cycle — approving makes this the ${approvedThisCycle + 1}${approvedThisCycle + 1 === 3 ? 'rd' : 'th'}.`,
    });
  }

  const totalValue = credits.reduce((sum, c) => sum + (c.credit_value || 1), 0);
  if (totalValue < cost) {
    warnings.push({
      code: 'insufficient_credits',
      message: `Insufficient credits: ${totalValue} attached, ${cost} required.`,
    });
  }

  const tag = (target?.tag || '').toLowerCase();
  for (const c of credits) {
    const tags = (c.eligible_tags || []).map(t => String(t).toLowerCase());
    if (tags.length === 0) {
      warnings.push({
        code: 'untagged_credit',
        message: 'An attached credit has no eligible tags (Slice-of-Life / record-only) — it should not fund an upgrade.',
      });
    } else if (tag && !tags.includes(tag)) {
      warnings.push({
        code: 'tag_mismatch',
        message: `Tag mismatch: a credit tagged [${(c.eligible_tags || []).join(', ')}] is being spent on "${target.tag}".`,
      });
    }
  }

  const caps = RANK_CAPS[sheet?.personal?.shinobi_rank];
  if (caps) {
    if (upgradeType === 'stat' && target) {
      const toIdx = statRankIndex(target.to);
      const highIdx = statRankIndex(caps.stats.high.rank);
      const restIdx = statRankIndex(caps.stats.rest);
      if (toIdx > highIdx) {
        warnings.push({
          code: 'rank_max_out',
          message: `Rank ceiling: ${target.to} exceeds the ${sheet.personal.shinobi_rank} max-out (${caps.stats.high.count} stats at ${caps.stats.high.rank}, rest ${caps.stats.rest}).`,
        });
      } else if (toIdx > restIdx) {
        const othersAboveRest = UPGRADE_STATS.filter(s =>
          s.key !== target.path[1] && statRankIndex(sheet?.stats?.[s.key]) > restIdx
        ).length;
        if (othersAboveRest >= caps.stats.high.count) {
          warnings.push({
            code: 'rank_max_out',
            message: `Rank ceiling: only ${caps.stats.high.count} stats may sit above ${caps.stats.rest} for a ${sheet.personal.shinobi_rank} — ${othersAboveRest} already do.`,
          });
        }
      }
    }

    if (upgradeType === 'skill' && target) {
      if (target.to > caps.skills.high.pct) {
        warnings.push({
          code: 'rank_max_out',
          message: `Rank ceiling: ${target.to}% exceeds the ${sheet.personal.shinobi_rank} max-out (${caps.skills.high.count} skills at ${caps.skills.high.pct}%, rest ${caps.skills.rest}%).`,
        });
      } else if (target.to > caps.skills.rest) {
        const othersAboveRest = UPGRADE_SKILLS.filter(s =>
          s.key !== target.path[1] && pctToNumber(sheet?.skills?.[s.key]) > caps.skills.rest
        ).length;
        if (othersAboveRest >= caps.skills.high.count) {
          warnings.push({
            code: 'rank_max_out',
            message: `Rank ceiling: only ${caps.skills.high.count} skills may sit above ${caps.skills.rest}% for a ${sheet.personal.shinobi_rank} — ${othersAboveRest} already do.`,
          });
        }
      }
    }

    if (upgradeType === 'jutsu' && target) {
      const filled = (sheet?.techniques?.jutsu || []).filter(r => r.name).length;
      if (target.dropIndex === null && filled >= caps.jutsuMax) {
        warnings.push({
          code: 'jutsu_slot_limit',
          message: `No free jutsu slot: ${filled} of ${caps.jutsuMax} used for a ${sheet.personal.shinobi_rank}. The player must pick a jutsu to drop.`,
        });
      }
      if (caps.maxS && target.jutsu?.rank === 'S') {
        const sCount = (sheet?.techniques?.jutsu || []).filter(r => r.name && r.rank === 'S').length;
        if (sCount >= caps.maxS) {
          warnings.push({
            code: 'jutsu_slot_limit',
            message: `S-rank cap: ${sCount} of ${caps.maxS} S-rank slots already used.`,
          });
        }
      }
    }
  }
  // Dojutsu skills deliberately skip the shinobi-rank ceiling.

  return warnings;
};

// ─── GRADER GUIDANCE (Gate 1, non-blocking) ──────────────────────────────────
// The "red wire" criteria from the grading doc — surfaced as a checklist in
// the grader's verdict panel, never enforced.

export const GRADER_CHECKLIST = [
  'RP quality holds up (not a stat-farming transcript)',
  'Roughly 7+ posts per player',
  'Posts are semi-literate length or better',
  'Finished suspiciously fast (< 2 days)? Apply extra scrutiny',
];
