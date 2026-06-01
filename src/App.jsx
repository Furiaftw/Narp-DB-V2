import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { DiscordSDK } from '@discord/embedded-app-sdk';
import {
  supabase,
  isSupabaseConfigured,
  fetchAllFromSupabase,
  upsertJutsu,
  deleteJutsu,
  upsertBloodline,
  deleteBloodline,
  setSpecializations as saveSpecializationsToSupabase,
  signInWithDiscord,
  signOut,
  getCurrentSession,
  onAuthChange,
  fetchMyProfile,
  updateMyUsername,
  fetchAllProfiles,
  setUserRole,
  fetchWhitelist,
  addToWhitelist,
  removeFromWhitelist,
  fetchPendingJutsus,
  submitPendingJutsu,
  reviewPendingJutsu,
  updatePendingJutsuData,
  subscribeToDatabaseChanges,
  approvePendingJutsu,
  cancelPendingJutsu,
  buildJutsuPayload,
  fromRowJutsu,
  fetchRoleChangeLog,
} from './lib/supabase';


/* ============================================================================
   NARP DATABASE — Clean Unified Build
   ============================================================================ */

/* ---------------------------------------------------------------------------
   STORAGE KEYS
   --------------------------------------------------------------------------- */
const STORAGE = {
  CACHE:      'narp_db_cache_v30',
  ROLE:       'narp_role_v1',
  TAGS:       'narp_tags_v1',
  VIEW_MODE:  'narp_view_mode_v1',
};

/* ---------------------------------------------------------------------------
   CONSTANTS
   --------------------------------------------------------------------------- */
const SPECIALIZATION_OPTIONS = ['Bukijutsu', 'Fuinjutsu', 'Genjutsu', 'Medical Ninjutsu', 'Ninjutsu', 'Nintaijutsu', 'Taijutsu', 'Kinjutsu'];
const NATURES                = ['Fire', 'Water', 'Lightning', 'Earth', 'Wind', 'Yang', 'Yin', 'Sound'];
const JUTSU_TYPES            = ['1 Post', 'Continuous', 'Multi-Post', 'Battlemode'];
const RANKS                  = ['E', 'D', 'C', 'B', 'A', 'S'];
const ORIGIN                 = ['Canon', 'Custom'];
const BL_CATS                = ['Canon', 'Custom'];
const BL_SUBCATS             = ['KKG', 'Hiden', 'Dojutsu', 'Specialization', 'Other'];
const BM_TIERS               = ['Primary', 'Secondary', 'Tertiary'];
const BM_TIER_TO_RANK        = { Primary: 'A', Secondary: 'B', Tertiary: 'C' };

const RANK_COST_MAP = { E: '1 CU', D: '2 CU', C: '4 CU', B: '6 CU', A: '8 CU', S: '10 CU' };
const RANK_COST_NUM = { E: 1, D: 2, C: 4, B: 6, A: 8, S: 10 };

const MOCK_ADMIN = { uid: 'admin-1', email: 'admin@preview', role: 'admin' };
const MOCK_USER  = { uid: 'user-1',  email: 'user@preview',  role: 'user'  };

/* ---------------------------------------------------------------------------
   UTILITIES
   --------------------------------------------------------------------------- */
const LS = {
  get: (k, d) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};

const toArray = (v) => Array.isArray(v)
  ? v
  : (typeof v === 'string' && v.trim() ? v.split(',').map(s => s.trim()).filter(Boolean) : []);

const copyText = (text, cb) => {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.cssText = 'position:fixed;left:-9999px';
  document.body.appendChild(ta);
  ta.focus(); ta.select();
  try { document.execCommand('copy'); cb && cb(); } catch {}
  document.body.removeChild(ta);
};

const getSlotStatus = (slotsJson) => {
  try {
    const parsed = JSON.parse(slotsJson || '[]');
    if (!parsed.length) return { showAskStaff: false, remaining: 0, total: 0, parsed: [] };
    const remaining = parsed.length - parsed.filter(s => s.username).length;
    return { showAskStaff: remaining <= 2 && remaining > 0, remaining, total: parsed.length, parsed };
  } catch {
    return { showAskStaff: false, remaining: 0, total: 0, parsed: [] };
  }
};

const getIdVal = (id) => parseInt(String(id).replace(/\D/g, '') || '0', 10);

const getSortKey = (item) => {
  if (item._createdAt) {
    const t = new Date(item._createdAt).getTime();
    if (!isNaN(t)) return t;
  }
  return getIdVal(item._id);
};

const getNatureColor = (n) => ({
  Fire:      'bg-orange-100 text-orange-800 border-orange-200',
  Water:     'bg-blue-100 text-blue-800 border-blue-200',
  Lightning: 'bg-yellow-100 text-yellow-800 border-yellow-300',
  Earth:     'bg-red-100 text-red-800 border-red-300',
  Wind:      'bg-green-100 text-green-800 border-green-200',
  Yang:      'bg-amber-100 text-amber-900 border-amber-300',
  Yin:       'bg-purple-100 text-purple-900 border-purple-300',
  Sound:     'bg-pink-100 text-pink-800 border-pink-200',
}[n] || 'bg-slate-200 text-slate-800 border-slate-300');

/* ---------------------------------------------------------------------------
   DISCORD WEBHOOK LOGGING
   Routes an approval/denial event to the correct Discord Forum thread and
   formats it to match the staff log embed design. Battlemode entries land in
   their own thread; everything else goes to the general jutsu thread.

   The submitter / reviewer pair encodes the workflow:
     • staff queue (double-approver)  → submitter !== reviewer
     • admin direct write (single)    → submitter === reviewer (same user id)
   --------------------------------------------------------------------------- */
async function sendDiscordLog(itemData, actionType, submitterProfile, firstReviewerProfile, finalApproverProfile) {
  const baseUrl = import.meta.env.VITE_DISCORD_LOG_WEBHOOK_URL;
  if (!baseUrl) return; // Logging not configured — skip silently.

  // Route to the correct forum thread based on the jutsu's type.
  const threadId = toArray(itemData?.types).includes('Battlemode')
    ? import.meta.env.VITE_DISCORD_BATTLEMODE_THREAD_ID
    : import.meta.env.VITE_DISCORD_JUTSU_THREAD_ID;

  const webhookUrl = threadId ? `${baseUrl}?thread_id=${threadId}` : baseUrl;

  // Format a profile into a Discord mention, falling back to plain @username.
  const ping = (profile) => {
    if (!profile) return 'Unknown';
    if (profile.discord_id) return `<@${profile.discord_id}>`;
    return `@${profile.username || 'unknown'}`;
  };

  // Determine pings
  const creatorPing = ping(submitterProfile);
  const reviewerPing = (submitterProfile?.role === 'user') ? ping(firstReviewerProfile) : ping(submitterProfile);
  const secondEyes = ping(finalApproverProfile);

  // Decision + colour: green for approvals/creates, red for denials/deletes.
  const isNegative = /den|reject|delet|cancel/i.test(actionType || '');
  const decision = isNegative ? 'Denied' : 'Approved';
  const color = isNegative ? 15158332 : 3066993;

  // Extract other field values
  const natureVal = itemData?.nature || 'N/A';
  const rankVal = Array.isArray(itemData?.rank) ? itemData.rank.join(', ') : (itemData?.rank || 'N/A');
  const typeVal = Array.isArray(itemData?.types) ? itemData.types.join(', ') : (itemData?.types || 'N/A');
  const specVal = Array.isArray(itemData?.spec) ? itemData.spec.join(', ') : (itemData?.spec || 'N/A');
  const bloodlineVal = itemData?.bloodline || 'N/A';
  const linkVal = itemData?.link || 'N/A';

  const creationDate = itemData?._createdAt ? new Date(itemData._createdAt).toLocaleString() : 'N/A';
  const approvalDate = new Date().toLocaleString();

  const description = [
    `**Name Entry Creator:** ${creatorPing}`,
    `**Name Reviewer:** ${reviewerPing}`,
    `**Name 2nd pair of eyes reviewer:** ${secondEyes}`,
    '',
    `**Decision:** ${decision}`,
    '',
    '**Entry Details:**',
    `Nature: ${natureVal}`,
    `Rank: ${rankVal}`,
    `Type: ${typeVal}`,
    `Spec: ${specVal}`,
    `Bloodline: ${bloodlineVal}`,
    '',
    '**Link to sheet:**',
    `${linkVal}`,
    '',
    '**Dates:**',
    `Creation Date: ${creationDate}`,
    `Approval Date: ${approvalDate}`
  ].join('\n');

  const payload = {
    embeds: [{
      title: itemData?.name || 'Jutsu Entry',
      description,
      color,
    }],
  };

  try {
    await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    // Never let a logging failure block the underlying database action.
    console.warn('[NARP] Discord log failed:', err);
  }
}

/* ---------------------------------------------------------------------------
   ICONS
   --------------------------------------------------------------------------- */
const ICONS = {
  Search:   <><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></>,
  ExtLink:  <><path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/></>,
  Copy:     <><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></>,
  Check:    <path d="M20 6 9 17l-5-5"/>,
  Filter:   <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/>,
  Sort:     <><path d="M4 6h9M4 12h9M4 18h9M15 15l3 3 3-3M18 18V6"/></>,
  Down:     <path d="m6 9 6 6 6-6"/>,
  Up:       <path d="m18 15-6-6-6 6"/>,
  Tag:      <><path d="M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42l-8.704-8.704z"/><circle cx="7.5" cy="7.5" r=".5" fill="currentColor"/></>,
  Book:     <><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></>,
  Alert:    <><circle cx="12" cy="12" r="10"/><line x1="12" x2="12" y1="8" y2="12"/><line x1="12" x2="12.01" y1="16" y2="16"/></>,
  Shield:   <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10"/>,
  Key:      <><circle cx="7.5" cy="15.5" r="5.5"/><path d="m21 2-9.6 9.6"/><path d="m15.5 7.5 3 3L22 7l-3-3"/></>,
  CheckCir: <><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></>,
  Refresh:  <><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></>,
  PlusCir:  <><circle cx="12" cy="12" r="10"/><line x1="12" x2="12" y1="8" y2="16"/><line x1="8" x2="16" y1="12" y2="12"/></>,
  Edit:     <><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></>,
  Trash:    <><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" x2="10" y1="11" y2="17"/><line x1="14" x2="14" y1="11" y2="17"/></>,
  Save:     <><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></>,
  Info:     <><circle cx="12" cy="12" r="10"/><line x1="12" x2="12" y1="16" y2="12"/><line x1="12" x2="12.01" y1="8" y2="8"/></>,
  Clock:    <><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></>,
  Eye:      <><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/></>,
  Plus:     <><line x1="12" x2="12" y1="5" y2="19"/><line x1="5" x2="19" y1="12" y2="12"/></>,
  X:        <><line x1="18" x2="6" y1="6" y2="18"/><line x1="6" x2="18" y1="6" y2="18"/></>,
  Grid:     <><rect width="7" height="7" x="3" y="3" rx="1"/><rect width="7" height="7" x="14" y="3" rx="1"/><rect width="7" height="7" x="14" y="14" rx="1"/><rect width="7" height="7" x="3" y="14" rx="1"/></>,
  List:     <><rect width="7" height="7" x="3" y="3" rx="1"/><rect width="7" height="7" x="3" y="14" rx="1"/><path d="M14 4h7"/><path d="M14 9h7"/><path d="M14 15h7"/><path d="M14 20h7"/></>,
  Download: <><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/></>,
  Lock:     <><rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></>,
  Settings: <><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></>,
  User:     <><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></>,
};

const Icon = ({ n, size = 24, className = '' }) => (
  <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor"
       strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
    {ICONS[n]}
  </svg>
);

/* ---------------------------------------------------------------------------
   UNIVERSAL RANK PROFILE LOGO
   --------------------------------------------------------------------------- */
function RankLogo({ role, className = "w-10 h-10 rounded-lg" }) {
  const cleanRole = ['owner', 'admin', 'staff', 'user'].includes(role) ? role : 'user';

  const config = {
    owner: {
      gradient: "from-amber-400 to-amber-600 text-amber-50 shadow-amber-500/20",
      svg: (
        <svg viewBox="0 0 24 24" fill="currentColor" className="w-1/2 h-1/2">
          {/* Elegant Crown */}
          <path d="M5 16h14a1 1 0 0 0 1-1V7.5a.5.5 0 0 0-.85-.35L15 11l-3-4.5L9 11 4.85 7.15a.5.5 0 0 0-.85.35V15a1 1 0 0 0 1 1zM12 4a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3zM4 6.5a1.25 1.25 0 1 0 0-2.5 1.25 1.25 0 0 0 0 2.5zm16 0a1.25 1.25 0 1 0 0-2.5 1.25 1.25 0 0 0 0 2.5z" />
        </svg>
      )
    },
    admin: {
      gradient: "from-indigo-400 to-indigo-600 text-indigo-50 shadow-indigo-500/20",
      svg: (
        <svg viewBox="0 0 24 24" fill="currentColor" className="w-1/2 h-1/2">
          {/* Sleek Shield */}
          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
          <path d="M12 4.2v15.3c5.5-3.1 6.5-7.3 6.5-8.5V6.3l-6.5-2.1z" opacity="0.15" />
        </svg>
      )
    },
    staff: {
      gradient: "from-emerald-400 to-emerald-600 text-emerald-50 shadow-emerald-500/20",
      svg: (
        <svg viewBox="0 0 24 24" fill="currentColor" className="w-1/2 h-1/2">
          {/* Star Badge */}
          <path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z" />
        </svg>
      )
    },
    user: {
      gradient: "from-slate-400 to-slate-600 text-slate-50 shadow-slate-500/10",
      svg: (
        <svg viewBox="0 0 24 24" fill="currentColor" className="w-1/2 h-1/2">
          {/* User Silhouette */}
          <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z" />
        </svg>
      )
    }
  };

  const current = config[cleanRole];

  return (
    <div className={`bg-gradient-to-tr ${current.gradient} flex items-center justify-center shadow ${className} shrink-0`}>
      {current.svg}
    </div>
  );
}

/* ---------------------------------------------------------------------------
   SEED DATA
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

const STATIC_SEED = {
  jutsus:          multiplyData(baseJutsus, 'j', 8),
  bloodlines:      multiplyData(baseBloodlines, 'bl', 8),
  specializations: SPECIALIZATION_OPTIONS,
};

/* ---------------------------------------------------------------------------
   FORM SCHEMA
   --------------------------------------------------------------------------- */
const MANAGE_TABLES = {
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
      { k: 'conditions',  l: 'Conditions',      t: 'chip', opts: ['Locked', 'Limited'], multi: true, col: 1 },
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

const normalizeDB = (d) => ({
  jutsus: (d.jutsus || []).map((j, i) => {
    const rArr = toArray(j.rank);
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
        _id:         b._id || `b-${i}`,
        name:        b.name || '',
        category:    b.category    || 'Custom',
        subcategory: b.subcategory || 'Other',
        custom_tags: toArray(b.custom_tags),
        link:        b.link || b.doc_link || '',
        _createdAt:  b._createdAt || b.created_at || null,
      }))
    : STATIC_SEED.bloodlines,

  specializations: Array.isArray(d.specializations) ? d.specializations : STATIC_SEED.specializations,
});

const loadDB = async () => {
  try {
    if (isSupabaseConfigured()) {
      try {
        const remote = await fetchAllFromSupabase();
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
    if (cached?.jutsus && Array.isArray(cached.jutsus) && cached.jutsus.length) {
      try {
        return normalizeDB(cached);
      } catch (cachedErr) {
        console.warn('[NARP] Cached DB normalization failed; falling back to static seed.', cachedErr);
      }
    }
  } catch (globalErr) {
    console.warn('[NARP] Unexpected error in loadDB, falling back to static seed.', globalErr);
  }
  LS.set(STORAGE.CACHE, { ...STATIC_SEED, ts: Date.now() });
  return normalizeDB(STATIC_SEED);
};

/* ============================================================================
   COMPONENT: BloodlineDropdown
   ============================================================================ */
function BloodlineDropdown({ l, sel, onChange, placeholder, bloodlinesDb, isOpen, onToggle, isMulti = true }) {
  const [fCat, setFCat] = useState('All');
  const [fSub, setFSub] = useState('All');
  const [str,  setStr]  = useState('');

  const filtered = (bloodlinesDb || []).filter(b =>
    (fCat === 'All' || b.category === fCat) &&
    (fSub === 'All' || b.subcategory === fSub) &&
    (!str || b.name.toLowerCase().includes(str.toLowerCase()))
  );

  const toggle = (name) => {
    if (isMulti) {
      onChange(sel.includes(name) ? sel.filter(x => x !== name) : [...sel, name]);
    } else {
      onChange(sel === name ? '' : name);
      onToggle();
    }
  };

  const selectAllVisible = () => {
    if (!isMulti) return;
    const visibleNames = filtered.map(b => b.name);
    const next = Array.from(new Set([...sel, ...visibleNames]));
    onChange(next);
  };

  const count = isMulti ? sel.length : (sel ? 1 : 0);
  const buttonLabel = !count
    ? placeholder
    : count === 1 ? (isMulti ? sel[0] : sel) : `${count} selected`;

  return (
    <div className="relative flex flex-col w-full">
      {l && <label className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-2">{l}</label>}

      <button type="button" onClick={onToggle}
              className="w-full text-sm bg-white border border-slate-200 rounded-xl p-3.5 text-left flex items-center justify-between shadow-sm hover:border-indigo-400">
        <span className={count ? (isMulti ? 'text-indigo-700' : 'text-slate-800') + ' font-bold' : 'text-slate-500'}>
          {buttonLabel}
        </span>
        <Icon n="Down" size={16} className={`text-slate-400 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {isOpen && (
        <div className="mt-2 w-full bg-white border border-slate-200 rounded-xl shadow-xl max-h-96 flex flex-col absolute z-40 top-full">
          <div className="p-3 border-b border-slate-100 bg-slate-50 flex flex-col gap-3 shrink-0">
            <div className="flex flex-wrap gap-1.5">
              {['All', ...BL_CATS].map(c => (
                <button key={c} type="button" onClick={() => setFCat(c)}
                        className={`text-xs px-2.5 py-1 rounded-md font-bold transition-colors ${fCat === c ? 'bg-indigo-600 text-white' : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-100'}`}>
                  {c}
                </button>
              ))}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {['All', ...BL_SUBCATS].map(s => (
                <button key={s} type="button" onClick={() => setFSub(s)}
                        className={`text-xs px-2.5 py-1 rounded-md font-bold transition-colors ${fSub === s ? 'bg-purple-600 text-white' : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-100'}`}>
                  {s}
                </button>
              ))}
            </div>
            <div className="relative mt-1">
              <Icon n="Search" size={14} className="absolute left-3 top-2.5 text-slate-400"/>
              <input type="text" placeholder="Search..." value={str} onChange={e => setStr(e.target.value)}
                     className="w-full bg-white border border-slate-200 rounded-lg py-2 pl-9 pr-3 text-sm outline-none focus:ring-1 focus:ring-indigo-500" />
            </div>
            {isMulti && filtered.length > 0 && (fCat !== 'All' || fSub !== 'All' || str) && (
              <button type="button" onClick={selectAllVisible}
                      className="text-[11px] font-bold text-indigo-600 bg-indigo-50 hover:bg-indigo-100 py-1.5 rounded-md">
                Select all {filtered.length} visible
              </button>
            )}
          </div>

          <div className="overflow-y-auto p-2 flex flex-col gap-1 flex-1 custom-scrollbar">
            {filtered.length === 0 ? (
              <div className="p-4 text-center text-sm text-slate-400 font-medium">No matches found</div>
            ) : filtered.map(b => {
              const isSel = isMulti ? sel.includes(b.name) : sel === b.name;
              return (
                <label key={b._id}
                       className={`flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer transition-colors ${isSel ? 'bg-indigo-50' : 'hover:bg-slate-50'}`}>
                  {isMulti && (
                    <div className={`w-5 h-5 rounded flex items-center justify-center border transition-colors ${isSel ? 'bg-indigo-600 border-indigo-600 text-white' : 'bg-white border-slate-300 text-transparent'}`}>
                      <Icon n="Check" size={14}/>
                    </div>
                  )}
                  <input type="checkbox" checked={isSel} onChange={() => toggle(b.name)} className="hidden" />
                  <div className="flex flex-col">
                    <span className={`text-sm ${isSel ? 'font-bold text-indigo-900' : 'font-medium text-slate-700'}`}>{b.name}</span>
                    <span className="text-[10px] text-slate-400 font-semibold">{b.category} • {b.subcategory}</span>
                  </div>
                </label>
              );
            })}
          </div>

          {isMulti && sel.length > 0 && (
            <div className="border-t border-slate-100 p-2 shrink-0 bg-slate-50">
              <button type="button" onClick={() => onChange([])}
                      className="w-full text-xs font-bold text-red-600 bg-red-50 hover:bg-red-100 py-2 rounded-lg transition-colors">
                Clear Selection ({sel.length})
              </button>
            </div>
          )}
          {!isMulti && sel && (
            <div className="border-t border-slate-100 p-2 shrink-0 bg-slate-50">
              <button type="button" onClick={() => { onChange(''); onToggle(); }}
                      className="w-full text-xs font-bold text-red-600 bg-red-50 hover:bg-red-100 py-2 rounded-lg transition-colors">
                Clear
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ============================================================================
   COMPONENT: GenericDropdown
   ============================================================================ */
function GenericDropdown({ l, opts, sel, onChange, placeholder, isOpen, onToggle }) {
  const [str, setStr] = useState('');
  const arr = sel || [];
  const filtered = str ? opts.filter(o => (o.label || o).toLowerCase().includes(str.toLowerCase())) : opts;
  const toggle = (v) => onChange(arr.includes(v) ? arr.filter(x => x !== v) : [...arr, v]);

  return (
    <div className="relative flex flex-col w-full">
      {l && <label className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-2">{l}</label>}

      <button type="button" onClick={onToggle}
              className="w-full text-sm bg-white border border-slate-200 rounded-xl p-3.5 text-left flex items-center justify-between shadow-sm hover:border-indigo-400">
        <span className={arr.length ? 'text-indigo-700 font-bold' : 'text-slate-500'}>
          {!arr.length ? placeholder : arr.length === 1 ? (arr[0].label || arr[0]) : `${arr.length} selected`}
        </span>
        <Icon n="Down" size={16} className={`text-slate-400 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {isOpen && (
        <div className="mt-2 w-full bg-white border border-slate-200 rounded-xl shadow-xl max-h-72 flex flex-col absolute z-30 top-full">
          <div className="p-3 border-b border-slate-100 bg-slate-50 shrink-0 relative">
            <Icon n="Search" size={14} className="absolute left-6 top-6 text-slate-400"/>
            <input type="text" placeholder="Search..." value={str} onChange={e => setStr(e.target.value)}
                   className="w-full bg-white border border-slate-200 rounded-lg py-2 pl-9 pr-3 text-sm" />
          </div>
          <div className="overflow-y-auto p-2 flex flex-col gap-1 flex-1 custom-scrollbar">
            {filtered.map(o => {
              const value = o.value || o, label = o.label || o, isSel = arr.includes(value);
              return (
                <label key={value}
                       className={`flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer transition-colors ${isSel ? 'bg-indigo-50' : 'hover:bg-slate-50'}`}>
                  <div className={`w-5 h-5 rounded flex items-center justify-center border transition-colors ${isSel ? 'bg-indigo-600 border-indigo-600 text-white' : 'bg-white border-slate-300 text-transparent'}`}>
                    <Icon n="Check" size={14}/>
                  </div>
                  <input type="checkbox" checked={isSel} onChange={() => toggle(value)} className="hidden" />
                  <span className="text-sm font-medium text-slate-600">{label}</span>
                </label>
              );
            })}
          </div>
          {arr.length > 0 && (
            <div className="border-t border-slate-100 p-2 shrink-0 bg-slate-50">
              <button type="button" onClick={() => onChange([])}
                      className="w-full text-xs font-bold text-red-600 bg-red-50 hover:bg-red-100 py-2 rounded-lg">
                Clear Selection ({arr.length})
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ============================================================================
   COMPONENT: SlotsEditor
   ============================================================================ */
function SlotsEditor({ value, onChange, defCount = 1 }) {
  const parsed = (() => { try { return JSON.parse(value || '[]'); } catch { return []; } })();
  const arr = parsed.length ? parsed : Array(defCount).fill({ username: '', discord_link: '' });

  const updateSlot = (i, field, v) => {
    const next = [...arr];
    next[i] = { ...next[i], [field]: v };
    onChange(JSON.stringify(next));
  };

  const addSlot    = () => onChange(JSON.stringify([...arr, { username: '', discord_link: '' }]));
  const removeSlot = (i) => onChange(JSON.stringify(arr.filter((_, idx) => idx !== i)));

  return (
    <div className="space-y-2">
      <div className="flex justify-between items-center mb-1">
        <span className="text-xs font-semibold text-slate-500">
          {arr.filter(x => x.username).length}/{arr.length} slots filled
        </span>
        <button type="button" onClick={addSlot}
                className="text-xs bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded font-bold">
          + Add Slot
        </button>
      </div>
      {arr.map((slot, i) => (
        <div key={i} className="flex flex-col sm:flex-row gap-2 bg-slate-50 p-2 rounded-lg border border-slate-100 items-center">
          <span className="text-xs font-bold text-slate-400 w-6 text-center">#{i + 1}</span>
          <input type="text" value={slot.username || ''}     onChange={e => updateSlot(i, 'username',     e.target.value)} placeholder="Character name" className="flex-1 w-full text-xs p-1.5 border rounded" />
          <input type="text" value={slot.discord_link || ''} onChange={e => updateSlot(i, 'discord_link', e.target.value)} placeholder="Character thread link"  className="flex-1 w-full text-xs p-1.5 border rounded" />
          {arr.length > 1 && (
            <button type="button" onClick={() => removeSlot(i)} className="text-red-400 font-bold px-2 hover:text-red-600">x</button>
          )}
        </div>
      ))}
    </div>
  );
}

/* ============================================================================
   COMPONENT: JutsuCard
   UPDATED: Clean layout, proper rounded corners, inset rank/cost box.
   ============================================================================ */
function JutsuCard({ j, viewMode, expRow, setExpRow, pTags, setPersonalTagsForJutsu, handleCopy, cart, copiedId, isAdmin, onEdit, onDelete, onViewSlots }) {
  const isExpanded = viewMode === 'card' || expRow === j._id;
  const rArr  = toArray(j.rank);
  const tArr  = toArray(j.types);
  const cTags = toArray(j.custom_tags);
  const isBm  = tArr.includes('Battlemode');
  const { showAskStaff, remaining } = getSlotStatus(j.slots);
  const myTags = pTags[j._id] || [];
  const inList = cart.some(x => x._id === j._id);

  const [tagging, setTagging]   = useState(false);
  const [tagInput, setTagInput] = useState('');

  const topTags = [
    ...toArray(j.nature).filter(n => n && n !== 'N/A').map(n => ({ l: n, c: getNatureColor(n) })),
    j.origin                       && { l: j.origin, c: j.origin === 'Canon' ? 'bg-indigo-50 text-indigo-700 border-indigo-200' : 'bg-cyan-50 text-cyan-700 border-cyan-200' },
    j.locked                       && { l: 'Locked',   ic: 'Lock',  c: 'bg-amber-50 text-amber-700 border-amber-300' },
    j.limited &&  showAskStaff     && { l: 'Ask Reviewer',          c: 'bg-amber-100 text-amber-800 border-amber-300' },
    j.limited && !showAskStaff     && { l: 'Limited',  ic: 'Alert', c: 'bg-rose-100 text-rose-800 border-rose-200' },
    j.limited && j.slots           && { l: remaining > 0 ? `${remaining} open` : 'Full',
                                        c: remaining > 0 ? 'bg-emerald-100 text-emerald-800 border-emerald-200' : 'bg-red-100 text-red-800 border-red-200' },
  ].filter(Boolean);

  /* ---- Collapsed row ---- */
  if (!isExpanded) {
    const firstNat = toArray(j.nature)[0];
    return (
      <div onClick={() => setExpRow(j._id)}
           className={`bg-white rounded-xl shadow-sm border px-4 py-3 flex items-center justify-between cursor-pointer hover:bg-slate-50 transition-all ${j.locked ? 'border-amber-300' : 'border-slate-200'} relative group`}>
        <div className="flex items-center gap-4 flex-1 overflow-hidden pr-20">
          <span className={`w-3 h-3 rounded-full shrink-0 ${firstNat && firstNat !== 'N/A' ? getNatureColor(firstNat).split(' ')[0].replace('100', '400') : 'bg-slate-200'}`} />
          <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-3 flex-1 overflow-hidden">
            <h3 className="font-bold text-slate-800 text-sm truncate flex items-center gap-2">
              {j.locked && <Icon n="Lock" size={12} className="text-amber-500 shrink-0" />}{j.name}
            </h3>
            <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-400 shrink-0">
              {isBm && j.bm_tier ? (
                <span className="px-1.5 py-0.5 rounded-md bg-slate-100 border border-slate-200 text-slate-600">
                  {`${j.bm_tier} (${rArr[0] || '-'})`}
                </span>
              ) : (
                <div className="flex gap-0.5">
                  {rArr.length > 0
                    ? rArr.map((r, i) => <span key={i} className="px-1.5 py-0.5 rounded bg-slate-100 border border-slate-200 text-slate-600">{r}</span>)
                    : <span className="px-1.5 py-0.5 rounded bg-slate-100 border border-slate-200 text-slate-600">-</span>}
                </div>
              )}
              {tArr[0] && <span className="hidden sm:inline px-1.5 py-0.5 rounded-md bg-transparent">{tArr[0]}</span>}
            </div>
          </div>
        </div>
        <div className="flex items-center shrink-0 pl-4">
          {j.limited && showAskStaff
            ? <span className="text-[10px] font-bold uppercase text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded border border-amber-200 hidden sm:inline mr-3">Ask Reviewer</span>
            : (j.limited && <span className="text-[10px] font-bold uppercase text-red-500 bg-red-50 px-1.5 py-0.5 rounded hidden sm:inline mr-3">Limited</span>)}
          <Icon n="Down" size={18} className="text-slate-300"/>
        </div>
        {isAdmin && (
          <div className="absolute right-12 top-1/2 -translate-y-1/2 flex gap-1 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity bg-white p-1 rounded-lg border shadow-sm shrink-0">
            <button onClick={(e) => { e.stopPropagation(); onEdit(); }}   className="p-1 text-indigo-600 hover:bg-indigo-50 rounded"><Icon n="Edit"  size={14}/></button>
            <button onClick={(e) => { e.stopPropagation(); onDelete(); }} className="p-1 text-red-600    hover:bg-red-50    rounded"><Icon n="Trash" size={14}/></button>
          </div>
        )}
      </div>
    );
  }

  /* ---- Expanded card ---- */
  return (
    <div className={`bg-white rounded-2xl shadow-sm border ${j.locked ? 'border-amber-300 shadow-amber-500/10' : 'border-slate-200'} flex flex-col relative overflow-hidden transition-all hover:shadow-md h-full`}>
      {/* Top absolute controls */}
      {viewMode === 'row' && (
        <button onClick={(e) => { e.stopPropagation(); setExpRow(null); }}
                className="absolute top-4 right-4 text-slate-400 hover:text-slate-700 bg-slate-100 p-1.5 rounded-full z-10">
          <Icon n="Up" size={16} />
        </button>
      )}
      {isAdmin && (
        <div className={`absolute top-4 ${viewMode === 'row' ? 'right-14' : 'right-4'} flex gap-1 bg-white p-1 rounded-lg border shadow-sm z-10`}>
          <button onClick={(e) => { e.stopPropagation(); onEdit(); }}   className="p-1.5 text-indigo-600 hover:bg-indigo-50 rounded-md"><Icon n="Edit"  size={14}/></button>
          <button onClick={(e) => { e.stopPropagation(); onDelete(); }} className="p-1.5 text-red-600    hover:bg-red-50    rounded-md"><Icon n="Trash" size={14}/></button>
        </div>
      )}

      {/* Main Content Area */}
      <div className="p-5 flex-1 flex flex-col">
        {/* Title */}
        <h2 className="text-xl font-extrabold text-slate-900 leading-tight mb-3 pr-24 tracking-tight">{j.name}</h2>

        {/* Top Badges (Nature, Origin, Locked) */}
        <div className="flex flex-wrap gap-2 mb-4">
          {topTags.map((t, i) => (
            <span key={i} className={`px-2 py-1 rounded-md text-[10px] font-extrabold uppercase tracking-wide border flex items-center gap-1.5 ${t.c}`}>
              {t.ic && <Icon n={t.ic} size={11}/>} {t.l}
            </span>
          ))}
        </div>

        {/* Specs, Types, Bloodlines, Personal Tags */}
        <div className="flex flex-wrap gap-1.5 mb-5 items-center">
          {[...toArray(j.spec), ...tArr, ...cTags].map((s, i) => (
            <span key={i} className="text-xs font-semibold text-slate-600 bg-slate-50 px-2.5 py-1 rounded-md border border-slate-200">
              {s}
            </span>
          ))}
          {j.bloodline && (
            <span className="text-xs font-bold text-purple-700 bg-purple-50 px-2.5 py-1 rounded-md border border-purple-200 flex items-center gap-1.5 shadow-sm">
              <Icon n="Tag" size={12}/> {j.bloodline}
            </span>
          )}
          {myTags.map(t => (
            <span key={t} className="group text-xs font-bold text-indigo-700 bg-indigo-50 px-2.5 py-1 rounded-md border border-indigo-200 flex items-center gap-1.5 shadow-sm">
              {t}
              <button onClick={() => setPersonalTagsForJutsu(j._id, myTags.filter(x => x !== t))}
                      className="opacity-40 hover:text-red-600 hover:opacity-100 transition-opacity">×</button>
            </span>
          ))}
          
          {/* Tag Add Button */}
          {tagging ? (
            <form onSubmit={(e) => {
              e.preventDefault();
              const v = tagInput.trim();
              if (v && !myTags.includes(v)) setPersonalTagsForJutsu(j._id, [...myTags, v]);
              setTagging(false); setTagInput('');
            }} className="inline-block">
              <input autoFocus value={tagInput} onChange={e => setTagInput(e.target.value)}
                     onBlur={() => { setTagging(false); setTagInput(''); }}
                     onKeyDown={e => { if (e.key === 'Escape') { setTagging(false); setTagInput(''); } }}
                     className="text-xs px-2 py-0.5 border-2 border-indigo-300 rounded-md outline-none w-24 bg-white shadow-sm"
                     placeholder="Type & Enter" />
            </form>
          ) : (
            <button onClick={(e) => { e.stopPropagation(); setTagging(true); }}
                    className="text-xs font-semibold text-indigo-500 hover:bg-indigo-50 border border-dashed border-indigo-200 px-2.5 py-1 rounded-md flex items-center gap-1 transition-colors">
              <Icon n="Plus" size={11}/> Tag
            </button>
          )}
        </div>

        {/* Pushes footer to the bottom */}
        <div className="mt-auto flex flex-col gap-4">
          
          {/* INSET BOX: Rank / Cost */}
          <div className="bg-slate-50/70 border border-slate-100 rounded-xl p-3.5 flex flex-wrap items-center justify-between gap-4">
            
            <div className="flex items-center gap-5 flex-wrap">
              {/* Rank Block */}
              <div>
                <div className="text-[9px] font-bold text-slate-400 uppercase tracking-widest mb-1.5">Rank</div>
                {isBm && j.bm_tier ? (
                  <div className="text-[13px] font-black text-slate-700">{`${j.bm_tier} (${rArr[0] || '-'})`}</div>
                ) : (
                  <div className="flex items-center gap-1.5 flex-wrap">
                    {rArr.length > 0
                      ? rArr.map((r, i) => <span key={i} className="px-2 py-0.5 bg-slate-200 text-slate-700 rounded-md text-xs font-black border border-slate-300 shadow-sm">{r}</span>)
                      : <span className="text-sm font-black text-slate-700">-</span>}
                  </div>
                )}
              </div>

              {/* Separator */}
              {!isBm && <div className="hidden sm:block w-px h-8 bg-slate-200 rounded-full" />}

              {/* Cost Block */}
              {!isBm && (
                <div>
                  <span className="text-[9px] font-bold text-slate-400 uppercase tracking-widest mb-1.5 block">Cost</span>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    {j.cost ? (
                      <span className="px-2 py-0.5 bg-indigo-50 border border-indigo-100 text-indigo-600 rounded-md text-xs font-black shadow-sm">{j.cost}</span>
                    ) : rArr.length > 0 ? (
                      rArr.map((r, i) => (
                        <span key={i} className="px-2 py-0.5 bg-indigo-50 border border-indigo-100 text-indigo-600 rounded-md text-xs font-black shadow-sm">
                          {RANK_COST_MAP[r] || '-'}
                        </span>
                      ))
                    ) : <span className="text-sm font-black text-indigo-600">-</span>}
                  </div>
                </div>
              )}
            </div>

            {/* Multi-Rank Badge */}
            {j.multiRank && !isBm && (
              <span className="text-[10px] font-extrabold text-indigo-500 border border-indigo-200 bg-white px-2 py-1 rounded-full uppercase tracking-wider shadow-sm ml-auto">Multi-Rank</span>
            )}
          </div>

          {/* Action Buttons (Footer) */}
          <div className="flex gap-2">
            {j.link && j.link !== '#' ? (
              <a href={j.link} target="_blank" rel="noopener noreferrer"
                 className="flex-1 bg-white border border-slate-200 text-indigo-700 hover:text-indigo-800 hover:border-indigo-300 hover:bg-indigo-50 font-bold py-2.5 rounded-xl flex justify-center items-center gap-2 transition-colors shadow-sm">
                <Icon n="ExtLink" size={16}/> Doc
              </a>
            ) : (
              <span className="flex-1 bg-slate-50 text-slate-400 font-bold py-2.5 rounded-xl flex justify-center text-sm border border-slate-100">No Doc</span>
            )}
            
            {j.limited && (
              <button onClick={(e) => { e.stopPropagation(); onViewSlots && onViewSlots(j); }}
                      className="p-2.5 rounded-xl border bg-white border-slate-200 text-slate-600 hover:bg-indigo-50 hover:text-indigo-700 hover:border-indigo-200 flex items-center justify-center min-w-[50px] transition-colors shadow-sm"
                      title="View slot holders">
                <Icon n="Eye" size={18}/>
              </button>
            )}
            
            <button onClick={(e) => { e.stopPropagation(); handleCopy(j); }}
                    className={`p-2.5 rounded-xl border flex items-center justify-center min-w-[50px] transition-colors shadow-sm ${
                      copiedId === j._id ? 'bg-emerald-500 border-emerald-500 text-white'
                      : inList ? 'bg-indigo-50 border-indigo-200 text-indigo-700 hover:bg-indigo-100'
                      : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50 hover:border-slate-300'
                    }`}
                    title={inList ? 'In Session List' : 'Add to Session List'}>
              {copiedId === j._id ? <Icon n="Check" size={18}/> : inList ? <Icon n="CheckCir" size={18}/> : <Icon n="Copy" size={18}/>}
            </button>
          </div>
          
        </div>
      </div>
    </div>
  );
}

/* ============================================================================
   SESSION LIST FORMATTING
   ============================================================================ */
const RANK_ORDER_NUM = { E: 1, D: 2, C: 3, B: 4, A: 5, S: 6 };

const groupForJutsu = (j) => {
  if (toArray(j.types).includes('Battlemode')) return { type: 'battlemode', name: 'Battlemode' };
  if (j.bloodline)                               return { type: 'bloodline',  name: j.bloodline };
  const firstNature = toArray(j.nature)[0];
  if (firstNature && firstNature !== 'N/A')     return { type: 'nature',     name: firstNature };
  return { type: 'other', name: 'Other' };
};

const compareForList = (a, b) => {
  if (!!a.multiRank !== !!b.multiRank) return a.multiRank ? -1 : 1;
  const lowestRank = (j) => {
    const rArr = toArray(j.rank);
    return rArr.length ? Math.min(...rArr.map(r => RANK_ORDER_NUM[r] || 99)) : 99;
  };
  const diff = lowestRank(a) - lowestRank(b);
  return diff !== 0 ? diff : a.name.localeCompare(b.name);
};

const formatSessionList = (items) => {
  if (!items.length) return '';

  const groups = new Map();
  for (const j of items) {
    const g = groupForJutsu(j);
    if (!groups.has(g.name)) groups.set(g.name, { type: g.type, items: [] });
    groups.get(g.name).items.push(j);
  }
  for (const grp of groups.values()) grp.items.sort(compareForList);

  const ordered = [];
  NATURES.forEach(n => {
    if (groups.has(n) && groups.get(n).type === 'nature') ordered.push(n);
  });
  for (const [name, grp] of groups) {
    if (grp.type === 'nature' && !ordered.includes(name)) ordered.push(name);
  }
  [...groups.entries()]
    .filter(([, g]) => g.type === 'bloodline')
    .map(([n]) => n)
    .sort()
    .forEach(n => ordered.push(n));
  if (groups.has('Other'))      ordered.push('Other');
  if (groups.has('Battlemode')) ordered.push('Battlemode');

  const out = ['**My NARP List**'];
  ordered.forEach(name => {
    const grp = groups.get(name);
    const heading = grp.type === 'bloodline' ? `${name} (Bloodline)` : name;
    out.push('', `**${heading}**`);
    for (const j of grp.items) {
      const isBm  = toArray(j.types).includes('Battlemode');
      const ranks = toArray(j.rank);

      let rankStr;
      if (isBm) {
        rankStr = j.bm_tier
          ? `${j.bm_tier}${ranks[0] ? ` (${ranks[0]})` : ''}`
          : (ranks[0] || '-');
      } else {
        rankStr = ranks.length ? ranks.join('/') : '-';
      }

      const tags = [];
      if (j.multiRank && !isBm) tags.push('Multi-Rank');
      if (j.locked)             tags.push('Locked');
      if (j.limited)            tags.push('Limited');

      const display = j.link && j.link !== '#' ? `[${j.name}](${j.link})` : j.name;
      const tagPart = tags.length ? ` · ${tags.join(' · ')}` : '';
      out.push(`- ${display} — ${rankStr}${tagPart}`);
    }
  });

  return out.join('\n');
};

/* ============================================================================
   COMPONENT: SessionListCart
   ============================================================================ */
function SessionListCart({ list, onClear, onRemove }) {
  const [copied, setCopied]     = useState(false);
  const [expanded, setExpanded] = useState(false);

  if (list.length === 0) return null;

  const handleCopyAll = () => {
    copyText(formatSessionList(list), () => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 animate-in slide-in-from-bottom-5 fade-in duration-300 w-[95vw] max-w-xl">
      <div className="bg-slate-900 text-white rounded-2xl shadow-2xl shadow-slate-900/50 border border-slate-700 flex flex-col overflow-hidden w-full">
        {expanded && (
          <div className="p-2 max-h-48 overflow-y-auto border-b border-slate-800 bg-slate-800/50 text-sm custom-scrollbar">
            {list.map(j => (
              <div key={j._id} className="flex justify-between items-center py-2 px-3 border-b border-slate-800/50 last:border-0 group">
                <span className="truncate pr-2 font-medium text-slate-200 text-xs">{j.name}</span>
                <button onClick={() => onRemove(j._id)}
                        className="text-slate-500 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity"
                        title="Remove">
                  <Icon n="X" size={14} />
                </button>
              </div>
            ))}
          </div>
        )}
        <div className="flex items-center justify-between p-2 pl-4 flex-wrap gap-2">
          <button onClick={() => setExpanded(!expanded)}
                  className="flex items-center gap-2 text-sm font-bold text-slate-200 hover:text-white transition-colors py-1">
            <div className="relative">
              <Icon n="Book" size={16} className="text-indigo-400" />
              <span className="absolute -top-1 -right-1.5 w-3 h-3 bg-indigo-500 rounded-full text-[8px] flex items-center justify-center font-black">
                {list.length}
              </span>
            </div>
            <span className="hidden sm:inline">Session List</span>
            <Icon n={expanded ? 'Down' : 'Up'} size={14} className="text-slate-500" />
          </button>
          <div className="flex items-center gap-1.5 ml-auto">
            <button onClick={handleCopyAll}
                    className={`text-xs font-bold px-3 py-2 rounded-xl transition-colors flex items-center gap-1.5 ${copied ? 'bg-emerald-500 text-white' : 'bg-indigo-600 hover:bg-indigo-500 text-white'}`}>
              <Icon n={copied ? 'Check' : 'Copy'} size={14} />
              <span className="hidden sm:inline">{copied ? 'Copied' : 'Copy All'}</span>
            </button>
            <button onClick={onClear} className="p-2 text-slate-400 hover:text-red-400 hover:bg-slate-800 rounded-xl transition-colors" title="Clear list">
              <Icon n="Trash" size={16} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ============================================================================
   COMPONENT: FilterBar
   ============================================================================ */
const TOGGLE_PAIRS = [
  { showKey: 'lck', hideKey: 'hLck', label: 'Locked'     },
  { showKey: 'lim', hideKey: 'hLim', label: 'Limited'    },
  { showKey: 'mul', hideKey: 'hMul', label: 'Multi-Rank' },
];
const HIDE_ONLY = [
  { hideKey: 'hMP',  label: 'Multi-Post' },
  { hideKey: 'hAsk', label: 'Ask Reviewer'  },
];

function FilterBar({ tab, f, setF, activeFilterCount, bloodlinesDb, specOptions, clearF, isAdmin, onAdd }) {
  const [ddOpen, setDdOpen] = useState(null);
  const toggleArr = (key, value) =>
    setF(p => ({ ...p, [key]: p[key].includes(value) ? p[key].filter(x => x !== value) : [...p[key], value] }));

  const ActiveChip = ({ label, onRemove }) => (
    <span className="flex items-center gap-1.5 bg-slate-800 border border-slate-700 text-slate-200 text-[10px] font-bold px-2.5 py-1 rounded-lg shrink-0 shadow-sm">
      {label}
      <button onClick={onRemove} className="hover:text-red-400 ml-0.5"><Icon n="X" size={12} /></button>
    </span>
  );

  const ChipFilter = ({ title, values, fKey }) => (
    <div>
      <label className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-3 block">{title}</label>
      <div className="flex flex-wrap gap-2.5">
        {values.map(x => (
          <button key={x} onClick={() => toggleArr(fKey, x)}
                  className={`px-4 py-2 rounded-xl text-sm font-semibold transition-all border ${
                    f[fKey].includes(x)
                      ? (fKey === 'nat' ? getNatureColor(x) + ' ring-1 ring-offset-1 shadow-sm' : 'bg-indigo-100 border-indigo-300 text-indigo-800 shadow-sm')
                      : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                  }`}>
            {x}
          </button>
        ))}
      </div>
    </div>
  );

  const sortOpts = tab === 'jutsus'
    ? [{ v: 'newest', l: 'Newest First' }, { v: 'oldest', l: 'Oldest First' }, { v: 'az', l: 'Name (A-Z)' }, { v: 'za', l: 'Name (Z-A)' }, { v: 'rank_desc', l: 'Rank (High to Low)' }, { v: 'rank_asc', l: 'Rank (Low to High)' }]
    : [{ v: 'newest', l: 'Newest First' }, { v: 'oldest', l: 'Oldest First' }, { v: 'az', l: 'Name (A-Z)' }, { v: 'za', l: 'Name (Z-A)' }];

  return (
    <>
      <div className="bg-slate-900 text-white p-4 shadow-md z-30 shrink-0">
        <div className="max-w-6xl mx-auto flex flex-col gap-3">
          <div className="flex gap-2">
            <div className="relative flex-1 min-w-0">
              <Icon n="Search" size={18} className="absolute left-4 top-3 text-slate-400" />
              <input type="text" placeholder="Search..."
                     className="w-full bg-slate-800 border border-slate-700 text-white rounded-xl py-2.5 pl-12 pr-4 outline-none focus:ring-2 focus:ring-indigo-500 text-sm transition-shadow"
                     value={f.q} onChange={(e) => setF(p => ({ ...p, q: e.target.value }))} />
            </div>

            <div className="relative shrink-0">
              <button onClick={() => setDdOpen(ddOpen === 'sort' ? null : 'sort')}
                      className="px-4 py-2.5 rounded-xl text-sm font-bold flex items-center justify-center gap-2 bg-slate-800 border border-slate-700 text-slate-300 hover:bg-slate-700 transition-colors">
                <Icon n="Sort" size={16} /> <span className="hidden sm:inline">Sort</span>
              </button>
              {ddOpen === 'sort' && (
                <div className="absolute right-0 mt-2 w-48 bg-white rounded-xl shadow-xl border border-slate-200 py-1 z-50 overflow-hidden animate-in fade-in slide-in-from-top-2">
                  {sortOpts.map(o => (
                    <button key={o.v} onClick={() => { setF(p => ({ ...p, sort: o.v })); setDdOpen(null); }}
                            className={`w-full text-left px-4 py-2.5 text-sm transition-colors ${f.sort === o.v ? 'bg-indigo-50 text-indigo-700 font-bold' : 'text-slate-700 hover:bg-slate-50'}`}>
                      {o.l}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <button onClick={() => setF(p => ({ ...p, showFilters: !p.showFilters }))}
                    className={`px-5 py-2.5 rounded-xl text-sm font-bold flex items-center justify-center gap-2 transition-colors shrink-0 ${
                      f.showFilters || activeFilterCount > 0
                        ? 'bg-indigo-600 text-white shadow-lg'
                        : 'bg-slate-800 border border-slate-700 text-slate-300 hover:bg-slate-700'
                    }`}>
              <Icon n="Filter" size={16} />
              <span className="hidden sm:inline">Filters</span>
              {activeFilterCount > 0 && (
                <span className="bg-white text-indigo-600 px-1.5 py-0.5 rounded-md text-[10px]">{activeFilterCount}</span>
              )}
            </button>

            {isAdmin && (
              <button onClick={onAdd}
                      className="px-5 py-2.5 rounded-xl text-sm font-bold flex items-center justify-center gap-2 transition-colors shrink-0 bg-indigo-600 text-white hover:bg-indigo-700 shadow-lg">
                <Icon n="PlusCir" size={16} /> <span className="hidden sm:inline">Add</span>
              </button>
            )}
          </div>

          {activeFilterCount > 0 && (
            <div className="flex flex-wrap items-center gap-2 pt-1 pb-1">
              <span className="text-xs font-bold text-slate-400 mr-1 shrink-0 uppercase tracking-widest">Active:</span>
              {['nat', 'rnk', 'typ', 'spc', 'org', 'bl', 'bm'].map(k =>
                f[k].map(v => <ActiveChip key={`${k}-${v}`} label={v} onRemove={() => toggleArr(k, v)} />)
              )}
              {TOGGLE_PAIRS.map(p => f[p.showKey] && (
                <ActiveChip key={p.showKey} label={`${p.label} Only`} onRemove={() => setF(s => ({ ...s, [p.showKey]: false }))} />
              ))}
              {[...TOGGLE_PAIRS, ...HIDE_ONLY].map(p => f[p.hideKey] && (
                <ActiveChip key={p.hideKey} label={`Hide: ${p.label}`} onRemove={() => setF(s => ({ ...s, [p.hideKey]: false }))} />
              ))}
              <button onClick={clearF} className="text-xs font-semibold text-slate-400 hover:text-white underline ml-2">Clear All</button>
            </div>
          )}
        </div>
      </div>

      {f.showFilters && tab === 'jutsus' && (
        <div className="bg-slate-50 border-b border-slate-200 p-6 md:p-8 relative z-20 shadow-inner">
          <div className="max-w-6xl mx-auto space-y-10">
              <div>
                <h3 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-5 border-b border-slate-200 pb-2">Basic Properties</h3>
                <div className="space-y-6">
                  <ChipFilter title="Nature"      values={NATURES}     fKey="nat" />
                  <ChipFilter title="Jutsu Types" values={JUTSU_TYPES} fKey="typ" />
                  {f.typ.includes('Battlemode') && (
                    <div className="p-3 bg-indigo-50 border border-indigo-100 rounded-xl">
                      <ChipFilter title="Battlemode Tiers" values={BM_TIERS} fKey="bm" />
                    </div>
                  )}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <ChipFilter title="Rank"   values={RANKS}  fKey="rnk" />
                    <ChipFilter title="Origin" values={ORIGIN} fKey="org" />
                  </div>
                </div>
              </div>

              <div>
                <h3 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-5 border-b border-slate-200 pb-2">Detailed Tags</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-8 max-w-3xl">
                  <GenericDropdown
                    l="Specialization" placeholder="Any Specialization"
                    opts={specOptions.map(s => ({ value: s, label: s }))}
                    sel={f.spc} onChange={v => setF(p => ({ ...p, spc: v }))}
                    isOpen={ddOpen === 'f_spc'} onToggle={() => setDdOpen(ddOpen === 'f_spc' ? null : 'f_spc')} />
                  <BloodlineDropdown
                    l="Bloodlines" placeholder="Any Bloodline"
                    bloodlinesDb={bloodlinesDb}
                    sel={f.bl} onChange={v => setF(p => ({ ...p, bl: v }))} isMulti
                    isOpen={ddOpen === 'f_bl'} onToggle={() => setDdOpen(ddOpen === 'f_bl' ? null : 'f_bl')} />
                </div>
              </div>

              <div>
                <h3 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-5 border-b border-slate-200 pb-2">Conditions &amp; Exclusions</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                  <div>
                    <label className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-3 block">Show Only</label>
                    <div className="flex flex-wrap gap-4">
                      {TOGGLE_PAIRS.map(p => (
                        <label key={p.showKey} className="flex items-center gap-2.5 text-sm font-bold text-slate-700 cursor-pointer group">
                          <div className={`w-5 h-5 rounded flex items-center justify-center border-2 transition-colors ${f[p.showKey] ? 'bg-indigo-600 border-indigo-600 text-white' : 'bg-white border-slate-300 text-transparent'}`}>
                            <Icon n="Check" size={14}/>
                          </div>
                          <input type="checkbox" checked={f[p.showKey]} className="hidden"
                                 onChange={e => setF(prev => ({
                                   ...prev,
                                   [p.showKey]: e.target.checked,
                                   ...(e.target.checked ? { [p.hideKey]: false } : {}),
                                 }))} />
                          {p.label}
                        </label>
                      ))}
                    </div>
                  </div>

                  <div>
                    <label className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-3 block">Hide (Exclude)</label>
                    <div className="flex flex-wrap gap-4">
                      {[...TOGGLE_PAIRS, ...HIDE_ONLY].map(p => (
                        <label key={p.hideKey} className="flex items-center gap-2.5 text-sm font-bold text-slate-700 cursor-pointer group">
                          <div className={`w-5 h-5 rounded flex items-center justify-center border-2 transition-colors ${f[p.hideKey] ? 'bg-rose-500 border-rose-500 text-white' : 'bg-white border-slate-300 text-transparent'}`}>
                            <Icon n="X" size={14}/>
                          </div>
                          <input type="checkbox" checked={!!f[p.hideKey]} className="hidden"
                                 onChange={e => setF(prev => ({
                                   ...prev,
                                   [p.hideKey]: e.target.checked,
                                   ...(e.target.checked && p.showKey ? { [p.showKey]: false } : {}),
                                 }))} />
                          {p.label}
                        </label>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>
        </div>
      )}
    </>
  );
}

/* ============================================================================
   MODAL: SlotsViewModal
   ============================================================================ */
function SlotsViewModal({ jutsu, onClose }) {
  const { parsed, total } = getSlotStatus(jutsu.slots);
  const filled = parsed.filter(s => s && s.username);
  const empty  = total - filled.length;

  return (
    <div className="fixed inset-0 z-[80] bg-black/60 flex items-center justify-center p-4 animate-in fade-in" onClick={onClose}>
      <div className="bg-white rounded-3xl max-w-md w-full overflow-hidden max-h-[85vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="bg-slate-900 text-white p-5 flex justify-between items-center shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <Icon n="Eye" size={18} className="text-indigo-400 shrink-0" />
            <div className="min-w-0">
              <h3 className="font-bold text-base truncate">{jutsu.name}</h3>
              <p className="text-[10px] uppercase tracking-widest text-slate-400">Slot Holders</p>
            </div>
          </div>
          <button onClick={onClose}><Icon n="X" size={18} /></button>
        </div>

        <div className="p-5 overflow-y-auto custom-scrollbar">
          {total === 0 ? (
            <div className="text-center py-8 text-slate-400 text-sm font-semibold">No slots configured.</div>
          ) : (
            <>
              <div className="text-xs font-bold text-slate-500 mb-3 flex items-center gap-2">
                <span>{filled.length} of {total} taken</span>
                {empty > 0 && <span className="text-emerald-600">· {empty} open</span>}
              </div>
              <div className="space-y-1.5">
                {parsed.map((slot, i) => {
                  const hasName = !!(slot && slot.username);
                  const hasLink = !!(slot && slot.discord_link);
                  return (
                    <div key={i} className={`flex items-center gap-3 p-3 rounded-xl border ${hasName ? 'bg-slate-50 border-slate-200' : 'bg-white border-dashed border-slate-200'}`}>
                      <span className="text-[10px] font-bold text-slate-400 w-6 text-center shrink-0">#{i + 1}</span>
                      {hasName ? (
                        hasLink ? (
                          <a href={slot.discord_link}
                             target="_blank" rel="noopener noreferrer"
                             className="text-sm font-bold text-indigo-700 hover:text-indigo-900 hover:underline truncate flex-1 flex items-center gap-1.5">
                            {slot.username}
                            <Icon n="ExtLink" size={11} className="text-indigo-400 shrink-0" />
                          </a>
                        ) : (
                          <span className="text-sm font-bold text-slate-700 truncate flex-1">{slot.username}</span>
                        )
                      ) : (
                        <span className="text-sm italic text-slate-400 flex-1">Open slot</span>
                      )}
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/* ============================================================================
   MODAL: AdminFormModal
   ============================================================================ */
function AdminFormModal({ tab: rawTab, eRow, onClose, db, onSubmit, willGoToPending }) {
  const tab = MANAGE_TABLES[rawTab] ? rawTab : 'jutsus';
  const schema = MANAGE_TABLES[tab] || MANAGE_TABLES['jutsus'];
  const [fd, setFd]   = useState({});
  const [ddOpen, setDdOpen] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  // FIX: Lock the document body scroll so iOS Safari doesn't crash on unmount
  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = '';
    };
  }, []);

  // Hydrate the form whenever the row to edit changes.
  useEffect(() => {
    const next = {};
    schema.fields.forEach(field => {
      const raw = eRow[field.k];
      if (raw === undefined || raw === null || raw === '') {
        next[field.k] = field.t === 'slots'
          ? (field.defCount ? JSON.stringify(Array(field.defCount).fill({ username: '', discord_link: '' })) : '[]')
          : '';
      } else {
        next[field.k] = Array.isArray(raw) ? raw.join(', ') : raw;
      }
    });
    // Sync derived fields
    if (tab === 'jutsus') {
      const conds = [];
      if (eRow.locked)  conds.push('Locked');
      if (eRow.limited) conds.push('Limited');
      if (conds.length) next.conditions = conds.join(', ');
      next._cCost = !!(eRow._id && eRow.cost && !toArray(eRow.types).includes('Battlemode'));
    }
    setFd(next);
  }, [eRow, tab]);

  // Bloodlines sorted alphabetically for the picker (admin form is always A-Z).
  const sortedBloodlinesForForm = useMemo(
    () => [...(db.bloodlines || [])].sort((a, b) => a.name.localeCompare(b.name)),
    [db.bloodlines]
  );

  const handleSave = async () => {
    setSubmitting(true);
    const p = { ...fd };
    const isEdit = !!eRow._id;
    let entity = null;
    if (tab === 'jutsus') {
      const types = toArray(p.types);
      const isBm  = types.includes('Battlemode');
      let rank = [], bmTier = '';
      if (isBm) {
        p.cost = '';
        bmTier = p.bm_tier || '';
        rank   = [BM_TIER_TO_RANK[bmTier] || ''];
      } else if (!p._cCost) {
        p.cost = '';
        rank = toArray(p.rank);
      } else {
        rank = toArray(p.rank);
      }
      const conds = toArray(p.conditions);
      entity = {
        _id:         eRow._id || (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `j-${Date.now()}`),
        name:        p.name || '',
        nature:      p.nature || '',
        rank,
        cost:        p.cost || '',
        types,
        origin:      p.origin || '',
        spec:        toArray(p.spec),
        custom_tags: toArray(p.custom_tags),
        link:        p.link || '',
        bloodline:   p.bloodline || '',
        limited:     conds.includes('Limited'),
        locked:      conds.includes('Locked'),
        multiRank:   rank.length > 1 && !isBm,
        slots:       conds.includes('Limited') ? (p.slots || '') : '',
        bm_tier:     bmTier,
        _createdAt:  eRow._createdAt || new Date().toISOString(),
      };
    } else if (tab === 'bloodlines') {
      entity = {
        _id:         eRow._id || (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `b-${Date.now()}`),
        name:        p.name || '',
        category:    p.category || 'Custom',
        subcategory: p.subcategory || 'Other',
        custom_tags: toArray(p.custom_tags),
        link:        p.link || '',
        _createdAt:  eRow._createdAt || new Date().toISOString(),
      };
    }
    try {
      await onSubmit({
        tab,
        operation: isEdit ? 'update' : 'insert',
        targetId:  isEdit ? eRow._id : null,
        entity,
      });
      onClose();
    } catch (e) {
      alert('Save failed: ' + (e.message || 'unknown error'));
      setSubmitting(false);
    }
  };

  const visibleFields = schema.fields.filter(field =>
    !field.hidden &&
    (!field.hideUnlessInc || toArray(fd[field.hideUnlessInc.f]).includes(field.hideUnlessInc.v)) &&
    (!field.hideIfInc     || !toArray(fd[field.hideIfInc.f]).includes(field.hideIfInc.v))
  );

  return (
    <div className="fixed inset-0 z-[70] bg-slate-900/60 flex items-center justify-center p-4 sm:p-6 overflow-hidden">
      {/* FIX: Removed overflow-y-auto from outer wrapper and adjusted padding */}
      
      {/* FIX: Set max-h-[90vh] and flex-col to bound the card size securely */}
      <div className="bg-white rounded-3xl shadow-2xl max-w-3xl w-full max-h-[90vh] flex flex-col animate-in zoom-in-95 duration-200">
        
        {/* FIX: Moved overflow-y-auto down into this content wrapper specifically */}
        <div className="p-6 md:p-8 overflow-y-auto custom-scrollbar flex-1">
          
          <div className="flex justify-between items-center mb-8 border-b pb-4">
            <h3 className="text-xl font-bold flex items-center gap-3">
              <Icon n={eRow._id ? 'Edit' : 'PlusCir'} size={24} className="text-indigo-500" />
              {eRow._id ? 'Edit Entry' : `Add ${schema.label}`}
            </h3>
            <button onClick={onClose} className="text-slate-400 hover:bg-slate-100 p-2 rounded-full">
              <Icon n="X" size={20}/>
            </button>
          </div>

          {willGoToPending && (
            <div className="mb-6 p-4 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 text-sm flex items-start gap-3">
              <Icon n="Alert" size={18} className="text-amber-600 mt-0.5 shrink-0"/>
              <div>
                <p className="font-bold mb-1">This submission needs a second approval.</p>
                <p>Another Reviewer or admin will need to approve it before it goes live. You'll see it in the <strong>Pending</strong> tab until then.</p>
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            {visibleFields.map(field => (
              <div key={field.k} className={field.col === 2 || field.t === 'slots' ? 'md:col-span-2' : ''}>
                <label className="block text-xs font-bold text-slate-500 uppercase mb-2.5">{field.l}</label>
                {field.t === 'chip' ? (
                  <div className="flex flex-wrap gap-2.5">
                    {field.opts.map(o => {
                      const arr = toArray(fd[field.k]);
                      const sel = arr.includes(o);
                      return (
                        <button key={o} type="button"
                                onClick={() => setFd({
                                  ...fd,
                                  [field.k]: field.multi
                                    ? (sel ? arr.filter(x => x !== o).join(', ') : [...arr, o].join(', '))
                                    : (sel ? '' : o),
                                })}
                                className={`px-4 py-2 rounded-xl text-sm font-bold border ${sel ? 'bg-indigo-600 text-white shadow-md' : 'bg-slate-50 text-slate-600'}`}>
                          {o}
                        </button>
                      );
                    })}
                  </div>
                ) : field.t === 'spec-dd' ? (
                  <GenericDropdown
                    l="" placeholder="Select Specializations"
                    opts={(db.specializations || []).map(s => ({ value: s, label: s }))}
                    sel={toArray(fd[field.k])}
                    onChange={v => setFd({ ...fd, [field.k]: v.join(', ') })}
                    isOpen={ddOpen === field.k}
                    onToggle={() => setDdOpen(ddOpen === field.k ? null : field.k)} />
                ) : field.t === 'bl-select' ? (
                  <BloodlineDropdown
                    l="" placeholder="Select Bloodline"
                    bloodlinesDb={sortedBloodlinesForForm}
                    sel={fd[field.k] || ''}
                    onChange={v => setFd({ ...fd, [field.k]: v })}
                    isMulti={false}
                    isOpen={ddOpen === field.k}
                    onToggle={() => setDdOpen(ddOpen === field.k ? null : field.k)} />
                ) : field.t === 'slots' ? (
                  <SlotsEditor value={fd[field.k] || ''} onChange={v => setFd({ ...fd, [field.k]: v })} defCount={field.defCount} />
                ) : (
                  <input type="text" value={fd[field.k] || ''}
                         onChange={(e) => setFd({ ...fd, [field.k]: e.target.value })}
                         className="w-full text-sm bg-slate-50 border rounded-xl px-4 py-3 outline-none focus:ring-2 focus:ring-indigo-500"
                         placeholder={field.l} />
                )}
              </div>
            ))}

            {/* Cost row, jutsus only and not Battlemode */}
            {tab === 'jutsus' && !toArray(fd.types).includes('Battlemode') && (
              <div className="md:col-span-2 pt-4 border-t">
                <label className="text-xs font-bold text-slate-500 uppercase block mb-2.5">
                  Cost
                  {!fd._cCost && (
                    <span className="text-indigo-500 ml-2">
                      (auto: {(() => {
                        const r = toArray(fd.rank);
                        return r.length === 1 ? RANK_COST_MAP[r[0]] : (r.length > 1 ? r.map(x => RANK_COST_MAP[x]).filter(Boolean).join(' / ') : '');
                      })()})
                    </span>
                  )}
                </label>
                <div className="flex items-center gap-4">
                  {fd._cCost ? (
                    <input value={fd.cost || ''} onChange={e => setFd({ ...fd, cost: e.target.value })}
                           className="flex-1 bg-white border rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-indigo-500 shadow-sm"
                           placeholder="Custom cost (e.g. 5 CU)" />
                  ) : (
                    <div className="flex-1 bg-slate-100 border rounded-xl px-4 py-3 text-sm text-slate-500 font-semibold shadow-sm flex items-center gap-1 flex-wrap">
                      {toArray(fd.rank).length > 0
                        ? toArray(fd.rank).map((r, i) => (
                            <span key={i} className="px-2 py-0.5 bg-indigo-50 border border-indigo-100 text-indigo-600 rounded-md text-xs font-black">
                              {RANK_COST_MAP[r] || '-'}
                            </span>
                          ))
                        : 'Select a rank to see cost'}
                    </div>
                  )}
                  <label className="flex items-center gap-3 text-sm font-bold cursor-pointer group">
                    <div className={`w-6 h-6 rounded-md flex items-center justify-center border-2 ${fd._cCost ? 'bg-indigo-600 border-indigo-600 text-white shadow-md' : 'bg-slate-50 border-slate-300 text-transparent group-hover:border-indigo-400'}`}>
                      <Icon n="Check" size={16}/>
                    </div>
                    <input type="checkbox" checked={!!fd._cCost}
                           onChange={(e) => setFd({ ...fd, _cCost: e.target.checked, cost: '' })}
                           className="hidden" />
                    Custom Cost
                  </label>
                </div>
              </div>
            )}
          </div>

          <div className="flex justify-end gap-4 mt-10 pt-6 border-t">
            <button onClick={onClose} className="bg-white border-2 px-8 py-3 rounded-xl font-bold hover:bg-slate-50">Cancel</button>
            <button onClick={handleSave}
                    disabled={submitting || schema.fields.some(f => f.req && !(fd[f.k] || '').toString().trim())}
                    className="bg-indigo-600 text-white px-8 py-3 rounded-xl font-bold flex gap-2 disabled:opacity-50 hover:bg-indigo-700 shadow-md">
              <Icon n="Save" size={18}/> {submitting ? 'Saving...' : (willGoToPending ? 'Submit for Approval' : 'Save')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ============================================================================
   MODAL: AuditLogModal
   ============================================================================ */
function AuditLogModal({ onClose }) {
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const list = await fetchRoleChangeLog(200);
        if (!cancelled) setEntries(list);
      } catch (e) {
        if (!cancelled) setError(e.message || 'Failed to load audit log.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const arrow = (from, to) => {
    const colors = { user: 'text-slate-500', staff: 'text-emerald-600', admin: 'text-indigo-600', owner: 'text-amber-600' };
    return (
      <span className="text-xs font-bold">
        <span className={colors[from] || ''}>{from === 'staff' ? 'Reviewer' : (from || '∅')}</span>
        <span className="mx-1.5 text-slate-300">→</span>
        <span className={colors[to] || ''}>{to === 'staff' ? 'Reviewer' : (to || '∅')}</span>
      </span>
    );
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4 animate-in fade-in" onClick={onClose}>
      <div className="bg-white rounded-3xl max-w-2xl w-full overflow-hidden max-h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="bg-slate-900 text-white p-5 flex justify-between shrink-0">
          <div className="flex items-center gap-2">
            <Icon n="Clock" size={20} className="text-amber-400" />
            <h3 className="font-bold text-lg">Audit Log — Role Changes</h3>
          </div>
          <button onClick={onClose}><Icon n="X" size={18} /></button>
        </div>

        <div className="p-6 overflow-y-auto custom-scrollbar">
          {error && <div className="mb-4 p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-sm font-semibold">{error}</div>}
          {loading ? (
            <div className="text-center py-8 text-slate-400 text-sm font-semibold">Loading...</div>
          ) : entries.length === 0 ? (
            <div className="text-center py-8 text-slate-400 text-sm font-semibold">No role changes recorded yet.</div>
          ) : (
            <div className="space-y-1.5">
              {entries.map(e => (
                <div key={e.id} className="flex items-center gap-3 p-3 bg-slate-50 border border-slate-200 rounded-xl text-xs">
                  <div className="text-slate-400 font-mono shrink-0 w-32 truncate">{new Date(e.changed_at).toLocaleString()}</div>
                  <div className="flex-1 min-w-0">
                    <div className="font-bold text-slate-800 truncate">{maskEmail(e.target_email) || '(unknown)'}</div>
                    <div className="text-slate-500 truncate">by {maskEmail(e.changed_by_email) || 'system'}</div>
                  </div>
                  <div className="shrink-0">{arrow(e.old_role, e.new_role)}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ============================================================================
   MODAL: SystemToolsModal
   ============================================================================ */
function SystemToolsModal({ db, setDb, onClose, onRefresh, refreshing, onOpenAuditLog, onManageBL, isOwner }) {
  const [msg, setMsg]         = useState('');
  const [newSpec, setNewSpec] = useState('');
  const [pendingDel, setPendingDel] = useState(null);

  const addSpec = () => {
    const v = newSpec.trim();
    if (!v) return;
    if (db.specializations.includes(v)) { setMsg(`'${v}' is already in the list.`); return; }
    setDb(d => {
      const next = [...d.specializations, v];
      if (isSupabaseConfigured()) saveSpecializationsToSupabase(next).catch(e => console.warn('[NARP] save specs failed:', e));
      return { ...d, specializations: next };
    });
    setNewSpec('');
    setMsg(`Added '${v}'.`);
  };

  const confirmDelSpec = () => {
    if (!pendingDel) return;
    setDb(d => {
      const next = d.specializations.filter(x => x !== pendingDel);
      if (isSupabaseConfigured()) saveSpecializationsToSupabase(next).catch(e => console.warn('[NARP] save specs failed:', e));
      return { ...d, specializations: next };
    });
    setMsg(`Removed '${pendingDel}'.`);
    setPendingDel(null);
  };

  const exportJson = () => {
    const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(db, null, 2));
    const a = document.createElement('a');
    a.href = dataStr;
    a.download = 'narp_database_backup.json';
    a.click();
    setMsg('JSON Exported Successfully');
  };

  const handleSync = async () => {
    setMsg('Syncing...');
    try {
      await onRefresh();
      setMsg('Database synced.');
    } catch (e) {
      setMsg('Sync failed: ' + (e.message || 'unknown error'));
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4 animate-in fade-in" onClick={onClose}>
      <div className="bg-white rounded-3xl max-w-3xl w-full overflow-hidden max-h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="bg-slate-900 text-white p-5 flex justify-between shrink-0">
          <div className="flex items-center gap-2">
            <Icon n="Shield" size={20} className="text-indigo-400" />
            <h3 className="font-bold text-lg">System Tools</h3>
          </div>
          <button onClick={onClose}><Icon n="X" size={18} /></button>
        </div>

        <div className="p-8 overflow-y-auto">
          {msg && (
            <div className="mb-6 p-4 rounded-xl text-sm bg-indigo-50 text-indigo-800 border border-indigo-200 font-bold flex items-center justify-center">
              {msg}
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Sync */}
            <div className="bg-slate-50 rounded-2xl border p-6">
              <h3 className="text-lg font-bold mb-2 flex items-center gap-2">
                <Icon n="Refresh" size={20} className="text-indigo-500" /> Synchronization
              </h3>
              <p className="text-xs text-slate-500 mb-6">Re-fetch the latest catalog and pending list from the database. Use after another admin made changes you want to see locally.</p>
              <button onClick={handleSync} disabled={refreshing}
                      className="w-full bg-indigo-600 text-white py-3 rounded-xl font-bold flex justify-center gap-2 hover:bg-indigo-700 shadow-md disabled:opacity-50">
                <Icon n="Refresh" size={16} className={refreshing ? 'animate-spin' : ''}/>
                {refreshing ? 'Syncing...' : 'Sync data'}
              </button>
            </div>

            {/* Audit Log */}
            <div className="bg-slate-50 rounded-2xl border p-6">
              <h3 className="text-lg font-bold mb-2 flex items-center gap-2">
                <Icon n="Clock" size={20} className="text-amber-500" /> Audit Log
              </h3>
              <p className="text-xs text-slate-500 mb-6">View the history of role changes — who promoted or demoted whom, and when.</p>
              <button onClick={onOpenAuditLog}
                      className="w-full bg-slate-800 text-white py-3 rounded-xl font-bold flex justify-center gap-2 hover:bg-slate-900">
                <Icon n="Eye" size={16}/> View log
              </button>
            </div>

            {/* Manage Bloodlines */}
            <div className="bg-slate-50 rounded-2xl border p-6">
              <h3 className="text-lg font-bold mb-2 flex items-center gap-2">
                <Icon n="Book" size={20} className="text-purple-500" /> Bloodlines
              </h3>
              <p className="text-xs text-slate-500 mb-6">Add, edit, and remove bloodlines. These populate the bloodline filter dropdown but no longer have a public browse tab.</p>
              <button onClick={onManageBL}
                      className="w-full bg-purple-600 text-white py-3 rounded-xl font-bold flex justify-center gap-2 hover:bg-purple-700">
                <Icon n="Edit" size={16}/> Manage Bloodlines ({(db.bloodlines || []).length})
              </button>
            </div>

            {/* Export */}
            <div className="bg-slate-50 rounded-2xl border p-6">
              <h3 className="text-lg font-bold mb-2 flex items-center gap-2">
                <Icon n="Download" size={20} className="text-emerald-500" /> Export
              </h3>
              <p className="text-xs text-slate-500 mb-6">Download a backup copy of all jutsu and bloodline entries for your records.</p>
              <div className="flex gap-3">
                <button onClick={exportJson}
                        className="flex-1 bg-slate-800 text-white py-3 rounded-xl font-bold flex justify-center gap-2 hover:bg-slate-900">
                  <Icon n="Download" size={16}/> JSON
                </button>
                <button onClick={() => setMsg('CSV export is currently under construction.')}
                        className="flex-1 bg-emerald-600 text-white py-3 rounded-xl font-bold flex justify-center gap-2 hover:bg-emerald-700">
                  <Icon n="Download" size={16}/> CSV
                </button>
              </div>
            </div>

            {/* Manage Specializations */}
            <div className="bg-slate-50 rounded-2xl border p-6 md:col-span-2">
              <h3 className="text-lg font-bold mb-2 flex items-center gap-2">
                <Icon n="Tag" size={20} className="text-indigo-500" /> Manage Specializations
              </h3>
              <p className="text-xs text-slate-500 mb-4">Add or permanently remove tags from the global Specializations list used when creating new Jutsus.</p>
              <div className="flex flex-wrap gap-2 mb-4">
                {(db.specializations || []).map(s => (
                  <span key={s} className="bg-white border rounded-lg px-3 py-1.5 text-sm font-semibold flex items-center gap-2 shadow-sm">
                    {s}
                    <button onClick={() => setPendingDel(s)} className="text-red-400 hover:text-red-600">
                      <Icon n="X" size={14}/>
                    </button>
                  </span>
                ))}
              </div>
              <div className="flex gap-2">
                <input value={newSpec} onChange={e => setNewSpec(e.target.value)}
                       onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addSpec(); } }}
                       placeholder="New specialization..."
                       className="flex-1 border rounded-xl px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500" />
                <button onClick={addSpec} className="bg-indigo-600 hover:bg-indigo-700 text-white px-6 py-2 rounded-xl font-bold transition-colors">
                  Add
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Confirm-delete sub-modal for specializations */}
        {pendingDel && (
          <div className="fixed inset-0 z-[110] bg-black/60 flex items-center justify-center p-4" onClick={() => setPendingDel(null)}>
            <div className="bg-white p-6 rounded-3xl max-w-sm w-full" onClick={e => e.stopPropagation()}>
              <h3 className="font-bold text-xl mb-2 text-slate-900">Remove specialization?</h3>
              <p className="text-sm text-slate-600 mb-6">Remove '{pendingDel}' from the global list? Existing jutsus that already use it will keep the value.</p>
              <div className="flex gap-3">
                <button onClick={() => setPendingDel(null)} className="flex-1 px-4 py-3 bg-slate-100 text-slate-700 font-bold rounded-xl hover:bg-slate-200">Cancel</button>
                <button onClick={confirmDelSpec}            className="flex-1 px-4 py-3 bg-red-600 text-white font-bold rounded-xl hover:bg-red-700 shadow-md">Remove</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ============================================================================
   COMPONENT: ProfileAvatar
   ============================================================================ */
function ProfileAvatar({ profile, className = "w-10 h-10 rounded-lg shrink-0 object-cover" }) {
  const isDiscordAvatar = profile?.avatar_url && (profile.avatar_url.includes('discord') || profile.avatar_url.includes('discordapp'));
  if (isDiscordAvatar) {
    return <img src={profile.avatar_url} alt={profile.username || 'Avatar'} className={className} />;
  }
  return <RankLogo role={profile?.role} className={className} />;
}

const maskEmail = (email) => {
  if (!email) return '';
  const parts = email.split('@');
  if (parts.length !== 2) return '***';
  const name = parts[0];
  const domain = parts[1];
  const maskedName = name.length > 2 ? name[0] + '***' + name[name.length - 1] : '***';
  return `${maskedName}@${domain}`;
};

/* ============================================================================
   COMPONENT: UserMenu
   ============================================================================ */
function UserMenu({ profile, onSignIn, onSignOut, supabaseReady, devRole, onToggleDevRole }) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    const handleOutsideClick = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutsideClick);
    document.addEventListener('touchstart', handleOutsideClick);
    return () => {
      document.removeEventListener('mousedown', handleOutsideClick);
      document.removeEventListener('touchstart', handleOutsideClick);
    };
  }, [open]);

  const activeProfile = supabaseReady ? profile : {
    id: 'dev-user-id',
    username: 'Dev Administrator',
    email: 'dev@example.com',
    avatar_url: null,
    role: devRole,
  };

  if (supabaseReady && !activeProfile) {
    return (
      <button onClick={onSignIn}
              type="button"
              className="text-xs px-3 py-1.5 font-bold rounded-lg bg-[#5865F2] text-white hover:bg-[#4752c4] flex items-center gap-2 shrink-0">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z"/></svg>
        Sign in with Discord
      </button>
    );
  }

  const roleColors = {
    owner: 'bg-amber-500 text-amber-50 border-amber-600',
    admin: 'bg-indigo-500 text-indigo-50 border-indigo-600',
    staff: 'bg-emerald-500 text-emerald-50 border-emerald-600',
    user:  'bg-slate-600 text-slate-50 border-slate-700',
  };

  return (
    <div className="relative shrink-0" ref={menuRef}>
      <button onClick={() => setOpen(!open)}
              type="button"
              className="flex items-center gap-2 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-lg p-1 pr-2.5 transition-colors">
        <ProfileAvatar profile={activeProfile} className="w-6 h-6 rounded-md" />
        <span className={`text-[10px] font-bold uppercase px-1.5 py-0.5 rounded border ${roleColors[activeProfile.role] || roleColors.user}`}>
          {activeProfile.role === 'staff' ? 'Reviewer' : activeProfile.role}
        </span>
        <Icon n="Down" size={12} className="text-slate-400" />
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-64 bg-white rounded-xl shadow-xl border border-slate-200 z-40 overflow-hidden">
          <div className="p-4 border-b border-slate-100 flex items-center gap-3">
            <ProfileAvatar profile={activeProfile} className="w-10 h-10 rounded-lg" />
            <div className="flex-1 min-w-0">
              <div className="text-sm font-bold text-slate-800 truncate">{activeProfile.username || 'No name'}</div>
            </div>
          </div>
          {!supabaseReady && (
            <button onClick={onToggleDevRole}
                    type="button"
                    className="w-full text-left px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 flex items-center gap-2.5 border-t border-slate-100">
              <Icon n="Key" size={14} className="text-indigo-500"/> Toggle Dev Role (is: {devRole === 'staff' ? 'Reviewer' : devRole})
            </button>
          )}
          <button onClick={() => { setOpen(false); onSignOut(); }}
                  type="button"
                  className="w-full text-left px-4 py-2.5 text-sm font-semibold text-rose-600 hover:bg-rose-50 flex items-center gap-2.5 border-t border-slate-100">
            <Icon n="X" size={14}/> Sign out
          </button>
        </div>
      )}
    </div>
  );
}

/* ============================================================================
   COMPONENT: PendingJutsuCard
   ============================================================================ */
function PendingJutsuCard({ pending, originalJutsu, currentUserId, isAdmin, onApprove, onCancel, onReview, onEdit }) {
  const isMine     = pending.submitted_by === currentUserId;
  const op         = pending.operation;
  const submitter  = pending.submitter;
  const submitterName = submitter?.username || 'Unknown';

  const opColors = {
    insert: 'bg-emerald-100 text-emerald-800 border-emerald-300',
    update: 'bg-amber-100  text-amber-800  border-amber-300',
    delete: 'bg-rose-100   text-rose-800   border-rose-300',
  };

  const display = op === 'delete' ? (originalJutsu || {}) : (pending.data || {});
  const name = display.name || originalJutsu?.name || '(no name)';

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-amber-200 p-4 flex flex-col gap-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded border ${opColors[op] || ''}`}>
              {op === 'insert' ? 'New' : op === 'update' ? 'Edit' : 'Delete'}
            </span>
            <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded border ${
              pending.status === 'pending_review' ? 'bg-amber-100 text-amber-800 border-amber-300' : 'bg-blue-100 text-blue-800 border-blue-300'
            }`}>
              {pending.status === 'pending_review' ? 'Pending Review' : 'Pending Approval'}
            </span>
            {isMine && <span className="text-[10px] font-bold uppercase text-indigo-600 bg-indigo-50 border border-indigo-200 px-2 py-0.5 rounded">Yours</span>}
          </div>
          <h3 className="font-bold text-slate-900 text-base truncate">{name}</h3>
          <p className="text-xs text-slate-500 mt-0.5">
            Submitted by <strong>{submitterName}</strong> · {new Date(pending.submitted_at).toLocaleString()}
          </p>
        </div>
      </div>

      {op !== 'delete' && (
        <div className="text-xs text-slate-600 bg-slate-50 border border-slate-100 rounded-lg p-3 space-y-1">
          {display.nature                                  && <div><span className="font-semibold">Nature:</span> {display.nature}</div>}
          {Array.isArray(display.rank) && display.rank.length > 0 && <div><span className="font-semibold">Rank:</span> {display.rank.join(', ')}</div>}
          {Array.isArray(display.types) && display.types.length > 0 && <div><span className="font-semibold">Type:</span> {display.types.join(', ')}</div>}
          {display.bloodline                               && <div><span className="font-semibold">Bloodline:</span> {display.bloodline}</div>}
          {Array.isArray(display.spec) && display.spec.length > 0 && <div><span className="font-semibold">Spec:</span> {display.spec.join(', ')}</div>}
        </div>
      )}
      {op === 'delete' && (
        <div className="text-xs text-rose-700 bg-rose-50 border border-rose-100 rounded-lg p-3">
          {originalJutsu
            ? <>This will permanently delete <strong>{originalJutsu.name}</strong> from the database.</>
            : <>Target jutsu no longer exists. Cancel this pending entry.</>}
        </div>
      )}

      <div className="flex gap-2 mt-1">
        {pending.status === 'pending_review' ? (
          <button onClick={() => onReview(pending.id)}
                  className="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-xl font-bold text-sm flex items-center justify-center gap-1.5">
            <Icon n="Check" size={14}/> Review (Step 1)
          </button>
        ) : (
          !isMine && (
            <button onClick={() => onApprove(pending.id)}
                    className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-xl font-bold text-sm flex items-center justify-center gap-1.5">
              <Icon n="Check" size={14}/> Approve
            </button>
          )
        )}
        {onEdit && (
          <button onClick={() => onEdit(pending)}
                  className="bg-slate-100 hover:bg-indigo-50 hover:text-indigo-700 text-slate-600 px-3 py-2 rounded-xl font-bold text-sm flex items-center justify-center gap-1.5"
                  title="Edit pending payload">
            <Icon n="Edit" size={14}/> Edit
          </button>
        )}
        {(isMine || isAdmin) && (
          <button onClick={() => onCancel(pending.id)}
                  className={`${(!isMine && pending.status !== 'pending_review') ? 'flex-none px-4' : 'flex-1'} bg-slate-100 hover:bg-rose-50 hover:text-rose-700 text-slate-600 px-4 py-2 rounded-xl font-bold text-sm flex items-center justify-center gap-1.5`}>
            <Icon n="X" size={14}/> Cancel
          </button>
        )}
        {isMine && !isAdmin && pending.status === 'pending_approval' && (
          <div className="text-[10px] text-slate-400 italic self-center">
            Another Reviewer must approve
          </div>
        )}
      </div>
    </div>
  );
}

/* ============================================================================
   MODAL: CatalogManagementModal
   ============================================================================ */
function CatalogManagementModal({ which, db, onClose, onEdit, onAdd, onDelete }) {
  const cfg = {
    bloodlines: {
      title:    'Manage Bloodlines',
      icon:     'Book',
      list:     db.bloodlines || [],
      empty:    'No bloodlines yet.',
      labelFor: b => [b.category, b.subcategory].filter(Boolean).join(' / ') || '—',
    },
  }[which];

  const grouped = useMemo(() => {
    const out = {};
    cfg.list.forEach(item => {
      const cat = item.category || 'Uncategorized';
      (out[cat] = out[cat] || []).push(item);
    });
    Object.values(out).forEach(arr => arr.sort((a, b) => (a.name || '').localeCompare(b.name || '')));
    return Object.entries(out).sort(([a], [b]) => a.localeCompare(b));
  }, [cfg.list]);

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4 animate-in fade-in" onClick={onClose}>
      <div className="bg-white rounded-3xl max-w-3xl w-full overflow-hidden max-h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="bg-slate-900 text-white p-5 flex justify-between items-center shrink-0">
          <div className="flex items-center gap-2">
            <Icon n={cfg.icon} size={20} className="text-indigo-400" />
            <h3 className="font-bold text-lg">{cfg.title}</h3>
            <span className="text-[10px] uppercase font-bold text-slate-400 bg-slate-800 border border-slate-700 px-2 py-0.5 rounded">{cfg.list.length}</span>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={onAdd}
                    className="text-xs px-3 py-1.5 font-bold rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white flex items-center gap-1.5">
              <Icon n="Plus" size={12}/> Add
            </button>
            <button onClick={onClose} className="text-slate-400 hover:text-white"><Icon n="X" size={18} /></button>
          </div>
        </div>

        <div className="p-6 overflow-y-auto custom-scrollbar">
          {cfg.list.length === 0 ? (
            <div className="text-center py-12 text-slate-400 text-sm font-semibold">{cfg.empty}</div>
          ) : (
            <div className="space-y-6">
              {grouped.map(([cat, items]) => (
                <div key={cat}>
                  <h4 className="text-xs font-bold uppercase tracking-widest text-slate-500 mb-2 border-b border-slate-100 pb-1">
                    {cat} <span className="text-slate-400 normal-case font-semibold">({items.length})</span>
                  </h4>
                  <div className="space-y-1.5">
                    {items.map(item => (
                      <div key={item._id} className="flex items-center gap-3 p-3 bg-slate-50 border border-slate-200 rounded-xl hover:bg-slate-100">
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-bold text-slate-800 truncate">{item.name}</div>
                          <div className="text-xs text-slate-500 truncate flex items-center gap-1.5">
                            <span>{cfg.labelFor(item)}</span>
                            {toArray(item.custom_tags).length > 0 && (
                              <>
                                <span className="text-slate-300">·</span>
                                <span className="truncate">{toArray(item.custom_tags).join(', ')}</span>
                              </>
                            )}
                            {item.link && item.link !== '#' && (
                              <>
                                <span className="text-slate-300">·</span>
                                <a href={item.link} target="_blank" rel="noopener noreferrer"
                                   onClick={e => e.stopPropagation()}
                                   className="text-indigo-600 hover:underline shrink-0">link</a>
                              </>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <button onClick={() => onEdit(item)}
                                  className="p-2 text-slate-500 hover:bg-indigo-100 hover:text-indigo-700 rounded-lg">
                            <Icon n="Edit" size={14}/>
                          </button>
                          <button onClick={() => onDelete(item)}
                                  className="p-2 text-slate-500 hover:bg-rose-100 hover:text-rose-700 rounded-lg">
                            <Icon n="Trash" size={14}/>
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ============================================================================
   MAIN APP
   ============================================================================ */
const INITIAL_FILTER_STATE = {
  q: '',
  nat: [], rnk: [], typ: [], spc: [], org: [], bl: [], bm: [],
  lck: false, lim: false, mul: false,
  hLck: false, hLim: false, hMul: false, hMP: false, hAsk: false,
  showFilters: false,
  sort: 'az',
};

const ARRAY_FILTER_KEYS = ['nat', 'rnk', 'typ', 'spc', 'org', 'bl', 'bm'];
const BOOL_FILTER_KEYS  = ['lck', 'lim', 'mul', 'hLck', 'hLim', 'hMul', 'hMP', 'hAsk'];

export default function App() {
  const [db, setDb]           = useState({ jutsus: [], bloodlines: [], specializations: [] });
  const [loading, setLoading] = useState(true);

  const [profile, setProfile] = useState(null);
  const [devRole, setDevRole] = useState(() => LS.get(STORAGE.ROLE, 'user'));
  const supabaseReady = isSupabaseConfigured();

  const role    = supabaseReady ? (profile?.role || 'guest') : devRole;
  const isStaff = role === 'staff' || role === 'admin' || role === 'owner';
  const isAdmin = role === 'admin' || role === 'owner';
  const isOwner = role === 'owner';

  const [pendingJutsus, setPendingJutsus] = useState([]);
  const [pendingLoaded, setPendingLoaded] = useState(false);

  const [tab, setTab]           = useState('jutsus');
  const [viewMode, setViewMode] = useState(() => LS.get(STORAGE.VIEW_MODE, 'card'));
  const [expRow, setExpRow]     = useState(null);
  const [cart, setCart]         = useState([]);
  const [pTags, setPTags]       = useState(() => LS.get(STORAGE.TAGS, {}));

  const [f, setF] = useState(INITIAL_FILTER_STATE);
  const clearF = useCallback(() => setF(p => {
    const next = { ...p };
    ARRAY_FILTER_KEYS.forEach(k => next[k] = []);
    BOOL_FILTER_KEYS.forEach(k  => next[k] = false);
    next.q = '';
    return next;
  }), []);

  const [modals, setModals]         = useState({ credits: false, copiedId: null, system: false, audit: false, manageBL: false });
  const [adminForm, setAdminForm]   = useState(null);
  const [slotsView, setSlotsView]   = useState(null);
  const [confirmDel, setConfirmDel] = useState(null);

  useEffect(() => { LS.set(STORAGE.VIEW_MODE, viewMode); }, [viewMode]);
  useEffect(() => { LS.set(STORAGE.ROLE, devRole); }, [devRole]);

  useEffect(() => {
    async function initializeDiscordActivity() {
      if (window.parent !== window) {
        const discordSdk = new DiscordSDK(import.meta.env.VITE_DISCORD_CLIENT_ID);
        // Add a 3-second timeout safeguard to prevent hanging inside generic iframe previews/environments
        const readyPromise = discordSdk.ready();
        const timeoutPromise = new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Discord activity SDK ready timeout')), 3000)
        );
        await Promise.race([readyPromise, timeoutPromise]);

        const { code } = await discordSdk.commands.authorize({
          client_id: import.meta.env.VITE_DISCORD_CLIENT_ID,
          response_type: 'code',
          state: '',
          prompt: 'none',
          scope: ["identify", "guilds", "email", "guilds.members.read"],
        });

        const response = await fetch('/.netlify/functions/discord-login', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ code }),
        });

        if (!response.ok) {
          const errText = await response.text();
          throw new Error(`Discord activity login backend call failed: ${errText}`);
        }

        const data = await response.json();
        if (data.email && data.password && supabase) {
          await supabase.auth.signInWithPassword({
            email: data.email,
            password: data.password,
          });
        }
      }
    }

    initializeDiscordActivity().catch(err => {
      console.error("Discord activity SDK login failed:", err);
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    loadDB()
      .then(d => {
        if (!cancelled) {
          setDb(d);
          setLoading(false);
        }
      })
      .catch(err => {
        console.error('[NARP] loadDB failed with error:', err);
        if (!cancelled) {
          setLoading(false);
        }
      });
    return () => { cancelled = true; };
  }, []);
  useEffect(() => { if (!loading) LS.set(STORAGE.CACHE, { ...db, ts: Date.now() }); }, [db, loading]);

  useEffect(() => {
    if (!supabaseReady) return;
    let cancelled = false;

    const refreshProfile = async () => {
      try {
        const session = await getCurrentSession();
        if (cancelled) return;
        if (!session) { setProfile(null); return; }
        let p = await fetchMyProfile();
        if (!p) {
          if (!cancelled) setProfile(null);
          return;
        }

        // Automatically assign unique Discord username if profile doesn't have one
        if (!p.username) {
          const meta = session.user?.user_metadata || {};
          const discordUser = meta.preferred_username || meta.user_name || meta.name || '';
          if (discordUser) {
            try {
              p = await updateMyUsername(discordUser);
            } catch (updateErr) {
              console.warn('[NARP] failed to auto-update username:', updateErr);
            }
          }
        }

        if (!cancelled) setProfile(p);
      } catch (e) {
        console.warn('[NARP] profile fetch failed:', e);
        if (!cancelled) setProfile(null);
      }
    };

    refreshProfile();
    const unsub = onAuthChange(() => { refreshProfile(); });
    return () => { cancelled = true; unsub(); };
  }, [supabaseReady]);

  const handleSignIn  = async () => { try { await signInWithDiscord(); } catch (e) { alert('Sign-in failed: ' + e.message); } };
  const handleSignOut = async () => { try { await signOut(); setProfile(null); } catch (e) { console.warn('[NARP] sign-out failed:', e); } };

  const refreshPending = useCallback(async () => {
    if (!supabaseReady || !isStaff) { setPendingJutsus([]); setPendingLoaded(false); return; }
    try {
      const list = await fetchPendingJutsus();
      setPendingJutsus(list);
      setPendingLoaded(true);
    } catch (e) {
      console.warn('[NARP] fetchPendingJutsus failed:', e);
    }
  }, [supabaseReady, isStaff]);

  useEffect(() => { refreshPending(); }, [refreshPending]);

  const [refreshing, setRefreshing] = useState(false);
  const refreshDB = useCallback(async () => {
    setRefreshing(true);
    try {
      const fresh = await loadDB();
      setDb(fresh);
      await refreshPending();
    } catch (e) {
      console.warn('[NARP] refresh failed:', e);
    } finally {
      setRefreshing(false);
    }
  }, [refreshPending]);

  useEffect(() => {
    if (!supabaseReady || !profile) return;
    let channel = null;
    try {
      channel = subscribeToDatabaseChanges(() => {
        refreshDB();
        refreshPending();
      });
    } catch (err) {
      console.warn('[NARP] Failed to subscribe to database changes:', err);
    }
    return () => {
      if (channel) {
        try {
          supabase.removeChannel(channel);
        } catch (err) {
          console.warn('[NARP] Failed to remove database subscription channel:', err);
        }
      }
    };
  }, [supabaseReady, profile, refreshDB, refreshPending]);

  const submitChange = useCallback(async ({ tab: t, operation, targetId, entity }) => {
    const isJutsus = t === 'jutsus';

    if (adminForm?.isPendingEdit) {
      if (!supabaseReady) return true;
      const payload = entity ? buildJutsuPayload(entity, true) : null;
      await updatePendingJutsuData(adminForm.pendingId, payload);
      await refreshPending();
      return false;
    }

    if ((role === 'user' || role === 'staff') && isJutsus) {
      if (!supabaseReady) {
        applyChangeLocally(t, operation, targetId, entity);
        return true;
      }
      const payload = entity ? buildJutsuPayload(entity, operation === 'update') : null;
      const status = role === 'user' ? 'pending_review' : 'pending_approval';
      await submitPendingJutsu(operation, targetId, payload, status);
      await refreshPending();
      return false;
    }

    if (isAdmin) {
      applyChangeLocally(t, operation, targetId, entity);
      if (supabaseReady) {
        try {
          if (operation === 'delete') {
            if (t === 'jutsus')          await deleteJutsu(targetId);
            else if (t === 'bloodlines') await deleteBloodline(targetId);
          } else {
            if (t === 'jutsus') {
              // Direct admin write bypasses the staff queue, so log it as a
              // single-approver action (current user as both submitter and
              // reviewer) before persisting the change.
              await sendDiscordLog(entity, 'Approved', profile, profile, profile);
              await upsertJutsu(entity);
            }
            else if (t === 'bloodlines') await upsertBloodline(entity);
          }
        } catch (e) {
          console.warn('[NARP] write failed:', e);
          alert('Save failed: ' + e.message);
        }
      }
      return true;
    }

    throw new Error('Permission denied');
  }, [isAdmin, isStaff, role, adminForm, supabaseReady, refreshPending, profile]);

  const applyChangeLocally = (t, operation, targetId, entity) => {
    setDb(d => {
      const list = d[t] || [];
      let next;
      if (operation === 'delete')      next = list.filter(x => x._id !== targetId);
      else if (operation === 'update') next = list.map(x => x._id === targetId ? entity : x);
      else                             next = [entity, ...list];
      return { ...d, [t]: next };
    });
  };

  const handleApprovePending = async (id) => {
    try {
      // Log the approval to Discord before committing it. The submitter is the
      // staff member who queued the entry; the current user is the reviewer
      // (the "2nd pair of eyes" in the double-approver workflow).
      const item = pendingJutsus.find(p => p.id === id);
      if (item) await sendDiscordLog(item.data, 'Approved', item.submitter, item.first_reviewer, profile);

      await approvePendingJutsu(id);
      await refreshPending();
      await refreshDB();
    } catch (e) {
      alert('Approve failed: ' + e.message);
    }
  };

  const handleCancelPending = async (id) => {
    try {
      // Log the denial to Discord before removing the pending entry.
      const item = pendingJutsus.find(p => p.id === id);
      if (item) await sendDiscordLog(item.data, 'Denied', item.submitter, item.first_reviewer, profile);

      await cancelPendingJutsu(id);
      await refreshPending();
    } catch (e) {
      alert('Cancel failed: ' + e.message);
    }
  };

  const handleReviewPending = async (id) => {
    try {
      if (!profile?.id) return;
      await reviewPendingJutsu(id, profile.id);
      await refreshPending();
    } catch (e) {
      alert('Review failed: ' + e.message);
    }
  };

  const handleEditPending = (pendingItem) => {
    setAdminForm({
      r: fromRowJutsu(pendingItem.data),
      tab: 'jutsus',
      isPendingEdit: true,
      pendingId: pendingItem.id
    });
  };

  const setPersonalTagsForJutsu = useCallback((jid, list) => {
    setPTags(prev => {
      const next = { ...prev };
      if (!list || list.length === 0) delete next[jid];
      else next[jid] = list;
      LS.set(STORAGE.TAGS, next);
      return next;
    });
  }, []);

  const handleCopy = (j) => {
    copyText(j.link, () => {
      setModals(m => ({ ...m, copiedId: j._id }));
      setTimeout(() => setModals(m => ({ ...m, copiedId: null })), 1500);
    });
    setCart(prev => prev.some(i => i._id === j._id) ? prev : [...prev, j]);
  };

  const fCount = useMemo(() => {
    let n = 0;
    ARRAY_FILTER_KEYS.forEach(k => n += f[k].length);
    BOOL_FILTER_KEYS.forEach(k  => n += f[k] ? 1 : 0);
    return n;
  }, [f]);

  const sortByCommon = useCallback((a, b) => {
    if (f.sort === 'az')      return a.name.localeCompare(b.name);
    if (f.sort === 'za')      return b.name.localeCompare(a.name);
    if (f.sort === 'oldest')  return getSortKey(a) - getSortKey(b);
    return getSortKey(b) - getSortKey(a); 
  }, [f.sort]);

  const sortByJutsu = useCallback((a, b) => {
    if (f.sort === 'rank_desc') return Math.max(0, ...toArray(b.rank).map(r => RANK_COST_NUM[r] || 0)) - Math.max(0, ...toArray(a.rank).map(r => RANK_COST_NUM[r] || 0));
    if (f.sort === 'rank_asc')  return Math.max(0, ...toArray(a.rank).map(r => RANK_COST_NUM[r] || 0)) - Math.max(0, ...toArray(b.rank).map(r => RANK_COST_NUM[r] || 0));
    return sortByCommon(a, b);
  }, [f.sort, sortByCommon]);

  const sortedBloodlines = useMemo(() => {
    return [...(db.bloodlines || [])].sort((a, b) => {
      if (f.sort === 'za')     return b.name.localeCompare(a.name);
      if (f.sort === 'oldest') return getSortKey(a) - getSortKey(b);
      if (f.sort === 'newest') return getSortKey(b) - getSortKey(a);
      return a.name.localeCompare(b.name);
    });
  }, [db.bloodlines, f.sort]);

  const sortedSpecs = useMemo(() => {
    const specs = db.specializations || [];
    if (f.sort === 'za')     return [...specs].sort((a, b) => b.localeCompare(a));
    if (f.sort === 'oldest') return [...specs];
    if (f.sort === 'newest') return [...specs].reverse();
    return [...specs].sort((a, b) => a.localeCompare(b));
  }, [db.specializations, f.sort]);

  const filtJ = useMemo(() => {
    const lowerQ = f.q.toLowerCase();
    return (db.jutsus || []).filter(j =>
      (!f.q || j.name.toLowerCase().includes(lowerQ)
            || toArray(j.custom_tags).some(t => t.toLowerCase().includes(lowerQ))
            || (j.bloodline || '').toLowerCase().includes(lowerQ)) &&
      (!f.nat.length || f.nat.some(n => toArray(j.nature).includes(n))) &&
      (!f.org.length || f.org.includes(j.origin)) &&
      (!f.spc.length || f.spc.some(s => toArray(j.spec).includes(s))) &&
      (!f.typ.length || f.typ.some(t => toArray(j.types).includes(t))) &&
      (!f.rnk.length || f.rnk.some(r => toArray(j.rank).includes(r))) &&
      (!f.bm.length  || f.bm.includes(j.bm_tier)) &&
      (!f.bl.length  || f.bl.includes(j.bloodline)) &&
      (!f.lck || j.locked)    && (!f.lim || j.limited)    && (!f.mul || j.multiRank) &&
      (!f.hLck || !j.locked)  && (!f.hLim || !j.limited)  && (!f.hMul || !j.multiRank) &&
      (!f.hMP  || !toArray(j.types).includes('Multi-Post')) &&
      (!f.hAsk || !getSlotStatus(j.slots).showAskStaff)
    ).sort(sortByJutsu);
  }, [db.jutsus, f, sortByJutsu]);

  if (loading) {
    return (
      <div className="w-full h-screen bg-slate-900 flex flex-col items-center justify-center gap-4">
        <div className="w-8 h-8 border-3 border-indigo-500 border-t-transparent rounded-full animate-spin"/>
        <p className="text-slate-400 text-sm font-semibold">Loading...</p>
      </div>
    );
  }

  const TABS = [
    { id: 'jutsus', label: 'Jutsus', count: (db.jutsus || []).length },
    ...(isStaff ? [{ id: 'pending', label: 'Pending', count: pendingJutsus.length, isPending: true }] : []),
  ];

  const switchTab = (tabId) => {
    setTab(tabId);
    setExpRow(null);
    clearF();
    setF(p => ({ ...p, sort: 'az', showFilters: false }));
  };

  return (
    <div className="w-full min-h-screen bg-slate-200 flex flex-col font-sans text-slate-900">

      {/* HEADER */}
      <div className="bg-slate-900 text-white p-4 sticky top-0 z-40 flex flex-col sm:flex-row justify-between items-center shadow-lg gap-3">
        <h1 className="text-lg font-bold tracking-widest uppercase flex items-center gap-2 w-full sm:w-auto justify-center sm:justify-start">
          <Icon n="Book" size={18} className="text-indigo-400" />
          <button onClick={() => setModals(m => ({ ...m, credits: true }))} className="hover:text-indigo-300">NARP Database</button>
        </h1>
        <div className="flex items-center gap-2 flex-wrap w-full sm:w-auto justify-center sm:justify-end pb-1 sm:pb-0">
          <div className="flex items-center gap-2">
            {isAdmin && (
              <button onClick={() => setModals(m => ({ ...m, system: true }))}
                      className="text-xs px-3 py-1.5 font-bold rounded-lg border border-slate-700 bg-slate-800 text-slate-200 hover:bg-slate-700 flex items-center gap-1.5 shrink-0">
                <Icon n="Settings" size={14}/>
                <span className="hidden sm:inline">System Tools</span>
              </button>
            )}
            {tab === 'jutsus' && (
              <div className="flex items-center bg-slate-800 p-1 rounded-lg border border-slate-700 mr-2 shrink-0">
                <button onClick={() => setViewMode('card')} className={`p-1.5 rounded-md ${viewMode === 'card' ? 'bg-indigo-600 text-white' : 'text-slate-400'}`}><Icon n="Grid" size={14}/></button>
                <button onClick={() => setViewMode('row')}  className={`p-1.5 rounded-md ${viewMode === 'row'  ? 'bg-indigo-600 text-white' : 'text-slate-400'}`}><Icon n="List" size={14}/></button>
              </div>
            )}
          </div>
          <UserMenu
            profile={profile}
            supabaseReady={supabaseReady}
            devRole={devRole}
            onToggleDevRole={() => setDevRole(r => r === 'admin' ? 'user' : 'admin')}
            onSignIn={handleSignIn}
            onSignOut={handleSignOut}
          />
        </div>
      </div>

      {/* FILTER BAR */}
      <FilterBar
        tab={tab} f={f} setF={setF}
        activeFilterCount={fCount}
        bloodlinesDb={sortedBloodlines}
        specOptions={sortedSpecs}
        clearF={clearF}
        isAdmin={tab === 'jutsus' ? (role !== 'guest') : isAdmin}
        onAdd={() => setAdminForm({ r: {}, tab: 'jutsus' })} />

      {/* TAB BAR */}
      {isStaff && (
        <div className="bg-white border-b border-slate-300 shadow-sm shrink-0 sticky top-[138px] sm:top-[72px] z-10">
          <div className="max-w-6xl mx-auto px-4 flex gap-1 pt-2 overflow-x-auto scrollbar-hide">
            {TABS.map(t => (
              <button key={t.id} onClick={() => switchTab(t.id)}
                      className={`px-4 py-3 text-sm font-bold whitespace-nowrap border-b-2 -mb-px flex items-center gap-2 ${tab === t.id ? 'border-indigo-600 text-indigo-700' : 'border-transparent text-slate-500 hover:text-slate-800'}`}>
                {t.label}
                <span className={`text-[10px] tabular-nums px-2 py-0.5 rounded-full ${tab === t.id ? 'bg-indigo-100' : 'bg-slate-100'}`}>{t.count}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* MAIN CONTENT */}
      <div className="flex-1 overflow-y-auto p-4 md:p-6 pb-20">
        {tab === 'jutsus' && (
          <div className="max-w-6xl mx-auto h-full">
            {filtJ.length === 0 ? (
              <div className="text-center py-16">
                <Icon n="Alert" size={40} className="text-slate-300 mx-auto mb-3" />
                <p className="text-slate-500 font-semibold mb-4">No jutsus match your filters.</p>
                <button onClick={clearF} className="bg-indigo-100 text-indigo-700 px-4 py-2 rounded-lg font-bold">Clear All Filters</button>
              </div>
            ) : (
              <>
                <div className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-4">{filtJ.length} Results</div>
                <div className={viewMode === 'card' ? 'grid gap-4 grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 items-stretch' : 'flex flex-col gap-2'}>
                  {filtJ.slice(0, 200).map(j => (
                    <JutsuCard key={j._id} j={j}
                               viewMode={viewMode} expRow={expRow} setExpRow={setExpRow}
                               pTags={pTags} setPersonalTagsForJutsu={setPersonalTagsForJutsu}
                               handleCopy={handleCopy} cart={cart} copiedId={modals.copiedId}
                               isAdmin={isStaff}
                               onEdit={() => setAdminForm({ r: j, tab: 'jutsus' })}
                               onDelete={() => setConfirmDel({ id: j._id, name: j.name })}
                               onViewSlots={(jutsu) => setSlotsView(jutsu)} />
                  ))}
                </div>
                {filtJ.length > 200 && (
                  <div className="mt-8 text-center text-sm font-semibold text-slate-500 bg-slate-200 py-3 rounded-xl">
                    Showing the first 200 results. Try adding filters or a search term to find what you're looking for.
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {tab === 'pending' && isStaff && (
          <div className="max-w-6xl mx-auto">
            {!pendingLoaded ? (
              <div className="text-center py-16 text-slate-400 text-sm font-semibold">Loading pending submissions...</div>
            ) : pendingJutsus.length === 0 ? (
              <div className="text-center py-16">
                <Icon n="CheckCir" size={40} className="text-emerald-300 mx-auto mb-3" />
                <p className="text-slate-500 font-semibold">All caught up — no pending submissions.</p>
              </div>
            ) : (
              <>
                <div className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-4">{pendingJutsus.length} Pending</div>
                <div className="grid gap-4 grid-cols-1 md:grid-cols-2 lg:grid-cols-3 items-start">
                  {pendingJutsus.map(p => {
                    const original = p.target_id ? (db.jutsus || []).find(j => j._id === p.target_id) : null;
                    return (
                      <PendingJutsuCard
                        key={p.id}
                        pending={p}
                        originalJutsu={original}
                        currentUserId={profile?.id}
                        isAdmin={isAdmin}
                        onApprove={handleApprovePending}
                        onCancel={handleCancelPending}
                        onReview={handleReviewPending}
                        onEdit={handleEditPending} />
                    );
                  })}
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {/* FOOTER */}
      <div className="bg-slate-900 text-center py-3 text-[10px] font-bold text-slate-500 uppercase tracking-widest shrink-0 flex items-center justify-center gap-2 relative z-30">
        <button onClick={() => setModals(m => ({ ...m, credits: true }))} className="hover:text-indigo-300 flex items-center gap-1.5">
          <Icon n="Info" size={11} /> Hexagon &amp; A Road Sign
        </button>
      </div>

      {/* MODALS */}
      {slotsView && (
        <SlotsViewModal jutsu={slotsView} onClose={() => setSlotsView(null)} />
      )}
      {adminForm     && (() => {
        const formTab = adminForm.tab || (MANAGE_TABLES[tab] ? tab : 'jutsus');
        return (
          <AdminFormModal
            tab={formTab}
            eRow={adminForm.r}
            onClose={() => setAdminForm(null)}
            db={db}
            onSubmit={submitChange}
            willGoToPending={formTab === 'jutsus' && (role === 'user' || role === 'staff') && !isAdmin && !adminForm.isPendingEdit}
          />
        );
      })()}
      {modals.system && (
        <SystemToolsModal
          db={db} setDb={setDb}
          onClose={() => setModals(m => ({ ...m, system: false }))}
          onRefresh={refreshDB}
          refreshing={refreshing}
          isOwner={isOwner}
          onOpenAuditLog={() => setModals(m => ({ ...m, audit: true }))}
          onManageBL={() => setModals(m => ({ ...m, manageBL: true }))} />
      )}
      {modals.audit && isAdmin && (
        <AuditLogModal onClose={() => setModals(m => ({ ...m, audit: false }))} />
      )}
      {modals.manageBL && isAdmin && (
        <CatalogManagementModal
          which="bloodlines"
          db={db}
          onClose={() => setModals(m => ({ ...m, manageBL: false }))}
          onAdd={() => setAdminForm({ r: {}, tab: 'bloodlines' })}
          onEdit={(item) => setAdminForm({ r: item, tab: 'bloodlines' })}
          onDelete={(item) => setConfirmDel({ id: item._id, name: item.name, tab: 'bloodlines' })} />
      )}


      {confirmDel && (() => {
        const effectiveTab = confirmDel.tab || tab;
        const isPendingDelete = effectiveTab === 'jutsus' && isStaff && !isAdmin;
        return (
          <div className="fixed inset-0 z-[100] bg-black/60 flex items-center justify-center p-4 animate-in fade-in" onClick={() => setConfirmDel(null)}>
            <div className="bg-white p-6 rounded-3xl max-w-sm w-full" onClick={e => e.stopPropagation()}>
              <h3 className="font-bold text-xl mb-2 text-slate-900">
                {isPendingDelete ? 'Submit deletion for approval?' : 'Confirm Deletion'}
              </h3>
              <p className="text-sm text-slate-600 mb-6">
                {isPendingDelete
                  ? `Your request to delete '${confirmDel.name || 'this entry'}' will need a second approval before it's removed.`
                  : `Are you sure you want to delete '${confirmDel.name || 'this entry'}'? This action cannot be undone.`}
              </p>
              <div className="flex gap-3">
                <button onClick={() => setConfirmDel(null)} className="flex-1 px-4 py-3 bg-slate-100 text-slate-700 font-bold rounded-xl hover:bg-slate-200">Cancel</button>
                <button onClick={async () => {
                          try {
                            await submitChange({ tab: effectiveTab, operation: 'delete', targetId: confirmDel.id, entity: null });
                          } catch (e) {
                            alert('Delete failed: ' + e.message);
                          }
                          setConfirmDel(null);
                        }}
                        className="flex-1 px-4 py-3 bg-red-600 text-white font-bold rounded-xl hover:bg-red-700 shadow-md">
                  {isPendingDelete ? 'Submit' : 'Delete'}
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {modals.credits && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4 animate-in fade-in" onClick={() => setModals(m => ({ ...m, credits: false }))}>
          <div className="bg-white rounded-3xl max-w-md w-full overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="bg-slate-900 text-white p-5 flex justify-between">
              <div className="flex items-center gap-2">
                <Icon n="Info" size={20} className="text-indigo-400" />
                <h3 className="font-bold text-lg">About</h3>
              </div>
              <button onClick={() => setModals(m => ({ ...m, credits: false }))}><Icon n="X" size={18} /></button>
            </div>
            <div className="p-6 space-y-4 text-sm text-slate-700">
              <p>Conceptualized by A Road Sign; Developed by Hexagon.</p>
              <div className="border-t pt-4">
                <p className="text-[10px] font-bold uppercase text-slate-400">Credits</p>
                <p className="font-semibold">Hexagon &amp; A Road Sign</p>
              </div>
            </div>
          </div>
        </div>
      )}

      <SessionListCart list={cart}
                       onClear={() => setCart([])}
                       onRemove={(id) => setCart(prev => prev.filter(x => x._id !== id))} />
    </div>
  );
}
