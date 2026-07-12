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
  setJutsuTypeTags as saveJutsuTypeTagsToSupabase,
  signInWithDiscord,
  signInWithDevAccess,
  signOut,
  getCurrentSession,
  onAuthChange,
  fetchMyProfile,
  updateMyUsername,
  updateMyWorkThreadId,
  setUserWorkThreadId,
  fetchAllProfiles,
  setUserRole,
  grantWandererTicket,
  consumeWandererTicket,
  fetchWhitelist,
  addToWhitelist,
  removeFromWhitelist,
  fetchPendingJutsus,
  submitPendingJutsu,
  sendReviewChat,
  reviewPendingJutsu,
  updatePendingJutsuData,
  subscribeToDatabaseChanges,
  approvePendingJutsu,
  cancelPendingJutsu,
  buildJutsuPayload,
  fromRowJutsu,
  fetchRoleChangeLog,
  fetchReviewChats,
  claimPendingSubmission,
  fetchWebhookConfig,
  saveWebhookConfig,
  fetchSubmissionControls,
  updateSubmissionControl,
  fetchChatOverview,
  fetchMyParticipatingChatIds,
  updateMySiteNickname,
  savePushSubscription,
  deletePushSubscription,
} from './lib/supabase';
import { isNotifEnabled, setNotifEnabled, requestNotifPermission, getNotifPermission, showChatNotification, subscribeToPush, unsubscribeFromPush } from './lib/notifications';
import { rolesForApprovedOC, applyDiscordRoles } from './lib/discordRoles';
import { getNetlifyImageUrl, getNetlifyImageSrcSet } from './utils/helpers';
import RosterPage from './pages/RosterPage';
import InboxPage from './pages/InboxPage';
import { JOIN_PREFIX } from './components/features/ReviewChat';


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
  CART:       'narp_cart_v1',
  CHAT_READ:  'narp_chat_read_v1',
};

/* ---------------------------------------------------------------------------
   CONSTANTS
   --------------------------------------------------------------------------- */
const SPECIALIZATION_OPTIONS = ['Bukijutsu', 'Fuinjutsu', 'Genjutsu', 'Medical Ninjutsu', 'Ninjutsu', 'Nintaijutsu', 'Taijutsu', 'Kinjutsu'];
const NATURES                = ['Fire', 'Water', 'Lightning', 'Earth', 'Wind', 'Yang', 'Yin', 'Sound'];
const JUTSU_TYPES            = ['1 Post', 'Continuous', 'Multi-Post', 'Battlemode'];
const JUTSU_TYPE_TAG_OPTIONS = ['Offensive', 'Defensive', 'Mobility', 'Utility', 'Sensory', 'Multi-Purpose'];
const RANKS                  = ['E', 'D', 'C', 'B', 'A', 'S'];
const ORIGIN                 = ['Canon', 'Custom'];
const BL_CATS                = ['Canon', 'Custom'];
const BL_SUBCATS             = ['KKG', 'Hiden', 'Dojutsu', 'Specialization', 'Other'];
const BM_TIERS               = ['Primary', 'Secondary', 'Tertiary'];
const BM_TIER_TO_RANK        = { Primary: 'A', Secondary: 'B', Tertiary: 'C' };

const RANK_COST_MAP = { E: '1 CU', D: '2 CU', C: '4 CU', B: '6 CU', A: '8 CU', S: '10 CU' };
const RANK_COST_NUM = { E: 1, D: 2, C: 4, B: 6, A: 8, S: 10 };

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
async function sendDiscordLog(itemData, actionType, submitterProfile, firstReviewerProfile, finalApproverProfile, chatTranscript = null, config = {}) {
  const baseUrl = import.meta.env.VITE_DISCORD_LOG_WEBHOOK_URL;
  if (!baseUrl) return; // Logging not configured — skip silently.

  const isCharacter = itemData?.type === 'Character';

  // Route to the correct forum thread — prefer DB config, fall back to env vars.
  let threadId = toArray(itemData?.types).includes('Battlemode')
    ? (config.discord_battlemode_thread_id || import.meta.env.VITE_DISCORD_BATTLEMODE_THREAD_ID)
    : (config.discord_jutsu_thread_id     || import.meta.env.VITE_DISCORD_JUTSU_THREAD_ID);

  if (isCharacter) {
    threadId = config.discord_oc_thread_id || import.meta.env.VITE_DISCORD_OC_THREAD_ID;
  } else if (itemData?.type === 'Summon') {
    threadId = config.discord_summon_thread_id || import.meta.env.VITE_DISCORD_SUMMON_THREAD_ID;
  } else if (itemData?.type === 'Custom Item') {
    threadId = config.discord_custom_item_thread_id || import.meta.env.VITE_DISCORD_CUSTOM_ITEM_THREAD_ID;
  }

  // Format a profile into a Discord mention, falling back to plain @username.
  const ping = (profile) => {
    if (!profile) return 'Unknown';
    if (profile.discord_id) return `<@${profile.discord_id}>`;
    return `@${profile.username || 'unknown'}`;
  };

  // Determine pings
  const creatorPing = ping(submitterProfile);
  const reviewerPing = firstReviewerProfile ? ping(firstReviewerProfile) : ping(submitterProfile);
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

  const isSummonOrItem = itemData?.type === 'Summon' || itemData?.type === 'Custom Item';

  let description;
  if (isCharacter) {
    const characterDesc = [
      `**Name Entry Creator:** ${creatorPing}`,
      `**Name Reviewer:** ${reviewerPing}`,
      `**Name 2nd pair of eyes reviewer:** ${secondEyes}`,
      '',
      `**Decision:** ${decision}`,
      '',
      '**OC Details:**',
      `Type of Submission: Character`,
      `Link to sheet: ${linkVal}`,
    ];
    if (itemData?.myCharactersLink) {
      characterDesc.push(`My-Characters Link: ${itemData.myCharactersLink}`);
    }
    if (itemData?.upgradesLink) {
      characterDesc.push(`Upgrades Link: ${itemData.upgradesLink}`);
    }
    characterDesc.push(
      '',
      '**Dates:**',
      `Creation Date: ${creationDate}`,
      `Approval Date: ${approvalDate}`
    );
    description = characterDesc.join('\n');
  } else if (isSummonOrItem) {
    const entryLabel = itemData.type === 'Summon' ? 'Summon Contract Names' : 'Item Names';
    description = [
      `**Name Entry Creator:** ${creatorPing}`,
      `**${entryLabel}:** ${itemData?.name || 'N/A'}`,
      `**Name Reviewer:** ${reviewerPing}`,
      `**Name 2nd pair of eyes reviewer:** ${secondEyes}`,
      '',
      `**Decision:** ${decision}`,
      '',
      '**Link to sheet:**',
      `${linkVal}`,
      '',
      '**Dates:**',
      `Creation Date: ${creationDate}`,
      `Approval Date: ${approvalDate}`,
    ].join('\n');
  } else {
    description = [
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
  }

  const embedTitle = isSummonOrItem
    ? `${itemData.type}${itemData?.name ? `: ${itemData.name}` : ''}`
    : (isCharacter ? 'OC Submission' : (itemData?.name || 'Jutsu Entry'));

  const payload = {
    embeds: [{
      title: embedTitle,
      description,
      color,
    }],
  };

  const nameSlug = (itemData?.name || 'entry')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');

  try {
    const sess = await getCurrentSession();
    const authHdr = sess?.access_token ? { Authorization: `Bearer ${sess.access_token}` } : {};

    const res = await fetch('/.netlify/functions/send-discord-log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHdr },
      body: JSON.stringify({
        threadId,
        payload,
        docUrl: itemData?.link || '',
        docName: nameSlug || 'entry',
        chatTranscript: chatTranscript || null,
      }),
    });

    if (!res.ok) throw new Error(`Discord log function returned ${res.status}`);
    const data = await res.json();
    return { messageId: data.messageId, threadId: data.threadId ?? threadId };
  } catch (err) {
    // Never let a logging failure block the underlying database action.
    console.warn('[NARP] Discord log failed:', err);
    return null;
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
  jutsuTypeTags:   JUTSU_TYPE_TAG_OPTIONS,
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
      { k: 'types',       l: 'Jutsu Category',  t: 'chip', opts: JUTSU_TYPES, multi: true, col: 1 },
      { k: 'jutsu_type',  l: 'Jutsu Type',      t: 'ttag-dd', col: 1 },
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

const normalizeDB = (d) => ({
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

const loadDB = async () => {
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

/* ============================================================================
   COMPONENT: BloodlineDropdown
   ============================================================================ */

/* Compute fixed-position style for a dropdown panel from the trigger button rect. */
function computeDropdownPos(triggerEl, maxH) {
  if (!triggerEl) return { top: 0, left: 0, width: 200, maxHeight: maxH };
  const rect = triggerEl.getBoundingClientRect();
  const spaceBelow = window.innerHeight - rect.bottom - 8;
  const spaceAbove = rect.top - 8;
  const openUp = spaceBelow < 200 && spaceAbove > spaceBelow;
  const clampedLeft = Math.min(rect.left, window.innerWidth - rect.width - 8);
  const left = Math.max(8, clampedLeft);
  return openUp
    ? { bottom: window.innerHeight - rect.top + 4, left, width: rect.width, maxHeight: Math.min(spaceAbove, maxH) }
    : { top: rect.bottom + 4, left, width: rect.width, maxHeight: Math.min(spaceBelow, maxH) };
}

function BloodlineDropdown({ l, sel, onChange, placeholder, bloodlinesDb, isOpen, onToggle, isMulti = true }) {
  const [fCat, setFCat] = useState('All');
  const [fSub, setFSub] = useState('All');
  const [str,  setStr]  = useState('');
  const triggerRef = useRef(null);
  const panelRef = useRef(null);
  const [panelStyle, setPanelStyle] = useState({});

  const handleToggle = useCallback(() => {
    if (!isOpen) setPanelStyle(computeDropdownPos(triggerRef.current, 384));
    onToggle();
  }, [isOpen, onToggle]);

  useEffect(() => {
    if (!isOpen) return;
    const close = (e) => {
      if (panelRef.current && panelRef.current.contains(e.target)) return;
      onToggle();
    };
    window.addEventListener('scroll', close, { capture: true, passive: true });
    return () => window.removeEventListener('scroll', close, { capture: true });
  }, [isOpen, onToggle]);

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

      <button ref={triggerRef} type="button" onClick={handleToggle}
              className="w-full text-sm bg-white border border-slate-200 rounded-xl p-3.5 text-left flex items-center justify-between shadow-sm hover:border-indigo-400">
        <span className={count ? (isMulti ? 'text-indigo-700' : 'text-slate-800') + ' font-bold' : 'text-slate-500'}>
          {buttonLabel}
        </span>
        <Icon n="Down" size={16} className={`text-slate-400 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {isOpen && (
        <div ref={panelRef} style={{ position: 'fixed', zIndex: 9999, ...panelStyle }}
             className="bg-white border border-slate-200 rounded-xl shadow-2xl flex flex-col overflow-hidden">
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
                    <div className={`w-5 h-5 rounded flex items-center justify-center border transition-colors shrink-0 ${isSel ? 'bg-indigo-600 border-indigo-600 text-white' : 'bg-white border-slate-300 text-transparent'}`}>
                      <Icon n="Check" size={14}/>
                    </div>
                  )}
                  <input type="checkbox" checked={isSel} onChange={() => toggle(b.name)} className="hidden" />
                  <div className="flex flex-col min-w-0">
                    <span className={`text-sm truncate ${isSel ? 'font-bold text-indigo-900' : 'font-medium text-slate-700'}`}>{b.name}</span>
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
  const triggerRef = useRef(null);
  const [panelStyle, setPanelStyle] = useState({});
  const arr = sel || [];
  const filtered = str ? opts.filter(o => (o.label || o).toLowerCase().includes(str.toLowerCase())) : opts;
  const toggle = (v) => onChange(arr.includes(v) ? arr.filter(x => x !== v) : [...arr, v]);
  const panelRef = useRef(null);

  const handleToggle = useCallback(() => {
    if (!isOpen) setPanelStyle(computeDropdownPos(triggerRef.current, 288));
    onToggle();
  }, [isOpen, onToggle]);

  useEffect(() => {
    if (!isOpen) return;
    const close = (e) => {
      if (panelRef.current && panelRef.current.contains(e.target)) return;
      onToggle();
    };
    window.addEventListener('scroll', close, { capture: true, passive: true });
    return () => window.removeEventListener('scroll', close, { capture: true });
  }, [isOpen, onToggle]);

  return (
    <div className="relative flex flex-col w-full">
      {l && <label className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-2">{l}</label>}

      <button ref={triggerRef} type="button" onClick={handleToggle}
              className="w-full text-sm bg-white border border-slate-200 rounded-xl p-3.5 text-left flex items-center justify-between shadow-sm hover:border-indigo-400">
        <span className={arr.length ? 'text-indigo-700 font-bold' : 'text-slate-500'}>
          {!arr.length ? placeholder : arr.length === 1 ? (arr[0].label || arr[0]) : `${arr.length} selected`}
        </span>
        <Icon n="Down" size={16} className={`text-slate-400 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {isOpen && (
        <div ref={panelRef} style={{ position: 'fixed', zIndex: 9999, ...panelStyle }}
             className="bg-white border border-slate-200 rounded-xl shadow-2xl flex flex-col overflow-hidden">
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
                  <div className={`w-5 h-5 rounded flex items-center justify-center border transition-colors shrink-0 ${isSel ? 'bg-indigo-600 border-indigo-600 text-white' : 'bg-white border-slate-300 text-transparent'}`}>
                    <Icon n="Check" size={14}/>
                  </div>
                  <input type="checkbox" checked={isSel} onChange={() => toggle(value)} className="hidden" />
                  <span className="text-sm font-medium text-slate-600 truncate">{label}</span>
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
function JutsuCard({ j, viewMode, expRow, setExpRow, pTags, setPersonalTagsForJutsu, handleCopy, cart, copiedId, isAdmin, onEdit, onDelete, onViewSlots, isActualAdmin = false }) {
  const isExpanded = viewMode === 'card' || expRow === j._id;
  const rArr  = toArray(j.rank).slice().sort((a, b) => (RANK_COST_NUM[a] || 0) - (RANK_COST_NUM[b] || 0));
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
    j.limited &&  showAskStaff     && { l: 'Ask a Reviewer',        c: 'bg-amber-100 text-amber-800 border-amber-300' },
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
            ? <span className="text-[10px] font-bold uppercase text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded border border-amber-200 hidden sm:inline mr-3">Ask a Reviewer</span>
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
          {toArray(j.jutsu_type).map((s, i) => (
            <span key={`jty-${i}`} className="text-xs font-semibold text-sky-700 bg-sky-50 px-2.5 py-1 rounded-md border border-sky-200">
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
              {isActualAdmin && (
                <button onClick={() => setPersonalTagsForJutsu(j._id, myTags.filter(x => x !== t))}
                        className="opacity-40 hover:text-red-600 hover:opacity-100 transition-opacity">×</button>
              )}
            </span>
          ))}
          
          {/* Tag Add Button */}
          {isActualAdmin && (
            tagging ? (
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
            )
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
              <span className="flex-1 bg-slate-50 text-slate-400 font-bold py-2.5 rounded-xl flex justify-center text-sm border border-slate-100">No Link</span>
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
      const ranks = toArray(j.rank).slice().sort((a, b) => (RANK_COST_NUM[a] || 0) - (RANK_COST_NUM[b] || 0));

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
  { showKey: 'pve', hideKey: 'hPve', label: 'Pve'        },
  { showKey: 'mul', hideKey: 'hMul', label: 'Multi-Rank' },
];
const HIDE_ONLY = [
  { hideKey: 'hMP',  label: 'Multi-Post' },
  { hideKey: 'hAsk', label: 'Ask Reviewer'  },
];

function FilterBar({ tab, f, setF, activeFilterCount, bloodlinesDb, specOptions, clearF, isAdmin, onAdd, onOpenStatelessSubmission, submissionControls }) {
  const [ddOpen, setDdOpen] = useState(null);
  const toggleArr = (key, value) =>
    setF(p => ({ ...p, [key]: p[key].includes(value) ? p[key].filter(x => x !== value) : [...p[key], value] }));

  const [addDdOpen, setAddDdOpen] = useState(false);
  const addDdRef = useRef(null);

  useEffect(() => {
    if (!addDdOpen) return;
    const handleOutsideClick = (e) => {
      if (addDdRef.current && !addDdRef.current.contains(e.target)) {
        setAddDdOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutsideClick);
    document.addEventListener('touchstart', handleOutsideClick);
    return () => {
      document.removeEventListener('mousedown', handleOutsideClick);
      document.removeEventListener('touchstart', handleOutsideClick);
    };
  }, [addDdOpen]);

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
      <div className="bg-black text-white p-4 shadow-md z-30 shrink-0">
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
              <div className="relative shrink-0" ref={addDdRef}>
                <button onClick={() => setAddDdOpen(!addDdOpen)}
                        className="px-5 py-2.5 rounded-xl text-sm font-bold flex items-center justify-center gap-2 transition-all shrink-0 bg-slate-800 text-white hover:bg-slate-700 shadow-lg">
                  <Icon n="PlusCir" size={16} /> <span className="hidden sm:inline">Add</span> <Icon n="Down" size={12} className="text-white opacity-80" />
                </button>
                {addDdOpen && (
                  <div className="absolute right-0 mt-2 w-64 bg-white rounded-xl shadow-xl border border-slate-200 z-50 overflow-hidden py-1">
                    {submissionControls?.jutsu_paused ? (
                      <div className="w-full text-left px-4 py-2.5 text-sm font-semibold text-rose-500 flex items-center gap-2 cursor-default select-none">
                        <Icon n="Lock" size={14} className="text-rose-400 shrink-0" />
                        <span>Jutsu / Battlemode <span className="text-[10px] font-bold uppercase tracking-wide text-rose-400 ml-1">Paused</span></span>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => { setAddDdOpen(false); onAdd(); }}
                        className="w-full text-left px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 flex items-center gap-2"
                      >
                        <Icon n="PlusCir" size={14} className="text-indigo-500" /> Jutsu / Battlemode
                      </button>
                    )}
                    <div className="border-t border-slate-100">
                      {submissionControls?.character_paused ? (
                        <div className="w-full text-left px-4 py-2.5 text-sm font-semibold text-rose-500 flex items-center gap-2 cursor-default select-none opacity-70">
                          <Icon n="Lock" size={14} className="text-rose-400 shrink-0" />
                          <span>OC Submission <span className="text-[10px] font-bold uppercase tracking-wide text-rose-400 ml-1">Paused</span></span>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => { setAddDdOpen(false); onOpenStatelessSubmission('Character'); }}
                          className="w-full text-left px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 flex items-center gap-2"
                        >
                          <Icon n="PlusCir" size={14} className="text-emerald-500" /> OC Submission
                        </button>
                      )}
                    </div>
                    <div className="border-t border-slate-100">
                      {submissionControls?.summon_paused ? (
                        <div className="w-full text-left px-4 py-2.5 text-sm font-semibold text-rose-500 flex items-center gap-2 cursor-default select-none opacity-70">
                          <Icon n="Lock" size={14} className="text-rose-400 shrink-0" />
                          <span>Summon <span className="text-[10px] font-bold uppercase tracking-wide text-rose-400 ml-1">Paused</span></span>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => { setAddDdOpen(false); onOpenStatelessSubmission('Summon'); }}
                          className="w-full text-left px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 flex items-center gap-2"
                        >
                          <Icon n="PlusCir" size={14} className="text-amber-400" /> Summon
                        </button>
                      )}
                    </div>
                    <div className="border-t border-slate-100">
                      {submissionControls?.custom_item_paused ? (
                        <div className="w-full text-left px-4 py-2.5 text-sm font-semibold text-rose-500 flex items-center gap-2 cursor-default select-none opacity-70">
                          <Icon n="Lock" size={14} className="text-rose-400 shrink-0" />
                          <span>Custom Item <span className="text-[10px] font-bold uppercase tracking-wide text-rose-400 ml-1">Paused</span></span>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => { setAddDdOpen(false); onOpenStatelessSubmission('Custom Item'); }}
                          className="w-full text-left px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 flex items-center gap-2"
                        >
                          <Icon n="PlusCir" size={14} className="text-purple-400" /> Custom Item
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {activeFilterCount > 0 && (
            <div className="flex flex-wrap items-center gap-2 pt-1 pb-1">
              <span className="text-xs font-bold text-slate-400 mr-1 shrink-0 uppercase tracking-widest">Active:</span>
              {['nat', 'rnk', 'typ', 'spc', 'org', 'bl', 'bm', 'jty'].map(k =>
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

    </>
  );
}

/* ============================================================================
   COMPONENT: FilterBarPanel
   Rendered OUTSIDE the sticky header so it sits in normal document flow.
   This eliminates layout reflow on open (scroll delay) and lets the fixed-
   position dropdown panels escape the viewport freely.
   ============================================================================ */
function FilterBarPanel({ tab, f, setF, bloodlinesDb, specOptions, jutsuTypeTagOptions }) {
  const [ddOpen, setDdOpen] = useState(null);
  const toggleArr = (key, value) =>
    setF(p => ({ ...p, [key]: p[key].includes(value) ? p[key].filter(x => x !== value) : [...p[key], value] }));

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

  if (!f.showFilters || tab !== 'jutsus') return null;

  return (
    <div className="bg-slate-50 border-b border-slate-200 p-6 md:p-8">
      <div className="max-w-6xl mx-auto space-y-10">
        <div>
          <h3 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-5 border-b border-slate-200 pb-2">Basic Properties</h3>
          <div className="space-y-6">
            <ChipFilter title="Nature"        values={NATURES}     fKey="nat" />
            <ChipFilter title="Jutsu Category" values={JUTSU_TYPES} fKey="typ" />
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
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 max-w-5xl">
            <GenericDropdown
              l="Specialization" placeholder="Any Specialization"
              opts={specOptions.map(s => ({ value: s, label: s }))}
              sel={f.spc} onChange={v => setF(p => ({ ...p, spc: v }))}
              isOpen={ddOpen === 'f_spc'} onToggle={() => setDdOpen(ddOpen === 'f_spc' ? null : 'f_spc')} />
            <GenericDropdown
              l="Jutsu Type" placeholder="Any Jutsu Type"
              opts={jutsuTypeTagOptions.map(s => ({ value: s, label: s }))}
              sel={f.jty} onChange={v => setF(p => ({ ...p, jty: v }))}
              isOpen={ddOpen === 'f_jty'} onToggle={() => setDdOpen(ddOpen === 'f_jty' ? null : 'f_jty')} />
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
  );
}

/* ============================================================================
   MODAL: StatelessSubmissionModal
   ============================================================================ */
function StatelessSubmissionModal({ type, profile, onClose, isAdmin, onDirectUpload, onAfterSubmit }) {
  const [link, setLink] = useState('');
  const [name, setName] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const isCharacter = type === 'Character';
  const nameLabel = type === 'Summon' ? 'Summon Contract Name' : type === 'Custom Item' ? 'Item Name' : 'Entry Name';
  const submitDisabled = !link.trim() || (!isCharacter && !name.trim()) || submitting;

  const buildData = () => isCharacter
    ? { type: 'Character', link, name: 'OC Submission' }
    : { type, name: name.trim(), link: link.trim() };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (submitDisabled) return;

    setSubmitting(true);
    try {
      const data = buildData();
      await submitPendingJutsu('insert', null, data, 'pending_review');

      fetch('/.netlify/functions/reviewer-ping', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          triggerType: 'creation',
          itemName: data.name,
          itemType: isCharacter ? 'Character' : type,
          submitterName: profile?.username || 'Unknown',
        }),
      }).catch((pingErr) => {
        console.warn('[NARP] Reviewer ping creation alert failed:', pingErr);
      });

      if (onAfterSubmit) onAfterSubmit();
      onClose();
    } catch (err) {
      console.error('[NARP] Failed to submit log:', err);
      alert('Submission failed: ' + (err.message || err));
    } finally {
      setSubmitting(false);
    }
  };

  const handleDirectUpload = async () => {
    if (submitDisabled || !onDirectUpload) return;
    setSubmitting(true);
    try {
      await onDirectUpload(buildData());
      onClose();
    } catch (err) {
      console.error('[NARP] Direct upload failed:', err);
      alert('Direct upload failed: ' + (err.message || err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[80] bg-black/60 flex items-center justify-center p-4 animate-in fade-in" onClick={onClose}>
      <div className="bg-white rounded-3xl max-w-lg w-full overflow-hidden max-h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="bg-slate-900 text-white p-5 flex justify-between items-center shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <Icon n="PlusCir" size={18} className="text-indigo-400 shrink-0" />
            <h2 className="font-serif font-bold text-base truncate">Submit {type}</h2>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white transition-colors">
            <Icon n="X" size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-5 space-y-4">
          {!isCharacter && (
            <div>
              <label className="text-xs font-bold text-slate-500 uppercase tracking-widest block mb-1.5">{nameLabel} (Mandatory)</label>
              <input
                type="text"
                required
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder={type === 'Summon' ? 'e.g. Shadow Wolves' : 'e.g. Chakra Blade'}
                className="w-full text-sm border border-slate-300 bg-white rounded-xl px-3 py-2 text-slate-800 focus:outline-none focus:border-indigo-500"
              />
            </div>
          )}
          <div>
            <label className="text-xs font-bold text-slate-500 uppercase tracking-widest block mb-1.5">Document Link (Mandatory)</label>
            <input
              type="url"
              required
              value={link}
              onChange={e => setLink(e.target.value)}
              placeholder="https://docs.google.com/..."
              className="w-full text-sm border border-slate-300 bg-white rounded-xl px-3 py-2 text-slate-800 focus:outline-none focus:border-indigo-500"
            />
          </div>

          <div className="flex justify-end gap-3 pt-2 border-t border-slate-100 shrink-0">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm font-bold text-slate-600 hover:bg-slate-50 rounded-xl transition-colors"
            >
              Cancel
            </button>
            {isAdmin && !isCharacter && onDirectUpload && (
              <button
                type="button"
                onClick={handleDirectUpload}
                disabled={submitDisabled}
                className="px-5 py-2.5 rounded-xl text-sm font-bold transition-all shadow-md bg-amber-500 hover:bg-amber-600 text-white disabled:opacity-50 disabled:cursor-not-allowed"
                title="Log & approve immediately without pending review"
              >
                {submitting ? 'Uploading...' : 'Direct Upload'}
              </button>
            )}
            <button
              type="submit"
              disabled={submitDisabled}
              className="px-5 py-2.5 rounded-xl text-sm font-bold transition-all shadow-md bg-indigo-600 hover:bg-indigo-700 text-white disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {submitting ? 'Submitting...' : 'Submit for Review'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* ============================================================================
   MODAL: OCSubmissionModal — original character submissions.
   Rank cards show server-wide need, village cards suggest where the picked
   rank is scarcest, and the bloodline picker enforces slot capacity:
   full bloodlines are blocked, bloodlines with ≤2 open slots turn the
   submission into a "Réservation Request" that staff must grant.
   ============================================================================ */
const OC_RANKS = ['Genin', 'Chūnin', 'Special Jōnin', 'Jōnin'];
const OC_RANK_KEY = { 'Genin': 'genin', 'Chūnin': 'chunin', 'Special Jōnin': 'specialJonin', 'Jōnin': 'jonin' };
const OC_VILLAGES = [
  { id: 'konoha', name: 'Konohagakure' },
  { id: 'kumo',   name: 'Kumogakure' },
  { id: 'kiri',   name: 'Kirigakure' },
];
const CLANLESS = 'Clanless';

// Slot capacity summary for a bloodline row (app-shape, slots as JSON string).
// Reserved placeholder slots have a username, so they count as occupied —
// a bloodline whose last slot is reserved reads as full.
const getBloodlineSlotInfo = (bl) => {
  const { parsed } = getSlotStatus(bl.slots);
  const unlimited = Number(bl.max_slots) === -1 || (bl.name || '').trim().toLowerCase() === 'clanless';
  if (unlimited) return { unlimited: true, status: 'open', remaining: Infinity };
  const capacity = parsed.length > 0 ? parsed.length : Number(bl.max_slots ?? 5);
  const filled = parsed.filter(s => s?.username).length;
  const remaining = Math.max(0, capacity - filled);
  return {
    unlimited: false,
    capacity,
    filled,
    remaining,
    status: capacity <= 0 ? 'open' : remaining === 0 ? 'full' : remaining <= 2 ? 'limited' : 'open',
  };
};

const OC_NEED_BADGES = {
  empty:    { label: 'Most Needed',    cls: 'bg-rose-100 text-rose-700 border-rose-200' },
  critical: { label: 'Most Needed',    cls: 'bg-rose-100 text-rose-700 border-rose-200' },
  moderate: { label: 'Could Use More', cls: 'bg-amber-100 text-amber-700 border-amber-200' },
  healthy:  { label: 'Healthy',        cls: 'bg-emerald-100 text-emerald-700 border-emerald-200' },
  surplus:  { label: 'Well Stocked',   cls: 'bg-slate-100 text-slate-500 border-slate-200' },
};

const ocNeedLevel = (val, max) => {
  if (val === 0) return 'empty';
  const r = max > 0 ? val / max : 1;
  if (r <= 0.4) return 'critical';
  if (r <= 0.7) return 'moderate';
  if (r <= 0.9) return 'healthy';
  return 'surplus';
};

function OCSubmissionModal({ profile, bloodlines, onClose, onAfterSubmit, editPending = null, onSavedEdit = null }) {
  const initial = editPending?.data || {};
  const [name, setName] = useState(initial.name || '');
  const [link, setLink] = useState(initial.link || '');
  const [ninjaRank, setNinjaRank] = useState(initial.ninja_rank || '');
  const [village, setVillage] = useState(initial.village || '');
  const [bloodline, setBloodline] = useState(initial.bloodline || CLANLESS);
  const [squadChoice, setSquadChoice] = useState(() =>
    initial.squad_number ? { number: Number(initial.squad_number), isNew: !!initial.squad_is_new } : null
  );
  const [mentorSquad, setMentorSquad] = useState(initial.mentor_squad_number ? String(initial.mentor_squad_number) : '');
  const [councilor, setCouncilor] = useState(!!initial.councilor);
  const [ocNumber, setOcNumber] = useState(initial.oc_number ? Number(initial.oc_number) : 0);
  const [submitting, setSubmitting] = useState(false);
  const [rosterCounts, setRosterCounts] = useState(null);
  const [rosterSquads, setRosterSquads] = useState([]);

  const isEdit = !!editPending;
  // Wanderer is not a pickable option for ordinary users — an admin has to
  // grant a one-time ticket first (after the user cleared it with them in
  // Discord). Editing an existing Wanderer submission stays allowed even
  // without a ticket, since the ticket was already spent to create it.
  const hasWandererTicket = isEdit ? initial.village === 'Wanderer' : !!profile?.wanderer_ticket;

  // Population per village per rank, straight from the public roster tables.
  useEffect(() => {
    if (!supabase) return;
    (async () => {
      try {
        const [{ data: e }, { data: s }] = await Promise.all([
          supabase.from('roster_entries').select('roster_type, status'),
          supabase.from('roster_squads').select('village, squad_type, squad_number, role, name, status'),
        ]);
        const entries = (e || []).filter(x => x.status !== 'pending');
        const squadRows = (s || []).filter(x => x.status !== 'pending');
        const counts = {};
        for (const v of OC_VILLAGES) {
          counts[v.id] = {
            jonin:        entries.filter(x => x.roster_type === `${v.id}_jonin`).length,
            specialJonin: entries.filter(x => x.roster_type === `${v.id}_special_jonin`).length,
            chunin:       squadRows.filter(x => x.village === v.id && x.squad_type === 'chunin' && x.role === 'member').length,
            genin:        squadRows.filter(x => x.village === v.id && x.squad_type === 'genin'  && x.role === 'genin').length,
          };
        }
        setRosterCounts(counts);
        setRosterSquads(squadRows);
      } catch (err) {
        console.warn('[NARP] OC roster stats fetch failed:', err);
      }
    })();
  }, []);

  /* ---- Squad interaction ------------------------------------------------ */
  const isWanderer = village === 'Wanderer';
  const villageId = OC_VILLAGES.find(v => v.name === village)?.id || null;
  // Genin and Chūnin join (or start) a squad of their own rank. Wanderers
  // live outside the village system — no squads, mentoring, or council.
  const squadType = !isWanderer && (ninjaRank === 'Genin' ? 'genin' : ninjaRank === 'Chūnin' ? 'chunin' : null);
  const memberRole = squadType === 'genin' ? 'genin' : 'member';

  // Squads of the relevant type in the chosen village, with member counts.
  // The squad with the fewest members needs recruits the most → recommended.
  const squadGroups = useMemo(() => {
    if (!villageId || !squadType) return [];
    const byNum = new Map();
    for (const s of rosterSquads) {
      if (s.village !== villageId || s.squad_type !== squadType) continue;
      let g = byNum.get(s.squad_number);
      if (!g) { g = { number: s.squad_number, members: 0, captain: null }; byNum.set(s.squad_number, g); }
      if (s.role === memberRole || s.role === 'part_time') g.members += 1;
      if (s.role === 'captain') g.captain = s.name;
    }
    return [...byNum.values()].sort((a, b) => a.number - b.number);
  }, [rosterSquads, villageId, squadType, memberRole]);

  const recommendedSquad = useMemo(() => {
    if (!squadGroups.length) return null;
    return squadGroups.reduce((min, g) => (g.members < min.members ? g : min), squadGroups[0]).number;
  }, [squadGroups]);

  const nextSquadNumber = squadGroups.length ? Math.max(...squadGroups.map(g => g.number)) + 1 : 1;

  // Captainless genin squads the new Jōnin / Special Jōnin could mentor.
  const mentorableSquads = useMemo(() => {
    if (!villageId || (ninjaRank !== 'Jōnin' && ninjaRank !== 'Special Jōnin')) return [];
    const byNum = new Map();
    for (const s of rosterSquads) {
      if (s.village !== villageId || s.squad_type !== 'genin') continue;
      let g = byNum.get(s.squad_number);
      if (!g) { g = { number: s.squad_number, members: 0, hasCaptain: false }; byNum.set(s.squad_number, g); }
      if (s.role === 'genin' || s.role === 'part_time') g.members += 1;
      if (s.role === 'captain') g.hasCaptain = true;
    }
    return [...byNum.values()].filter(g => !g.hasCaptain).sort((a, b) => a.number - b.number);
  }, [rosterSquads, villageId, ninjaRank]);

  // Rank or village change invalidates the squad-related picks.
  const pickRank = (r) => { setNinjaRank(r); setSquadChoice(null); setMentorSquad(''); if (r !== 'Jōnin') setCouncilor(false); };
  const pickVillage = (name) => { setVillage(name); setSquadChoice(null); setMentorSquad(''); if (name === 'Wanderer') setCouncilor(false); };

  const rankTotals = useMemo(() => {
    if (!rosterCounts) return null;
    const totals = {};
    OC_RANKS.forEach(r => {
      const key = OC_RANK_KEY[r];
      totals[r] = OC_VILLAGES.reduce((sum, v) => sum + (rosterCounts[v.id]?.[key] || 0), 0);
    });
    return totals;
  }, [rosterCounts]);
  const rankMax = rankTotals ? Math.max(...Object.values(rankTotals)) : 0;

  // Village with the fewest characters of the chosen rank = suggested pick.
  const suggestedVillage = useMemo(() => {
    if (!rosterCounts || !ninjaRank) return null;
    const key = OC_RANK_KEY[ninjaRank];
    let best = null;
    for (const v of OC_VILLAGES) {
      const val = rosterCounts[v.id]?.[key] || 0;
      if (!best || val < best.val) best = { name: v.name, val };
    }
    return best?.name || null;
  }, [rosterCounts, ninjaRank]);

  // Deduplicate bloodlines by name and compute slot status for the picker.
  const bloodlineOptions = useMemo(() => {
    const seen = new Set([CLANLESS.toLowerCase()]);
    const opts = [];
    for (const bl of bloodlines || []) {
      const key = (bl.name || '').trim().toLowerCase();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      opts.push({ name: bl.name, info: getBloodlineSlotInfo(bl) });
    }
    return opts.sort((a, b) => a.name.localeCompare(b.name));
  }, [bloodlines]);

  const selectedInfo = bloodline === CLANLESS
    ? { unlimited: true, status: 'open', remaining: Infinity }
    : (bloodlineOptions.find(o => o.name === bloodline)?.info || { status: 'open', remaining: Infinity });

  const needsReservation = !isEdit && selectedInfo.status === 'limited';
  const bloodlineFull = selectedInfo.status === 'full';

  const squadRequired = !!squadType && !!village;
  const submitDisabled = !name.trim() || !link.trim() || !ninjaRank || !village || !ocNumber
    || (squadRequired && !squadChoice) || bloodlineFull || submitting;

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (submitDisabled) return;
    setSubmitting(true);
    try {
      const squadFields = {
        squad_type: squadType || null,
        squad_number: squadType && squadChoice ? squadChoice.number : null,
        squad_is_new: squadType && squadChoice ? !!squadChoice.isNew : false,
        mentor_squad_number: !isWanderer && (ninjaRank === 'Jōnin' || ninjaRank === 'Special Jōnin') && mentorSquad ? Number(mentorSquad) : null,
        councilor: !isWanderer && ninjaRank === 'Jōnin' ? councilor : false,
        oc_number: ocNumber || null,
      };

      if (isEdit) {
        // Reviewer edit: overwrite the entry fields, keep workflow fields
        // (reservation state, final-step links, etc.) untouched.
        await onSavedEdit({
          ...editPending.data,
          name: name.trim(),
          link: link.trim(),
          ninja_rank: ninjaRank,
          village,
          bloodline,
          ...squadFields,
        });
        onClose();
        return;
      }

      // Wanderer is ticket-gated: the ticket is spent right here, at
      // submission time, not at approval — cancelling afterward does not
      // refund it, so a stolen/duplicate submit attempt can't consume it
      // twice and a legitimate submit can't slip through without one.
      if (isWanderer) {
        const consumed = await consumeWandererTicket();
        if (!consumed) {
          alert('You don’t have a Wanderer ticket. Ask an admin in Discord for one before submitting a Wanderer OC.');
          setSubmitting(false);
          return;
        }
      }

      const data = {
        type: 'Character',
        name: name.trim(),
        link: link.trim(),
        ninja_rank: ninjaRank,
        village,
        bloodline,
        ...squadFields,
        ...(needsReservation ? { subType: 'reservation_request', reservationStatus: 'requested' } : {}),
      };
      await submitPendingJutsu('insert', null, data, 'pending_review');

      fetch('/.netlify/functions/reviewer-ping', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          triggerType: 'creation',
          itemName: needsReservation ? `${data.name} (Réservation Request)` : data.name,
          itemType: 'Character',
          submitterName: profile?.username || 'Unknown',
        }),
      }).catch((pingErr) => {
        console.warn('[NARP] Reviewer ping creation alert failed:', pingErr);
      });

      if (onAfterSubmit) onAfterSubmit();
      onClose();
    } catch (err) {
      console.error('[NARP] Failed to submit OC:', err);
      alert('Submission failed: ' + (err.message || err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[80] bg-black/60 flex items-center justify-center p-4 animate-in fade-in" onClick={onClose}>
      <div className="bg-white rounded-3xl max-w-lg w-full overflow-hidden max-h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="bg-slate-900 text-white p-5 flex justify-between items-center shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <Icon n="PlusCir" size={18} className="text-emerald-400 shrink-0" />
            <h2 className="font-serif font-bold text-base truncate">{isEdit ? 'Edit OC Submission' : 'Submit Original Character'}</h2>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white transition-colors">
            <Icon n="X" size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-5 space-y-4 custom-scrollbar">
          <div>
            <label className="text-xs font-bold text-slate-500 uppercase tracking-widest block mb-1.5">OC Name (Mandatory)</label>
            <input
              type="text"
              required
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="e.g. Hana Yuki"
              className="w-full text-sm border border-slate-300 bg-white rounded-xl px-3 py-2 text-slate-800 focus:outline-none focus:border-emerald-500"
            />
          </div>

          <div>
            <label className="text-xs font-bold text-slate-500 uppercase tracking-widest block mb-1.5">OC Sheet — Google Doc Link (Mandatory)</label>
            <input
              type="url"
              required
              value={link}
              onChange={e => setLink(e.target.value)}
              placeholder="https://docs.google.com/..."
              className="w-full text-sm border border-slate-300 bg-white rounded-xl px-3 py-2 text-slate-800 focus:outline-none focus:border-emerald-500"
            />
          </div>

          {/* Which OC — drives the Discord "X oc" count role granted at approval */}
          <div>
            <label className="text-xs font-bold text-slate-500 uppercase tracking-widest block mb-1.5">Which OC is this for you? (Mandatory)</label>
            <div className="grid grid-cols-3 gap-2">
              {[[1, 'First OC'], [2, 'Second OC'], [3, 'Third OC']].map(([n, label]) => {
                const active = ocNumber === n;
                return (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setOcNumber(n)}
                    className={`p-3 rounded-xl border-2 text-sm font-bold transition-all ${
                      active ? 'border-emerald-500 bg-emerald-50 text-emerald-800' : 'border-slate-200 bg-white text-slate-800 hover:border-slate-300'
                    }`}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Ninja rank — each option shows how needed that rank is server-wide */}
          <div>
            <label className="text-xs font-bold text-slate-500 uppercase tracking-widest block mb-1.5">Ninja Rank (Mandatory)</label>
            <div className="grid grid-cols-2 gap-2">
              {OC_RANKS.map(r => {
                const total = rankTotals ? rankTotals[r] : null;
                const badge = rankTotals ? OC_NEED_BADGES[ocNeedLevel(rankTotals[r], rankMax)] : null;
                const active = ninjaRank === r;
                return (
                  <button
                    key={r}
                    type="button"
                    onClick={() => pickRank(r)}
                    className={`text-left p-3 rounded-xl border-2 transition-all ${
                      active ? 'border-emerald-500 bg-emerald-50' : 'border-slate-200 bg-white hover:border-slate-300'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-1">
                      <span className={`text-sm font-bold ${active ? 'text-emerald-800' : 'text-slate-800'}`}>{r}</span>
                      {total !== null && <span className="text-[10px] font-bold text-slate-400 tabular-nums">{total} on server</span>}
                    </div>
                    {badge && (
                      <span className={`inline-block mt-1.5 text-[9px] font-extrabold uppercase tracking-wider px-1.5 py-0.5 rounded border ${badge.cls}`}>
                        {badge.label}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Faction — revealed after a rank is picked, with a balance suggestion */}
          {ninjaRank && (
            <div className="animate-in fade-in slide-in-from-top-2">
              <label className="text-xs font-bold text-slate-500 uppercase tracking-widest block mb-1.5">Faction — Village or Wanderer (Mandatory)</label>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                {OC_VILLAGES.map(v => {
                  const count = rosterCounts ? (rosterCounts[v.id]?.[OC_RANK_KEY[ninjaRank]] || 0) : null;
                  const suggested = suggestedVillage === v.name;
                  const active = village === v.name;
                  return (
                    <button
                      key={v.id}
                      type="button"
                      onClick={() => pickVillage(v.name)}
                      className={`text-left p-3 rounded-xl border-2 transition-all ${
                        active ? 'border-emerald-500 bg-emerald-50' : 'border-slate-200 bg-white hover:border-slate-300'
                      }`}
                    >
                      <span className={`text-sm font-bold block ${active ? 'text-emerald-800' : 'text-slate-800'}`}>{v.name}</span>
                      {count !== null && (
                        <span className="text-[10px] text-slate-400 font-semibold">{count} {ninjaRank}{count === 1 ? '' : 's'}</span>
                      )}
                      {suggested && (
                        <span className="block mt-1">
                          <span className="text-[9px] font-extrabold uppercase tracking-wider px-1.5 py-0.5 rounded border bg-indigo-100 text-indigo-700 border-indigo-200">
                            ★ Suggested for {ninjaRank}
                          </span>
                        </span>
                      )}
                    </button>
                  );
                })}
                {hasWandererTicket && (
                  <button
                    type="button"
                    onClick={() => pickVillage('Wanderer')}
                    className={`text-left p-3 rounded-xl border-2 border-dashed transition-all sm:col-span-3 ${
                      isWanderer ? 'border-emerald-500 bg-emerald-50' : 'border-slate-300 bg-white hover:border-slate-400'
                    }`}
                  >
                    <span className={`text-sm font-bold block ${isWanderer ? 'text-emerald-800' : 'text-slate-800'}`}>Wanderer</span>
                    <span className="text-[10px] text-slate-400 font-semibold">
                      Outside the village system — no squads or council, keeps their ninja rank.
                    </span>
                    {!isEdit && (
                      <span className="block mt-1 text-[9px] font-extrabold uppercase tracking-wider px-1.5 py-0.5 rounded border bg-amber-100 text-amber-700 border-amber-200 w-fit">
                        Uses your one-time ticket
                      </span>
                    )}
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Squad — Genin and Chūnin join an existing squad or start their own */}
          {squadType && village && (
            <div className="animate-in fade-in slide-in-from-top-2">
              <label className="text-xs font-bold text-slate-500 uppercase tracking-widest block mb-1.5">
                {ninjaRank} Squad (Mandatory)
              </label>
              <div className="flex flex-col gap-2">
                {squadGroups.map(g => {
                  const active = squadChoice && !squadChoice.isNew && squadChoice.number === g.number;
                  const recommended = recommendedSquad === g.number;
                  return (
                    <button
                      key={g.number}
                      type="button"
                      onClick={() => setSquadChoice({ number: g.number, isNew: false })}
                      className={`text-left p-3 rounded-xl border-2 transition-all flex items-center justify-between gap-2 ${
                        active ? 'border-emerald-500 bg-emerald-50' : 'border-slate-200 bg-white hover:border-slate-300'
                      }`}
                    >
                      <span>
                        <span className={`text-sm font-bold block ${active ? 'text-emerald-800' : 'text-slate-800'}`}>
                          Squad {g.number}
                        </span>
                        <span className="text-[10px] text-slate-400 font-semibold">
                          {g.members} member{g.members === 1 ? '' : 's'}
                          {g.captain ? ` · led by ${g.captain}` : ' · no captain yet'}
                        </span>
                      </span>
                      {recommended && (
                        <span className="text-[9px] font-extrabold uppercase tracking-wider px-1.5 py-0.5 rounded border bg-indigo-100 text-indigo-700 border-indigo-200 shrink-0">
                          ★ Needs {ninjaRank}s
                        </span>
                      )}
                    </button>
                  );
                })}
                <button
                  type="button"
                  onClick={() => setSquadChoice({ number: nextSquadNumber, isNew: true })}
                  className={`text-left p-3 rounded-xl border-2 border-dashed transition-all ${
                    squadChoice?.isNew ? 'border-emerald-500 bg-emerald-50' : 'border-slate-300 bg-white hover:border-slate-400'
                  }`}
                >
                  <span className={`text-sm font-bold block ${squadChoice?.isNew ? 'text-emerald-800' : 'text-slate-800'}`}>
                    ＋ Start My Own Squad (Squad {nextSquadNumber})
                  </span>
                  <span className="text-[10px] text-slate-400 font-semibold">
                    Begin alone — others can join your squad later.
                  </span>
                </button>
              </div>
            </div>
          )}

          {/* Jōnin / Special Jōnin — optional mentoring + councilor (village-only) */}
          {(ninjaRank === 'Jōnin' || ninjaRank === 'Special Jōnin') && village && !isWanderer && (
            <div className="animate-in fade-in slide-in-from-top-2 space-y-3">
              <div>
                <label className="text-xs font-bold text-slate-500 uppercase tracking-widest block mb-1.5">
                  Mentor a Genin Squad (Optional)
                </label>
                {mentorableSquads.length > 0 ? (
                  <select
                    value={mentorSquad}
                    onChange={e => setMentorSquad(e.target.value)}
                    className="w-full text-sm border border-slate-300 bg-white rounded-xl px-3 py-2.5 text-slate-800 focus:outline-none focus:border-emerald-500"
                  >
                    <option value="">No squad — just take my roster slot</option>
                    {mentorableSquads.map(g => (
                      <option key={g.number} value={g.number}>
                        Genin Squad {g.number} — {g.members} genin, needs a captain
                      </option>
                    ))}
                  </select>
                ) : (
                  <p className="text-xs text-slate-400 bg-slate-50 border border-slate-200 rounded-xl p-2.5">
                    No captainless genin squads in {village} right now — your roster slot will be filled automatically.
                  </p>
                )}
              </div>
              {ninjaRank === 'Jōnin' && (
                <label className="flex items-start gap-2.5 bg-slate-50 border border-slate-200 rounded-xl p-3 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={councilor}
                    onChange={e => setCouncilor(e.target.checked)}
                    className="w-4 h-4 mt-0.5 rounded accent-emerald-600 shrink-0"
                  />
                  <span className="text-xs font-bold text-slate-700">
                    Councilor — member of the Village Council
                    <span className="block text-[10px] font-semibold text-slate-400 mt-0.5">
                      Symbolic rank: you stay a Jōnin and are also listed in the Village Council.
                    </span>
                  </span>
                </label>
              )}
            </div>
          )}

          {/* Bloodline — full bloodlines are blocked, low bloodlines require a reservation */}
          <div>
            <label className="text-xs font-bold text-slate-500 uppercase tracking-widest block mb-1.5">Bloodline</label>
            <select
              value={bloodline}
              onChange={e => setBloodline(e.target.value)}
              className="w-full text-sm border border-slate-300 bg-white rounded-xl px-3 py-2.5 text-slate-800 focus:outline-none focus:border-emerald-500"
            >
              <option value={CLANLESS}>Clanless — Unlimited</option>
              {bloodlineOptions.map(({ name: blName, info }) => (
                <option key={blName} value={blName} disabled={info.status === 'full'}>
                  {blName}
                  {info.unlimited ? ' — Unlimited'
                    : info.status === 'full' ? ' — FULL'
                    : info.status === 'limited' ? ` — ${info.remaining} left · Reservation Required`
                    : ` — ${info.remaining} left`}
                </option>
              ))}
            </select>
            {bloodlineFull && (
              <p className="text-xs font-bold text-rose-600 bg-rose-50 border border-rose-200 rounded-xl p-2.5 mt-2">
                This bloodline is full — every slot is taken or reserved. Pick another bloodline, or check back when a slot opens.
              </p>
            )}
            {needsReservation && (
              <div className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-xl p-3 mt-2 space-y-1">
                <p className="font-bold">⏳ Réservation Request</p>
                <p>
                  <strong>{bloodline}</strong> has only {selectedInfo.remaining} slot{selectedInfo.remaining === 1 ? '' : 's'} left, so this
                  will be submitted as a reservation request. A reviewer must grant your reservation — once granted, you have{' '}
                  <strong>48 hours</strong> to complete your OC sheet. Reviewers can extend the deadline if your sheet shows real progress.
                </p>
              </div>
            )}
          </div>

          <div className="flex justify-end gap-3 pt-2 border-t border-slate-100 shrink-0">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm font-bold text-slate-600 hover:bg-slate-50 rounded-xl transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitDisabled}
              className="px-5 py-2.5 rounded-xl text-sm font-bold transition-all shadow-md bg-emerald-600 hover:bg-emerald-700 text-white disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {submitting
                ? (isEdit ? 'Saving...' : 'Submitting...')
                : isEdit ? 'Save Changes'
                : needsReservation ? 'Submit Réservation Request'
                : 'Submit for Review'}
            </button>
          </div>
        </form>
      </div>
    </div>
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
   COMPONENT: BloodlineRosterCard
   ============================================================================ */
function BloodlineRosterCard({ bl, isAdmin, onEdit }) {
  const { remaining, total, parsed } = getSlotStatus(bl.slots);
  const hasSlots = total > 0;
  const effectiveMax = hasSlots ? total : (bl.max_slots || 0);
  const filledCount = hasSlots ? (total - remaining) : 0;
  const isUnlimitedBl = Number(bl.max_slots) === -1 || (bl.name || '').trim().toLowerCase() === 'clanless';

  let badgeClass = null, badgeLabel = null;
  if (isUnlimitedBl) {
    badgeClass = 'bg-emerald-100 text-emerald-800 border-emerald-200';
    badgeLabel = 'Open · Unlimited';
  } else if (effectiveMax > 0) {
    if (hasSlots && remaining === 0) {
      badgeClass = 'bg-red-100 text-red-800 border-red-200';
      badgeLabel = 'Full';
    } else if (hasSlots && remaining <= 2) {
      badgeClass = 'bg-amber-100 text-amber-800 border-amber-200';
      badgeLabel = 'Ask a Reviewer';
    } else {
      badgeClass = 'bg-emerald-100 text-emerald-800 border-emerald-200';
      badgeLabel = `Open · ${effectiveMax - filledCount} left`;
    }
  }

  const filledSlots = parsed.filter(s => s?.username);

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm flex flex-col overflow-hidden">
      <div className="p-4 flex-1">
        <div className="flex items-start justify-between gap-2 mb-3">
          <h3 className="font-bold text-slate-900 text-sm leading-tight">{bl.name}</h3>
          {isAdmin && (
            <button onClick={onEdit} className="shrink-0 text-slate-400 hover:text-indigo-600 transition-colors p-0.5">
              <Icon n="Edit" size={14} />
            </button>
          )}
        </div>

        <div className="flex flex-wrap gap-1.5 mb-3">
          {bl.link && (
            <a href={bl.link} target="_blank" rel="noopener noreferrer"
               className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest px-2.5 py-1 bg-indigo-50 text-indigo-700 border border-indigo-200 rounded-lg hover:bg-indigo-100 transition-colors">
              <Icon n="ExtLink" size={10} /> Doc
            </a>
          )}
          {bl.proprietary_ability_link && (
            <a href={bl.proprietary_ability_link} target="_blank" rel="noopener noreferrer"
               className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest px-2.5 py-1 bg-purple-50 text-purple-700 border border-purple-200 rounded-lg hover:bg-purple-100 transition-colors">
              <Icon n="ExtLink" size={10} /> Exclusive Ability
            </a>
          )}
        </div>

        {badgeLabel && (
          <div className="mb-3">
            <span className={`inline-flex items-center text-[10px] font-extrabold uppercase tracking-widest px-2.5 py-1 rounded-full border ${badgeClass}`}>
              {badgeLabel}
            </span>
          </div>
        )}

        {filledSlots.length > 0 && (
          <div className="space-y-1">
            {filledSlots.map((slot, i) => (
              <div key={i} className="text-xs text-slate-600 flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-slate-400 shrink-0" />
                {slot.discord_link ? (
                  <a href={slot.discord_link} target="_blank" rel="noopener noreferrer" className="text-indigo-700 hover:underline font-medium truncate">
                    {slot.username}
                  </a>
                ) : (
                  <span className="font-medium truncate">{slot.username}</span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="px-4 py-2 border-t border-slate-100 bg-slate-50">
        <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">{bl.category}</span>
      </div>
    </div>
  );
}

/* ============================================================================
   COMPONENT: BloodlinesRosterTab
   ============================================================================ */
function BloodlinesRosterTab({ bloodlines, isAdmin, onEdit, bF, setBF }) {
  const ORDER = ['Dojutsu', 'KKG', 'Hiden', 'Specialization', 'Other'];
  const SUBCAT_LABELS = { Dojutsu: 'Dojutsu', KKG: 'Kekkei Genkai', Hiden: 'Hiden', Specialization: 'Specialization', Other: 'Other' };

  const [filtersOpen, setFiltersOpen] = useState(false);
  const [statsOpen, setStatsOpen] = useState(false);

  const toggleCat = (v) => setBF(p => ({ ...p, cat: p.cat.includes(v) ? p.cat.filter(x => x !== v) : [...p.cat, v] }));
  const toggleSub = (v) => setBF(p => ({ ...p, sub: p.sub.includes(v) ? p.sub.filter(x => x !== v) : [...p.sub, v] }));
  const activeCount = (bF?.cat?.length || 0) + (bF?.sub?.length || 0) + (bF?.q ? 1 : 0);

  // Whole-database statistics (not affected by the filters)
  const blStats = useMemo(() => {
    const all = bloodlines || [];
    const bySub = ORDER.reduce((acc, s) => ({ ...acc, [s]: 0 }), {});
    all.forEach(b => { bySub[ORDER.includes(b.subcategory) ? b.subcategory : 'Other'] += 1; });
    return {
      total:  all.length,
      canon:  all.filter(b => b.category === 'Canon').length,
      custom: all.filter(b => b.category === 'Custom').length,
      bySub,
    };
  }, [bloodlines]);

  const filtB = useMemo(() => {
    let list = bloodlines || [];
    if (bF?.q) {
      const q = bF.q.toLowerCase();
      list = list.filter(b => b.name?.toLowerCase().includes(q) || (b.custom_tags || []).some(t => t.toLowerCase().includes(q)));
    }
    if (bF?.cat?.length) list = list.filter(b => bF.cat.includes(b.category));
    if (bF?.sub?.length) list = list.filter(b => bF.sub.includes(b.subcategory));
    if (bF?.srt === 'za') return [...list].sort((a, b) => b.name.localeCompare(a.name));
    if (bF?.srt === 'newest') return [...list].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    return [...list].sort((a, b) => a.name.localeCompare(b.name));
  }, [bloodlines, bF]);

  const grouped = ORDER.reduce((acc, sub) => {
    acc[sub] = filtB.filter(b => b.subcategory === sub);
    return acc;
  }, {});

  const uncategorized = filtB.filter(b => !ORDER.includes(b.subcategory));
  if (uncategorized.length) grouped['Other'] = [...(grouped['Other'] || []), ...uncategorized];

  if (!bloodlines || bloodlines.length === 0) {
    return (
      <div className="max-w-6xl mx-auto text-center py-16">
        <Icon n="Alert" size={40} className="text-slate-300 mx-auto mb-3" />
        <p className="text-slate-500 font-semibold">No bloodlines in the database yet.</p>
      </div>
    );
  }

  const STAT_TILES = [
    { label: 'Total',                     value: blStats.total,                 accent: 'text-slate-800' },
    { label: 'Canon',                     value: blStats.canon,                 accent: 'text-indigo-600' },
    { label: 'Custom',                    value: blStats.custom,                accent: 'text-purple-600' },
    ...ORDER.map(s => ({ label: SUBCAT_LABELS[s], value: blStats.bySub[s], accent: 'text-slate-800' })),
  ];

  return (
    <div className="max-w-6xl mx-auto space-y-8">
      {/* Bloodline statistics */}
      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm">
        <button onClick={() => setStatsOpen(o => !o)}
                className="w-full flex items-center justify-between p-4 text-left">
          <span className="flex items-center gap-2 text-xs font-bold text-slate-500 uppercase tracking-widest">
            <Icon n="Info" size={14} className="text-indigo-400" /> Bloodline Statistics
          </span>
          <Icon n={statsOpen ? 'Up' : 'Down'} size={16} className="text-slate-400" />
        </button>
        {statsOpen && (
          <div className="px-4 pb-4 grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3">
            {STAT_TILES.map(tile => (
              <div key={tile.label} className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-center">
                <p className={`text-xl font-black leading-tight ${tile.accent}`}>{tile.value}</p>
                <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mt-0.5">{tile.label}</p>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Filter row (foldable) */}
      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm">
        <button onClick={() => setFiltersOpen(o => !o)}
                className="w-full flex items-center justify-between p-4 text-left">
          <span className="flex items-center gap-2 text-xs font-bold text-slate-500 uppercase tracking-widest">
            <Icon n="Filter" size={14} className="text-indigo-400" /> Filters
            {activeCount > 0 && (
              <span className="px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-700 text-[10px] font-black tracking-normal normal-case">
                {activeCount} active
              </span>
            )}
          </span>
          <Icon n={filtersOpen ? 'Up' : 'Down'} size={16} className="text-slate-400" />
        </button>
        {filtersOpen && (
        <div className="px-4 pb-4 space-y-4">
        <div className="flex flex-wrap gap-3 items-center">
          {/* Search */}
          <div className="relative flex-1 min-w-[160px]">
            <Icon n="Search" size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
            <input
              type="text"
              value={bF?.q || ''}
              onChange={e => setBF(p => ({ ...p, q: e.target.value }))}
              placeholder="Search bloodlines..."
              className="w-full pl-8 pr-3 py-2 text-sm border border-slate-200 rounded-xl bg-white text-slate-800 focus:outline-none focus:border-indigo-400"
            />
          </div>
          {/* Sort */}
          <select
            value={bF?.srt || 'az'}
            onChange={e => setBF(p => ({ ...p, srt: e.target.value }))}
            className="text-sm border border-slate-200 rounded-xl px-3 py-2 bg-white text-slate-700 focus:outline-none focus:border-indigo-400"
          >
            <option value="az">Name (A-Z)</option>
            <option value="za">Name (Z-A)</option>
            <option value="newest">Newest First</option>
          </select>
          {/* Clear */}
          {activeCount > 0 && (
            <button
              onClick={() => setBF({ q: '', cat: [], sub: [], srt: bF?.srt || 'az' })}
              className="text-xs font-bold text-indigo-600 hover:text-indigo-800 px-3 py-2 rounded-xl hover:bg-indigo-50 transition-colors border border-indigo-200"
            >
              Clear ({activeCount})
            </button>
          )}
        </div>
        {/* Category chips */}
        <div className="flex flex-wrap gap-2">
          <span className="text-xs font-bold text-slate-400 uppercase tracking-widest self-center mr-1">Type:</span>
          {BL_CATS.map(c => (
            <button key={c} onClick={() => toggleCat(c)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all border ${
                bF?.cat?.includes(c) ? 'bg-indigo-100 border-indigo-300 text-indigo-800 shadow-sm' : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
              }`}>
              {c}
            </button>
          ))}
        </div>
        {/* Subcategory chips */}
        <div className="flex flex-wrap gap-2">
          <span className="text-xs font-bold text-slate-400 uppercase tracking-widest self-center mr-1">Category:</span>
          {ORDER.map(s => (
            <button key={s} onClick={() => toggleSub(s)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all border ${
                bF?.sub?.includes(s) ? 'bg-indigo-100 border-indigo-300 text-indigo-800 shadow-sm' : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
              }`}>
              {SUBCAT_LABELS[s]}
            </button>
          ))}
        </div>
        </div>
        )}
      </div>

      {filtB.length === 0 ? (
        <div className="text-center py-12">
          <Icon n="Search" size={36} className="text-slate-300 mx-auto mb-3" />
          <p className="text-slate-500 font-semibold">No bloodlines match your filters.</p>
          <button onClick={() => setBF({ q: '', cat: [], sub: [], srt: bF?.srt || 'az' })} className="mt-3 text-sm text-indigo-600 hover:underline">Clear filters</button>
        </div>
      ) : (
        ORDER.map(sub => {
          const items = grouped[sub];
          if (!items || items.length === 0) return null;
          return (
            <div key={sub}>
              <div className="flex items-center gap-3 mb-4">
                <h2 className="text-xs font-bold text-slate-400 uppercase tracking-widest">{SUBCAT_LABELS[sub]}</h2>
                <div className="flex-1 h-px bg-slate-200" />
                <span className="text-xs font-bold text-slate-400">{items.length}</span>
              </div>
              <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {items.map(bl => (
                  <BloodlineRosterCard key={bl._id} bl={bl} isAdmin={isAdmin} onEdit={() => onEdit(bl)} />
                ))}
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}

/* ============================================================================
   MODAL: AdminFormModal
   ============================================================================ */
function AdminFormModal({ tab: rawTab, eRow, onClose, db, onSubmit, willGoToPending, isAdmin = false, isPendingEdit = false }) {
  const tab = MANAGE_TABLES[rawTab] ? rawTab : 'jutsus';
  const schema = MANAGE_TABLES[tab] || MANAGE_TABLES['jutsus'];
  const [fd, setFd]   = useState({});
  const [ddOpen, setDdOpen] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  // Admins creating a NEW jutsu default to requesting a second approval;
  // they can still switch the toggle off for a direct write.
  const [askSecondApproval, setAskSecondApproval] = useState(
    () => isAdmin && tab === 'jutsus' && !isPendingEdit && !eRow?._id
  );

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
        rank = toArray(p.rank).slice().sort((a, b) => (RANK_COST_NUM[a] || 0) - (RANK_COST_NUM[b] || 0));
      } else {
        rank = toArray(p.rank).slice().sort((a, b) => (RANK_COST_NUM[a] || 0) - (RANK_COST_NUM[b] || 0));
      }
      const conds = toArray(p.conditions);
      entity = {
        _id:         eRow._id || (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `j-${Date.now()}`),
        name:        p.name || '',
        nature:      p.nature || '',
        rank,
        cost:        p.cost || '',
        types,
        jutsu_type:  toArray(p.jutsu_type),
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
        _id:                      eRow._id || (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `b-${Date.now()}`),
        name:                     p.name || '',
        category:                 p.category || 'Custom',
        subcategory:              p.subcategory || 'Other',
        custom_tags:              toArray(p.custom_tags),
        link:                     p.link || '',
        proprietary_ability_link: p.proprietary_ability_link || '',
        max_slots:                p.max_slots != null && p.max_slots !== '' ? Number(p.max_slots) : 5,
        slots:                    p.slots || '',
        _createdAt:               eRow._createdAt || new Date().toISOString(),
      };
    }
    try {
      await onSubmit({
        tab,
        operation: isEdit ? 'update' : 'insert',
        targetId:  isEdit ? eRow._id : null,
        entity,
        askSecondApproval: isAdmin && askSecondApproval,
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

          {(willGoToPending || askSecondApproval) && (
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
                ) : field.t === 'ttag-dd' ? (
                  <GenericDropdown
                    l="" placeholder="Select Jutsu Type(s)"
                    opts={(db.jutsuTypeTags || []).map(s => ({ value: s, label: s }))}
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
                  <SlotsEditor value={fd[field.k] || ''} onChange={v => setFd({ ...fd, [field.k]: v })} defCount={field.defCount || (field.defCountField ? (parseInt(fd[field.defCountField]) || 1) : 1)} />
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
                        const r = toArray(fd.rank).slice().sort((a, b) => (RANK_COST_NUM[a] || 0) - (RANK_COST_NUM[b] || 0));
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
                        ? toArray(fd.rank).slice().sort((a, b) => (RANK_COST_NUM[a] || 0) - (RANK_COST_NUM[b] || 0)).map((r, i) => (
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

          {/* Ask Second Approval Toggle (Admins/Owners only) */}
          {isAdmin && tab === 'jutsus' && !isPendingEdit && (
            <div className="mt-8 p-4 bg-slate-50 border rounded-2xl flex items-center justify-between gap-4">
              <div>
                <p className="text-sm font-bold text-slate-800">Request Second Approval</p>
                <p className="text-xs text-slate-500">Submit this change for review by another Reviewer or Admin before it goes live.</p>
              </div>
              <label className="relative inline-flex items-center cursor-pointer shrink-0">
                <input
                  type="checkbox"
                  checked={askSecondApproval}
                  onChange={(e) => setAskSecondApproval(e.target.checked)}
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-indigo-600"></div>
              </label>
            </div>
          )}

          <div className="flex justify-end gap-4 mt-10 pt-6 border-t">
            <button onClick={onClose} className="bg-white border-2 px-8 py-3 rounded-xl font-bold hover:bg-slate-50">Cancel</button>
            <button onClick={handleSave}
                    disabled={submitting || schema.fields.some(f => f.req && !(fd[f.k] || '').toString().trim())}
                    className="bg-indigo-600 text-white px-8 py-3 rounded-xl font-bold flex gap-2 disabled:opacity-50 hover:bg-indigo-700 shadow-md">
              <Icon n="Save" size={18}/> {submitting ? 'Saving...' : ((willGoToPending || askSecondApproval) ? 'Submit for Approval' : 'Save')}
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
const SUBMISSION_GATE_TYPES = [
  { key: 'jutsu_paused',       label: 'Jutsu / Battlemode', color: 'slate'   },
  { key: 'character_paused',   label: 'OC Submission',      color: 'emerald' },
  { key: 'custom_item_paused', label: 'Custom Item',        color: 'red'     },
  { key: 'summon_paused',      label: 'Summon',             color: 'amber'   },
];
const SUBMISSION_GATE_LABELS = Object.fromEntries(SUBMISSION_GATE_TYPES.map(({ key, label }) => [key, label]));

function SystemToolsModal({ db, setDb, onClose, onRefresh, refreshing, onOpenAuditLog, onManageBL, isOwner, isAdmin, isStaff, webhookConfig = {}, onWebhookConfigSave, submissionControls, onToggleSubmission, currentUserId, profile, onProfileUpdate }) {
  const [msg, setMsg]         = useState('');
  const [newSpec, setNewSpec] = useState('');
  const [pendingDel, setPendingDel] = useState(null);
  const [newTtag, setNewTtag] = useState('');
  const [pendingDelTtag, setPendingDelTtag] = useState(null);
  const [togglePending, setTogglePending] = useState({});

  const [wlJutsu,  setWlJutsu]  = useState(webhookConfig.discord_jutsu_thread_id || '');
  const [wlBattle, setWlBattle] = useState(webhookConfig.discord_battlemode_thread_id || '');
  const [wlOC,     setWlOC]     = useState(webhookConfig.discord_oc_thread_id || '');
  const [wlCustom, setWlCustom] = useState(webhookConfig.discord_custom_item_thread_id || '');
  const [wlSummon, setWlSummon] = useState(webhookConfig.discord_summon_thread_id || '');
  const [wlSaving, setWlSaving] = useState({ jutsu: false, battle: false, oc: false, custom: false, summon: false });

  const saveWorkLog = async (type) => {
    setWlSaving(s => ({ ...s, [type]: true }));
    try {
      if (type === 'jutsu') {
        onWebhookConfigSave('discord_jutsu_thread_id', wlJutsu);
      } else if (type === 'battle') {
        onWebhookConfigSave('discord_battlemode_thread_id', wlBattle);
      } else if (type === 'oc') {
        onWebhookConfigSave('discord_oc_thread_id', wlOC);
      } else if (type === 'custom') {
        onWebhookConfigSave('discord_custom_item_thread_id', wlCustom);
      } else if (type === 'summon') {
        onWebhookConfigSave('discord_summon_thread_id', wlSummon);
      }
      setMsg('Log thread ID saved.');
    } catch (e) {
      setMsg('Failed to save: ' + (e.message || e));
    } finally {
      setWlSaving(s => ({ ...s, [type]: false }));
    }
  };

  const handleToggle = async (key) => {
    if (!isOwner || !isSupabaseConfigured()) return;
    const newVal = !(submissionControls?.[key]);
    setTogglePending(p => ({ ...p, [key]: true }));
    try {
      await updateSubmissionControl(key, newVal, currentUserId);
      onToggleSubmission(key, newVal);
      const label = SUBMISSION_GATE_LABELS[key] || key;
      setMsg(`${label} submissions ${newVal ? 'paused' : 'reopened'}.`);
    } catch (e) {
      setMsg('Failed to update: ' + (e.message || 'unknown error'));
    } finally {
      setTogglePending(p => ({ ...p, [key]: false }));
    }
  };

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

  const addTtag = () => {
    const v = newTtag.trim();
    if (!v) return;
    if (db.jutsuTypeTags.includes(v)) { setMsg(`'${v}' is already in the list.`); return; }
    setDb(d => {
      const next = [...d.jutsuTypeTags, v];
      if (isSupabaseConfigured()) saveJutsuTypeTagsToSupabase(next).catch(e => console.warn('[NARP] save jutsu type tags failed:', e));
      return { ...d, jutsuTypeTags: next };
    });
    setNewTtag('');
    setMsg(`Added '${v}'.`);
  };

  const confirmDelTtag = () => {
    if (!pendingDelTtag) return;
    setDb(d => {
      const next = d.jutsuTypeTags.filter(x => x !== pendingDelTtag);
      if (isSupabaseConfigured()) saveJutsuTypeTagsToSupabase(next).catch(e => console.warn('[NARP] save jutsu type tags failed:', e));
      return { ...d, jutsuTypeTags: next };
    });
    setMsg(`Removed '${pendingDelTtag}'.`);
    setPendingDelTtag(null);
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
                <Icon n="Book" size={20} className="text-red-600" /> Bloodlines
              </h3>
              <p className="text-xs text-slate-500 mb-6">Add, edit, and remove bloodlines. These populate the bloodline filter dropdown but no longer have a public browse tab.</p>
              <button onClick={onManageBL}
                      className="w-full bg-red-700 text-white py-3 rounded-xl font-bold flex justify-center gap-2 hover:bg-red-800">
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
                <button onClick={() => setMsg('CSV export coming soon.')}
                        className="flex-1 bg-emerald-600 text-white py-3 rounded-xl font-bold flex justify-center gap-2 hover:bg-emerald-700">
                  <Icon n="Download" size={16}/> CSV
                </button>
              </div>
            </div>

            {/* Log Thread IDs — owner only */}
            {isOwner && isSupabaseConfigured() && (
              <div className="bg-slate-50 rounded-2xl border p-6 md:col-span-2">
                <h3 className="text-lg font-bold mb-1 flex items-center gap-2">
                  <Icon n="MessageSquare" size={20} className="text-sky-500" /> Log Thread IDs
                  <span className="ml-auto text-[10px] font-bold uppercase tracking-wider bg-amber-100 text-amber-700 border border-amber-300 px-2 py-0.5 rounded">Operator only</span>
                </h3>
                <p className="text-xs text-slate-500 mb-4">Discord thread IDs where logs are posted when entries are approved.</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {[
                    { label: 'Jutsu',          val: wlJutsu,  set: setWlJutsu,  type: 'jutsu' },
                    { label: 'Battlemode',     val: wlBattle, set: setWlBattle, type: 'battle' },
                    { label: 'OC / Character', val: wlOC,     set: setWlOC,     type: 'oc' },
                    { label: 'Custom Item',    val: wlCustom, set: setWlCustom, type: 'custom' },
                    { label: 'Summon',         val: wlSummon, set: setWlSummon, type: 'summon' },
                  ].map(({ label, val, set, type }) => (
                    <div key={type}>
                      <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest block mb-1.5">
                        {label}
                      </label>
                      <div className="flex gap-2">
                        <input
                          type="text"
                          value={val}
                          onChange={e => set(e.target.value)}
                          placeholder="Thread ID"
                          className="flex-1 min-w-0 text-xs border border-slate-300 bg-white rounded-lg px-2 py-1.5 text-slate-800 focus:outline-none focus:border-sky-400"
                        />
                        <button
                          type="button"
                          onClick={() => saveWorkLog(type)}
                          disabled={wlSaving[type]}
                          className="bg-slate-800 hover:bg-slate-700 text-white font-bold text-xs px-3 py-1 rounded-lg disabled:opacity-30 transition-colors shrink-0"
                        >
                          {wlSaving[type] ? '...' : 'Save'}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Submission Gates — owner only */}
            {isOwner && (
              <div className="bg-slate-50 rounded-2xl border p-6 md:col-span-2">
                <h3 className="text-lg font-bold mb-1 flex items-center gap-2">
                  <Icon n="Lock" size={20} className="text-rose-500" /> Submission Gates
                  <span className="ml-auto text-[10px] font-bold uppercase tracking-wider bg-amber-100 text-amber-700 border border-amber-300 px-2 py-0.5 rounded">Operator only</span>
                </h3>
                <p className="text-xs text-slate-500 mb-5">Temporarily pause or reopen submission creation per entry type. When paused, users see a notice and the form is blocked.</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                  {SUBMISSION_GATE_TYPES.map(({ key, label, color }) => {
                    const paused  = !!(submissionControls?.[key]);
                    const pending = !!togglePending[key];
                    const trackOn  = { slate: 'bg-slate-700', red: 'bg-red-700', amber: 'bg-amber-500', emerald: 'bg-emerald-600' }[color];
                    return (
                      <div key={key} className={`flex items-center justify-between p-4 rounded-xl border-2 transition-colors ${paused ? 'border-rose-200 bg-rose-50' : 'border-slate-200 bg-white'}`}>
                        <div>
                          <div className="text-sm font-bold text-slate-800">{label}</div>
                          <div className={`text-xs font-semibold mt-0.5 ${paused ? 'text-rose-600' : 'text-emerald-600'}`}>
                            {paused ? 'Paused' : 'Open'}
                          </div>
                        </div>
                        <button
                          onClick={() => handleToggle(key)}
                          disabled={pending}
                          title={paused ? 'Reopen submissions' : 'Pause submissions'}
                          className={`relative w-12 h-6 rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-offset-1 ${paused ? 'bg-rose-500 focus:ring-rose-300' : `${trackOn} focus:ring-slate-400`} disabled:opacity-50 shrink-0`}
                        >
                          <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${paused ? 'translate-x-0' : 'translate-x-6'}`} />
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Manage Specializations */}
            <div className="bg-slate-50 rounded-2xl border p-6 md:col-span-2">
              <h3 className="text-lg font-bold mb-2 flex items-center gap-2">
                <Icon n="Tag" size={20} className="text-indigo-500" /> Manage Specializations
              </h3>
              <p className="text-xs text-slate-500 mb-4">Add or permanently remove tags from the Specializations list.</p>
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

            {/* Manage Jutsu Type Tags */}
            <div className="bg-slate-50 rounded-2xl border p-6 md:col-span-2">
              <h3 className="text-lg font-bold mb-2 flex items-center gap-2">
                <Icon n="Tag" size={20} className="text-sky-500" /> Manage Jutsu Type Tags
              </h3>
              <p className="text-xs text-slate-500 mb-4">Add or permanently remove tags from the Jutsu Type list (Offensive, Defensive, Mobility, etc.).</p>
              <div className="flex flex-wrap gap-2 mb-4">
                {(db.jutsuTypeTags || []).map(s => (
                  <span key={s} className="bg-white border rounded-lg px-3 py-1.5 text-sm font-semibold flex items-center gap-2 shadow-sm">
                    {s}
                    <button onClick={() => setPendingDelTtag(s)} className="text-red-400 hover:text-red-600">
                      <Icon n="X" size={14}/>
                    </button>
                  </span>
                ))}
              </div>
              <div className="flex gap-2">
                <input value={newTtag} onChange={e => setNewTtag(e.target.value)}
                       onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addTtag(); } }}
                       placeholder="New jutsu type tag..."
                       className="flex-1 border rounded-xl px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500" />
                <button onClick={addTtag} className="bg-sky-600 hover:bg-sky-700 text-white px-6 py-2 rounded-xl font-bold transition-colors">
                  Add
                </button>
              </div>
            </div>

            {/* Webhook Config — owner only */}
            {isOwner && (
              <div className="bg-slate-50 rounded-2xl border p-6 md:col-span-2">
                <h3 className="text-lg font-bold mb-1 flex items-center gap-2">
                  <Icon n="MessageSquare" size={20} className="text-violet-500" /> Discord Notification Config
                  <span className="ml-auto text-[10px] font-bold uppercase tracking-wider bg-amber-100 text-amber-700 border border-amber-300 px-2 py-0.5 rounded">Operator only</span>
                </h3>
                <p className="text-xs text-slate-500 mb-5">Configure where Discord notifications are sent. Webhook URLs remain in Netlify env vars (they contain auth tokens).</p>
                <div className="space-y-3">
                  {[
                    { key: 'discord_guild_id',            label: 'Guild ID',             placeholder: '12345678901234567' },
                    { key: 'discord_ping_thread_id',      label: 'Reviewer Ping Thread', placeholder: 'Thread ID (17-20 digits)' },
                    { key: 'discord_reviewer_role_id',    label: 'Reviewer Role ID',     placeholder: 'Discord role snowflake' },
                    { key: 'discord_admin_role_id',       label: 'Admin Role ID',        placeholder: 'Discord role snowflake' },
                  ].map(({ key, label, placeholder }) => (
                    <WebhookConfigRow
                      key={key}
                      label={label}
                      placeholder={placeholder}
                      initialValue={webhookConfig[key] || ''}
                      onSave={(value) => onWebhookConfigSave(key, value)}
                    />
                  ))}
                </div>
                <p className="text-[10px] text-slate-400 mt-4">Changes take effect immediately — no redeploy needed.</p>
              </div>
            )}
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

        {/* Confirm-delete sub-modal for jutsu type tags */}
        {pendingDelTtag && (
          <div className="fixed inset-0 z-[110] bg-black/60 flex items-center justify-center p-4" onClick={() => setPendingDelTtag(null)}>
            <div className="bg-white p-6 rounded-3xl max-w-sm w-full" onClick={e => e.stopPropagation()}>
              <h3 className="font-bold text-xl mb-2 text-slate-900">Remove jutsu type tag?</h3>
              <p className="text-sm text-slate-600 mb-6">Remove '{pendingDelTtag}' from the global list? Existing jutsus that already use it will keep the value.</p>
              <div className="flex gap-3">
                <button onClick={() => setPendingDelTtag(null)} className="flex-1 px-4 py-3 bg-slate-100 text-slate-700 font-bold rounded-xl hover:bg-slate-200">Cancel</button>
                <button onClick={confirmDelTtag}                className="flex-1 px-4 py-3 bg-red-600 text-white font-bold rounded-xl hover:bg-red-700 shadow-md">Remove</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ============================================================================
   COMPONENT: WebhookConfigRow
   ============================================================================ */
function WebhookConfigRow({ label, placeholder, initialValue, onSave }) {
  const [value, setValue] = useState(initialValue);
  const [status, setStatus] = useState('idle'); // idle | saving | success | error
  const [errMsg, setErrMsg] = useState('');

  useEffect(() => { setValue(initialValue); }, [initialValue]);

  const handleSave = async () => {
    setStatus('saving');
    setErrMsg('');
    try {
      await onSave(value.trim());
      setStatus('success');
      setTimeout(() => setStatus('idle'), 2000);
    } catch (e) {
      setErrMsg(e.message || 'Save failed');
      setStatus('error');
    }
  };

  return (
    <div className="flex flex-col sm:flex-row sm:items-center gap-1.5 sm:gap-2">
      <label className="text-xs font-bold text-slate-600 sm:w-36 sm:shrink-0">{label}</label>
      <div className="flex items-center gap-2 min-w-0">
        <input
          type="text"
          value={value}
          onChange={e => { setValue(e.target.value); setStatus('idle'); }}
          placeholder={placeholder}
          className="flex-1 min-w-0 text-xs border border-slate-200 rounded-lg px-3 py-1.5 outline-none focus:ring-2 focus:ring-violet-400 font-mono"
        />
        <button
          onClick={handleSave}
          disabled={status === 'saving'}
          className="text-[11px] px-3 py-1.5 rounded-lg bg-violet-600 hover:bg-violet-700 text-white font-bold disabled:opacity-50 shrink-0"
        >
          {status === 'saving' ? '…' : 'Save'}
        </button>
        {status === 'success' && <span className="text-emerald-600 text-[10px] font-bold shrink-0">✓</span>}
        {status === 'error'   && <span className="text-red-500 text-[10px] shrink-0" title={errMsg}>✗</span>}
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
    let width = 40;
    let height = 40;
    if (className.includes('w-6') || className.includes('h-6')) {
      width = 24;
      height = 24;
    } else if (className.includes('w-8') || className.includes('h-8')) {
      width = 32;
      height = 32;
    } else if (className.includes('w-5') || className.includes('h-5')) {
      width = 20;
      height = 20;
    } else if (className.includes('w-3.5') || className.includes('h-3.5')) {
      width = 14;
      height = 14;
    }
    return (
      <img
        src={getNetlifyImageUrl(profile.avatar_url, width)}
        srcSet={getNetlifyImageSrcSet(profile.avatar_url)}
        alt={profile.username || 'Avatar'}
        className={className}
        width={width}
        height={height}
        loading="lazy"
      />
    );
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
   COMPONENT: MemberWorkThreadInput
   ============================================================================ */
function MemberWorkThreadInput({ member, onSave }) {
  const [threadInput, setThreadInput] = useState(member.work_thread_id || '');
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState(''); // 'success', 'error', or ''

  useEffect(() => {
    setThreadInput(member.work_thread_id || '');
  }, [member.work_thread_id]);

  const handleSave = async () => {
    try {
      setSaving(true);
      setStatus('');
      await onSave(member.id, threadInput);
      setStatus('success');
      setTimeout(() => setStatus(''), 2000);
    } catch (err) {
      console.error(err);
      setStatus('error');
    } finally {
      setSaving(false);
    }
  };

  const hasChanged = (threadInput || '').trim() !== (member.work_thread_id || '').trim();

  return (
    <div className="flex items-center gap-2">
      <input
        type="text"
        placeholder="Thread ID..."
        value={threadInput}
        onChange={(e) => setThreadInput(e.target.value)}
        className="w-36 text-xs px-2 py-1 border border-slate-200 rounded-md bg-white text-slate-800 focus:outline-hidden focus:ring-1 focus:ring-indigo-500"
      />
      <button
        type="button"
        onClick={handleSave}
        disabled={saving || !hasChanged}
        className="text-[10px] px-2 py-1 font-bold rounded-md bg-indigo-600 hover:bg-indigo-700 text-white disabled:opacity-30 transition-colors shrink-0"
      >
        {saving ? '...' : 'Save'}
      </button>
      {status === 'success' && (
        <span className="text-emerald-600 text-[10px] font-bold" title="Saved successfully">✓</span>
      )}
    </div>
  );
}

/* ============================================================================
   COMPONENT: UserMenu
   ============================================================================ */
function UserMenu({ profile, onSignIn, onDevSignIn, onSignOut, supabaseReady, devRole, onToggleDevRole, onProfileUpdate, viewAsRole, onSetViewAsRole }) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef(null);
  const [notifEnabled, setNotifEnabledState] = useState(() => isNotifEnabled());
  const [notifPermission, setNotifPermissionState] = useState(() => getNotifPermission());
  const [notifDeniedMsg, setNotifDeniedMsg] = useState(false);
  const [nicknameInput, setNicknameInput] = useState('');
  const [nicknameEditing, setNicknameEditing] = useState(false);
  const [nicknameSaving, setNicknameSaving] = useState(false);
  const [nicknameMsg, setNicknameMsg] = useState('');

  const activeProfile = supabaseReady ? profile : {
    id: 'dev-user-id',
    username: 'Dev Administrator',
    email: 'dev@example.com',
    avatar_url: null,
    role: devRole,
  };

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

  const experimentalMode = import.meta.env.VITE_EXPERIMENTAL_MODE === 'true';
  const [devLoading, setDevLoading] = useState(false);

  const handleDevSignIn = async () => {
    setDevLoading(true);
    try {
      await onDevSignIn();
    } catch (e) {
      alert('Dev login failed: ' + e.message);
    } finally {
      setDevLoading(false);
    }
  };

  if (supabaseReady && !activeProfile) {
    return (
      <div className="flex items-center gap-2 shrink-0">
        <button onClick={onSignIn}
                type="button"
                className="text-xs px-3 py-1.5 font-bold rounded-lg bg-[#5865F2] text-white hover:bg-[#4752c4] flex items-center gap-2">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z"/></svg>
          Sign in with Discord
        </button>
        {experimentalMode && (
          <button onClick={handleDevSignIn}
                  type="button"
                  disabled={devLoading}
                  className="text-xs px-3 py-1.5 font-bold rounded-lg bg-amber-500 text-white hover:bg-amber-600 flex items-center gap-1.5 disabled:opacity-60">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4zm0 4l5 2.18V11c0 3.5-2.33 6.79-5 7.93-2.67-1.14-5-4.43-5-7.93V7.18L12 5z"/></svg>
            {devLoading ? 'Loading…' : 'Dev Access'}
          </button>
        )}
      </div>
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
          {activeProfile.role === 'staff' ? 'Reviewer' : activeProfile.role === 'owner' ? 'Operator' : activeProfile.role}
        </span>
        <Icon n="Down" size={12} className="text-slate-400" />
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-64 max-w-[calc(100vw-1rem)] bg-white rounded-xl shadow-xl border border-slate-200 z-40 overflow-hidden">
          <div className="p-4 border-b border-slate-100 flex items-center gap-3">
            <ProfileAvatar profile={activeProfile} className="w-10 h-10 rounded-lg" />
            <div className="flex-1 min-w-0">
              <div className="text-sm font-bold text-slate-800 truncate">
                {activeProfile.site_nickname || activeProfile.username || 'No name'}
              </div>
              {activeProfile.site_nickname && (
                <div className="text-[10px] text-slate-400 truncate">@{activeProfile.username}</div>
              )}
            </div>
          </div>

          {/* Site Nickname — staff / admin / owner only */}
          {supabaseReady && profile && ['staff', 'admin', 'owner'].includes(profile.role) && (
            <div className="border-b border-slate-100 px-4 py-3">
              <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">Site Nickname</div>
              {!nicknameEditing ? (
                <div className="flex items-center gap-2">
                  <span className="flex-1 text-xs text-slate-700 truncate">
                    {profile.site_nickname || <span className="text-slate-400 italic">Not set</span>}
                  </span>
                  <button
                    type="button"
                    onClick={() => { setNicknameInput(profile.site_nickname || ''); setNicknameEditing(true); setNicknameMsg(''); }}
                    className="text-[10px] font-bold text-indigo-600 hover:text-indigo-800 px-2 py-1 rounded hover:bg-indigo-50 shrink-0"
                  >Edit</button>
                </div>
              ) : (
                <div className="flex flex-col gap-1.5">
                  <input
                    type="text"
                    value={nicknameInput}
                    onChange={e => setNicknameInput(e.target.value)}
                    maxLength={32}
                    placeholder="Enter nickname…"
                    autoFocus
                    className="w-full border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs focus:outline-none focus:border-indigo-400 text-slate-800"
                    onKeyDown={e => { if (e.key === 'Escape') setNicknameEditing(false); }}
                  />
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <button
                      type="button"
                      disabled={nicknameSaving}
                      onClick={async () => {
                        setNicknameSaving(true);
                        try {
                          const updated = await updateMySiteNickname(nicknameInput);
                          onProfileUpdate(updated);
                          setNicknameMsg('Saved!');
                          setNicknameEditing(false);
                        } catch (err) {
                          setNicknameMsg(err.message || 'Failed to save');
                        } finally { setNicknameSaving(false); }
                      }}
                      className="text-[10px] font-bold bg-indigo-600 text-white px-2.5 py-1 rounded hover:bg-indigo-700 disabled:opacity-60"
                    >{nicknameSaving ? 'Saving…' : 'Save'}</button>
                    <button
                      type="button"
                      onClick={() => { setNicknameEditing(false); setNicknameMsg(''); }}
                      className="text-[10px] font-bold text-slate-500 px-2 py-1 rounded hover:bg-slate-100"
                    >Cancel</button>
                    {profile.site_nickname && (
                      <button
                        type="button"
                        disabled={nicknameSaving}
                        onClick={async () => {
                          setNicknameSaving(true);
                          try {
                            const updated = await updateMySiteNickname('');
                            onProfileUpdate(updated);
                            setNicknameEditing(false);
                          } catch (err) { setNicknameMsg(err.message || 'Failed'); }
                          finally { setNicknameSaving(false); }
                        }}
                        className="text-[10px] font-bold text-rose-500 hover:text-rose-700 px-2 py-1 rounded hover:bg-rose-50 ml-auto"
                      >Clear</button>
                    )}
                  </div>
                  {nicknameMsg && <p className="text-[10px] text-indigo-600">{nicknameMsg}</p>}
                </div>
              )}
            </div>
          )}

          {profile?.role === 'owner' && (
            <div className="px-4 py-3 border-b border-slate-100 bg-amber-50">
              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest block mb-1.5">Preview as</label>
              <select
                value={viewAsRole || profile.role}
                onChange={e => onSetViewAsRole(e.target.value === profile.role ? null : e.target.value)}
                className="w-full text-xs border border-slate-300 bg-white rounded px-2 py-1 text-slate-800 focus:outline-none focus:border-amber-400"
              >
                <option value="owner">Operator (default)</option>
                <option value="admin">Admin</option>
                <option value="staff">Reviewer</option>
                <option value="user">User</option>
              </select>
            </div>
          )}
          {!supabaseReady && (
            <div className="border-t border-slate-100 p-3 bg-slate-50">
              <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2 flex items-center gap-1.5">
                <Icon n="Key" size={10} className="text-indigo-400"/> Dev · Role
              </div>
              <div className="flex flex-wrap gap-1">
                {['user', 'staff', 'admin', 'owner'].map(r => (
                  <button key={r} type="button"
                    onClick={() => onToggleDevRole(r)}
                    className={`text-xs px-2.5 py-1 rounded-lg font-bold border transition-colors ${
                      devRole === r
                        ? 'bg-indigo-600 text-white border-indigo-600'
                        : 'text-slate-600 border-slate-200 bg-white hover:bg-slate-100'
                    }`}>
                    {r === 'staff' ? 'Reviewer' : r === 'owner' ? 'Operator' : r}
                  </button>
                ))}
              </div>
            </div>
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
  nat: [], rnk: [], typ: [], spc: [], org: [], bl: [], bm: [], jty: [],
  lck: false, lim: false, pve: false, mul: false,
  hLck: false, hLim: false, hPve: false, hMul: false, hMP: false, hAsk: false,
  showFilters: false,
  sort: 'az',
};

const ARRAY_FILTER_KEYS = ['nat', 'rnk', 'typ', 'spc', 'org', 'bl', 'bm', 'jty'];
const BOOL_FILTER_KEYS  = ['lck', 'lim', 'pve', 'mul', 'hLck', 'hLim', 'hPve', 'hMul', 'hMP', 'hAsk'];

const getPendingAssignedId = (p) => {
  if (!p?.assigned_to) return null;
  return typeof p.assigned_to === 'object' ? p.assigned_to.id : p.assigned_to;
};

/*
 * Whose turn is it in a review chat, from the viewer's perspective.
 * Submitters: any message not from them means the reviewer spoke last → your turn.
 * Reviewers: turn is role-based (did the player speak last?), so one reviewer's
 * reply also clears the "awaiting you" flag for the rest of the team.
 */
const getChatTurn = (lastMsg, myId, iAmSubmitter) => {
  if (!lastMsg) return null;
  if (iAmSubmitter) return lastMsg.sender_id === myId ? 'them' : 'you';
  return ['staff', 'admin', 'owner'].includes(lastMsg.profiles?.role) ? 'them' : 'you';
};

export default function App() {
  const headerRef = useRef(null);
  const [headerHeight, setHeaderHeight] = useState(72);
  const [visibleCount, setVisibleCount] = useState(200);

  const [db, setDb]           = useState({ jutsus: [], bloodlines: [], specializations: [], jutsuTypeTags: [] });
  const [loading, setLoading] = useState(true);

  const [profile, setProfile] = useState(null);
  const [webhookConfig, setWebhookConfig] = useState({});
  const [devRole, setDevRole] = useState(() => LS.get(STORAGE.ROLE, 'user'));
  const [viewAsRole, setViewAsRole] = useState(null);
  const [submissionControls, setSubmissionControls] = useState({ jutsu_paused: false, custom_item_paused: false, summon_paused: false, character_paused: false });
  const supabaseReady = isSupabaseConfigured();

  const role    = supabaseReady ? (viewAsRole || profile?.role || 'guest') : devRole;
  const isStaff = role === 'staff' || role === 'admin' || role === 'owner';
  const isAdmin = role === 'admin' || role === 'owner';
  const isOwner = role === 'owner';

  const [pendingJutsus, setPendingJutsus] = useState([]);
  const pendingJutsusRef = useRef([]);
  const [myOwnSubmissions, setMyOwnSubmissions] = useState([]);
  const myOwnSubmissionsRef = useRef([]);
  const [pendingLoaded, setPendingLoaded] = useState(false);
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [approvingIds, setApprovingIds] = useState(new Set());
  // Inbox tab (merged Messages + Pending + My Submissions): one "new item"
  // dot and one "selected item" state shared across every audience/view.
  const [inboxHasNew, setInboxHasNew] = useState(false);
  const prevPendingCountRef = useRef(0);
  const tabRef = useRef('jutsus');
  const [selectedInboxId, setSelectedInboxId] = useState(null);
  const [collapsedGroups, setCollapsedGroups] = useState(new Set());
  const [chatThreads, setChatThreads] = useState([]);
  const [chatReadMap, setChatReadMap] = useState(() => LS.get(STORAGE.CHAT_READ, {}));
  const [myParticipatingIds, setMyParticipatingIds] = useState(() => new Set());

  const markChatRead = useCallback((pendingId) => {
    if (!pendingId) return;
    setChatReadMap(prev => {
      const prevTs = prev[pendingId] ? new Date(prev[pendingId]).getTime() : 0;
      // Skip no-op updates (called on every chat render) to avoid churn
      if (Date.now() - prevTs < 1000) return prev;
      const next = { ...prev, [pendingId]: new Date().toISOString() };
      LS.set(STORAGE.CHAT_READ, next);
      return next;
    });
  }, []);
  const [appNotifEnabled, setAppNotifEnabled] = useState(() => isNotifEnabled());
  const [appNotifPermission, setAppNotifPermission] = useState(() => getNotifPermission());
  const [appNotifDenied, setAppNotifDenied] = useState(false);

  // Once signed in, make sure this device actually has a push subscription saved.
  // Backfills users who toggled notifications on before VAPID keys existed and
  // refreshes endpoints that the browser may have rotated — no re-toggle needed.
  useEffect(() => {
    if (!profile?.id) return;
    if (!isNotifEnabled()) return;
    if (getNotifPermission() !== 'granted') return;
    (async () => {
      try {
        const pushSub = await subscribeToPush();
        if (pushSub) await savePushSubscription(pushSub);
      } catch (e) {
        console.warn('[NARP] Auto-resubscribe to push failed:', e);
      }
    })();
  }, [profile?.id]);

  const [profilesList, setProfilesList] = useState([]);
  const [profilesLoading, setProfilesLoading] = useState(false);
  const [tab, setTab]           = useState('jutsus');

  const loadProfiles = useCallback(async () => {
    if (!supabaseReady || !isAdmin) return;
    setProfilesLoading(true);
    try {
      const list = await fetchAllProfiles();
      setProfilesList(list);
    } catch (err) {
      console.error('[NARP] Failed to fetch profiles:', err);
      alert('Error loading members: ' + (err.message || err));
    } finally {
      setProfilesLoading(false);
    }
  }, [supabaseReady, isAdmin]);

  const handleRoleChange = async (userId, newRole) => {
    if (!window.confirm(`Are you sure you want to change this member's role to ${newRole}?`)) {
      return;
    }
    try {
      await setUserRole(userId, newRole);
      await loadProfiles();
    } catch (err) {
      console.error('[NARP] Failed to update user role:', err);
      alert('Failed to update role: ' + (err.message || err));
    }
  };

  const handleGrantWandererTicket = async (userId, username) => {
    if (!window.confirm(`Grant a one-time Wanderer OC ticket to ${username || 'this member'}?`)) return;
    try {
      await grantWandererTicket(userId);
      await loadProfiles();
    } catch (err) {
      console.error('[NARP] Failed to grant Wanderer ticket:', err);
      alert('Failed to grant ticket: ' + (err.message || err));
    }
  };

  const handleWorkThreadChange = async (userId, threadId) => {
    try {
      await setUserWorkThreadId(userId, threadId);
      setProfilesList(prev => prev.map(p => p.id === userId ? { ...p, work_thread_id: threadId } : p));
    } catch (err) {
      console.error('[NARP] Failed to update user work thread:', err);
      throw err;
    }
  };

  useEffect(() => {
    if (tab === 'members') {
      loadProfiles();
    }
  }, [tab, loadProfiles, refreshTrigger]);

  const [viewMode, setViewMode] = useState(() => LS.get(STORAGE.VIEW_MODE, 'card'));
  const [expRow, setExpRow]     = useState(null);
  const [cart, setCart]         = useState(() => LS.get(STORAGE.CART, []));
  const [pTags, setPTags]       = useState(() => LS.get(STORAGE.TAGS, {}));

  const [f, setF] = useState(INITIAL_FILTER_STATE);
  const [bF, setBF] = useState({ q: '', cat: [], sub: [], srt: 'az' });
  const clearF = useCallback(() => setF(p => {
    const next = { ...p };
    ARRAY_FILTER_KEYS.forEach(k => next[k] = []);
    BOOL_FILTER_KEYS.forEach(k  => next[k] = false);
    next.q = '';
    return next;
  }), []);

  useEffect(() => {
    setVisibleCount(200);
  }, [f, tab]);

  useEffect(() => {
    if (!headerRef.current) return;
    const updateHeight = () => {
      setHeaderHeight(headerRef.current.offsetHeight);
    };
    updateHeight();
    const observer = new ResizeObserver(updateHeight);
    observer.observe(headerRef.current);
    return () => observer.disconnect();
  }, [loading]);

  const [modals, setModals]         = useState({ credits: false, copiedId: null, system: false, audit: false, manageBL: false, iosInstall: false });
  const [installPrompt, setInstallPrompt] = useState(null);
  const [appInstalled, setAppInstalled]   = useState(() => window.matchMedia('(display-mode: standalone)').matches || !!window.navigator.standalone);

  useEffect(() => {
    const handler = (e) => { e.preventDefault(); setInstallPrompt(e); };
    window.addEventListener('beforeinstallprompt', handler);
    window.addEventListener('appinstalled', () => { setInstallPrompt(null); setAppInstalled(true); });
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);
  const [statelessType, setStatelessType] = useState(null);
  const [ocEdit, setOcEdit] = useState(null);
  const [adminForm, setAdminForm]   = useState(null);
  const [slotsView, setSlotsView]   = useState(null);
  const [confirmDel, setConfirmDel] = useState(null);
  const [askSecondApprovalDelete, setAskSecondApprovalDelete] = useState(false);
  useEffect(() => { LS.set(STORAGE.VIEW_MODE, viewMode); }, [viewMode]);
  useEffect(() => { LS.set(STORAGE.ROLE, devRole); }, [devRole]);
  useEffect(() => { LS.set(STORAGE.CART, cart); }, [cart]);

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

        if (!cancelled) {
          setProfile(p);
          if (p.role === 'owner' || p.role === 'admin') {
            fetchWebhookConfig().then(setWebhookConfig).catch(() => {});
          }
          fetchSubmissionControls().then(setSubmissionControls).catch(() => {});
        }
      } catch (e) {
        console.warn('[NARP] profile fetch failed:', e);
        if (!cancelled) setProfile(null);
      }
    };

    refreshProfile();
    const unsub = onAuthChange(() => { refreshProfile(); });
    return () => { cancelled = true; unsub(); };
  }, [supabaseReady]);

  const handleSignIn    = async () => { try { await signInWithDiscord(); } catch (e) { alert('Sign-in failed: ' + e.message); } };
  const handleDevSignIn = async () => { await signInWithDevAccess(); };
  const handleSignOut = async () => { try { await signOut(); setProfile(null); setViewAsRole(null); } catch (e) { console.warn('[NARP] sign-out failed:', e); } };

  const refreshPending = useCallback(async () => {
    if (!supabaseReady || (!isStaff && !profile?.id)) { setPendingJutsus([]); setMyOwnSubmissions([]); setPendingLoaded(false); return; }
    try {
      const list = await fetchPendingJutsus();

      // Own submissions always tracked separately so staff can see them in My Submissions
      const own = list.filter(p => p.submitted_by === profile?.id)
        .sort((a, b) => new Date(b.submitted_at || 0) - new Date(a.submitted_at || 0));
      setMyOwnSubmissions(own);

      // Staff see all submissions EXCEPT their own in the Pending review tab
      const filtered = isStaff
        ? list.filter(p => p.submitted_by !== profile?.id)
        : [];
      
      const sorted = [...filtered].sort((a, b) => {
        const getPriorityWeight = (p) => {
          // Priority 1: status === 'pending_approval' ('Needs 2nd Approval')
          if (p.status === 'pending_approval') {
            return 1;
          }
          
          const isClaimed = p.assigned_to !== null && p.assigned_to !== undefined && 
            (typeof p.assigned_to === 'object' ? p.assigned_to.id !== null : p.assigned_to !== '');
            
          // Priority 2: Unclaimed (status === 'pending_review' ('Awaiting Reviewer'))
          if (p.status === 'pending_review' && !isClaimed) {
            return 2;
          }
          
          const assignedId = typeof p.assigned_to === 'object' ? p.assigned_to?.id : p.assigned_to;
          
          // Priority 3: Claimed by the current reviewer
          if (assignedId === profile?.id) {
            return 3;
          }
          
          // Priority 4: Claimed by other reviewers or other states
          return 4;
        };

        const wA = getPriorityWeight(a);
        const wB = getPriorityWeight(b);
        
        if (wA !== wB) {
          return wA - wB;
        }

        // Sub-sort by submitted_at ascending (oldest first).
        const timeA = new Date(a.submitted_at || 0).getTime();
        const timeB = new Date(b.submitted_at || 0).getTime();
        return timeA - timeB;
      });

      setPendingJutsus(sorted);
      setPendingLoaded(true);
      setRefreshTrigger(prev => prev + 1);
    } catch (e) {
      console.warn('[NARP] fetchPendingJutsus failed:', e);
    }
  }, [supabaseReady, isStaff, profile?.id]);

  useEffect(() => { refreshPending(); }, [refreshPending]);

  useEffect(() => {
    if (!supabaseReady || !profile?.id) return;
    fetchChatOverview().then(setChatThreads).catch(() => {});
    if (isStaff) fetchMyParticipatingChatIds(profile.id).then(setMyParticipatingIds).catch(() => {});
  }, [supabaseReady, isStaff, profile?.id]);

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

  useEffect(() => { tabRef.current = tab; }, [tab]);

  useEffect(() => {
    if (!supabaseReady || !profile) return;
    let channel = null;
    let pendingDebounce = null;
    let catalogDebounce = null;
    try {
      channel = subscribeToDatabaseChanges((payload) => {
        const table = payload?.table;
        const eventType = payload?.eventType;
        if (table === 'pending_jutsus') {
          if (eventType === 'UPDATE' && payload?.new?.id) {
            // Patch only the changed row — avoids a full round-trip on every status change
            setPendingJutsus(prev => prev.map(p =>
              p.id === payload.new.id ? { ...p, ...payload.new } : p
            ));
          } else {
            // INSERT or DELETE: need full refresh (INSERT needs joined profile data)
            clearTimeout(pendingDebounce);
            pendingDebounce = setTimeout(() => refreshPending(), 300);
          }
        } else if (table === 'jutsus' || table === 'bloodlines') {
          clearTimeout(catalogDebounce);
          catalogDebounce = setTimeout(() => refreshDB(), 500);
        }
        // pending_chats: keep the inbox overview fresh on any change (sends,
        // edits, deletes) and fire a browser notification for others' messages
        if (table === 'pending_chats') {
          fetchChatOverview().then(setChatThreads).catch(() => {});
          if (eventType === 'INSERT' && payload?.new?.sender_id !== profile?.id) {
            const submission =
              pendingJutsusRef.current.find(p => p.id === payload.new?.pending_id) ||
              myOwnSubmissionsRef.current.find(p => p.id === payload.new?.pending_id);
            const subName = submission?.data?.name || 'a submission';
            const rawMsg = payload.new?.message || '';
            showChatNotification({
              title: `New message — ${subName}`,
              body: rawMsg.startsWith(JOIN_PREFIX)
                ? `👋 ${rawMsg.replace(JOIN_PREFIX, '').trim()}`.slice(0, 80)
                : rawMsg.slice(0, 80),
              tag: `pending-${payload.new?.pending_id}`,
            });
            if (profile?.id) fetchMyParticipatingChatIds(profile.id).then(setMyParticipatingIds).catch(() => {});
          }
        }
        if (profile && tabRef.current !== 'inbox') setInboxHasNew(true);
      });
    } catch (err) {
      console.warn('[NARP] Failed to subscribe to database changes:', err);
    }
    return () => {
      clearTimeout(pendingDebounce);
      clearTimeout(catalogDebounce);
      if (channel) {
        try {
          supabase.removeChannel(channel);
        } catch (err) {
          console.warn('[NARP] Failed to remove database subscription channel:', err);
        }
      }
    };
  }, [supabaseReady, profile, refreshDB, refreshPending, isStaff]);

  // 30-second polling to catch submissions missed by realtime
  useEffect(() => {
    if (!supabaseReady || !profile) return;
    const interval = setInterval(() => {
      refreshPending();
    }, 30000);
    return () => clearInterval(interval);
  }, [supabaseReady, profile, refreshPending]);

  // Raise pending-tab badge when count grows while user is on another tab
  useEffect(() => {
    if (!pendingLoaded) return;
    if (prevPendingCountRef.current !== null && pendingJutsus.length > prevPendingCountRef.current && tabRef.current !== 'inbox') {
      setInboxHasNew(true);
    }
    prevPendingCountRef.current = pendingJutsus.length;
    pendingJutsusRef.current = pendingJutsus;
    myOwnSubmissionsRef.current = myOwnSubmissions;
  }, [pendingJutsus, pendingLoaded, myOwnSubmissions]);

  const submitChange = useCallback(async ({ tab: t, operation, targetId, entity, askSecondApproval }) => {
    const isJutsus = t === 'jutsus';

    if (adminForm?.isPendingEdit) {
      if (!supabaseReady) return true;
      const payload = entity ? buildJutsuPayload(entity, true) : null;
      await updatePendingJutsuData(adminForm.pendingId, payload);
      await refreshPending();
      return false;
    }

    const shouldGoToPending = isJutsus && (
      ((role === 'user' || role === 'staff') && !isAdmin) ||
      (isAdmin && askSecondApproval)
    );

    if (shouldGoToPending) {
      if (!supabaseReady) {
        applyChangeLocally(t, operation, targetId, entity);
        return true;
      }
      const payload = entity ? buildJutsuPayload(entity, operation === 'update') : null;
      const status = 'pending_review';
      await submitPendingJutsu(operation, targetId, payload, status);

      const tab = t;
      fetch('/.netlify/functions/reviewer-ping', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          triggerType: 'creation',
          itemName: entity?.name || 'Unknown',
          itemType: tab === 'jutsus' ? 'Jutsu' : 'Bloodline',
          submitterName: profile?.username || 'Unknown',
        }),
      }).catch((err) => {
        console.warn('[NARP] Reviewer ping creation alert failed:', err);
      });

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
              await sendDiscordLog(entity, 'Approved', profile, profile, profile, null, webhookConfig);
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
    if (approvingIds.has(id)) return;
    setApprovingIds(prev => new Set([...prev, id]));
    try {
      // Optimistic: remove immediately so the UI doesn't hang
      setPendingJutsus(prev => prev.filter(p => p.id !== id));
      // Log the approval to Discord before committing it. The submitter is the
      // staff member who queued the entry; the current user is the reviewer
      // (the "2nd pair of eyes" in the double-approver workflow).
      const item = pendingJutsus.find(p => p.id === id);
      if (item) {
        const isDelete = item.operation === 'delete';
        const rawDisplayData = isDelete
          ? ((db.jutsus || []).find(j => j._id === item.target_id) || { name: 'Unknown' })
          : item.data;
        // Preserve original submission timestamp so Discord log shows correct Creation Date
        const displayData = isDelete ? rawDisplayData : {
          ...rawDisplayData,
          _createdAt: rawDisplayData?._createdAt || item.submitted_at,
        };

        const isCharacter = item.data?.type === 'Character';

        // Auto-insert the approved character into their bloodline's roster
        // slots (name + character-area link). A granted reservation held for
        // this entry is converted into the real slot. If the bloodline is
        // genuinely full, abort the approval so the reviewers can resolve it.
        if (isCharacter && item.data?.bloodline) {
          const slotSess = await getCurrentSession();
          const slotRes = await fetch('/.netlify/functions/manage-bloodline-slot', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...(slotSess?.access_token ? { Authorization: `Bearer ${slotSess.access_token}` } : {}),
            },
            body: JSON.stringify({
              action: 'fill',
              bloodline: item.data.bloodline,
              pendingId: id,
              name: item.data.name || 'OC',
              link: item.data.myCharactersLink || '',
            }),
          }).catch(() => null);
          if (!slotRes || !slotRes.ok) {
            const out = slotRes ? await slotRes.json().catch(() => ({})) : {};
            throw new Error(out.error || 'Could not add the character to its bloodline roster. Approval aborted.');
          }
        }

        // Automated roster insertion (squads / elite sections / council).
        // Must run while the pending row still exists; a failure here doesn't
        // block the approval — staff can add the entry manually.
        if (isCharacter) {
          try {
            const rosterSess = await getCurrentSession();
            const rosterRes = await fetch('/.netlify/functions/roster-auto-insert', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                ...(rosterSess?.access_token ? { Authorization: `Bearer ${rosterSess.access_token}` } : {}),
              },
              body: JSON.stringify({ pendingId: id }),
            });
            const rosterOut = await rosterRes.json().catch(() => ({}));
            if (!rosterRes.ok) {
              alert('Heads up: the character was approved, but automatic roster insertion failed ('
                + (rosterOut.error || rosterRes.status) + '). Please add them to the roster manually.');
            } else if (rosterOut.warnings?.length) {
              alert('Roster note: ' + rosterOut.warnings.join(' '));
            }
          } catch (rosterErr) {
            console.warn('[NARP] Roster auto-insert failed:', rosterErr);
          }
        }

        // Automated Discord role grant: village (or Wanderer) + ninja rank
        // (+ Councilor with Jōnin) + the OC-count role picked at submission
        // (higher counts strip the lower ones). Failures never block the
        // approval — the reviewer is told to grant manually instead.
        if (isCharacter) {
          if (item.submitter?.discord_id) {
            try {
              const { add, remove } = rolesForApprovedOC(item.data);
              await applyDiscordRoles({
                discordUserId: item.submitter.discord_id,
                add,
                remove,
                reason: `OC "${item.data?.name || 'OC'}" fully approved`,
              });
            } catch (roleErr) {
              console.warn('[NARP] Approval role grant failed:', roleErr);
              alert('Approved, but granting the Discord roles (village/rank/OC count) failed — please assign them manually. (' + (roleErr.message || roleErr) + ')');
            }
          } else {
            alert('Approved, but the submitter has no linked Discord ID — assign their village/rank/OC-count roles manually.');
          }
        }

        let logData = null;
        try {
          const chats = await fetchReviewChats(id);
          let chatTranscript = null;
          if (chats && chats.length > 0) {
            chatTranscript = chats.map(c => {
              const time = c.created_at ? new Date(c.created_at).toLocaleString() : 'N/A';
              const name = c.profiles?.site_nickname || c.profiles?.username || 'Unknown';
              if (c.is_deleted) return `[${time}] ${name}:\n[Message deleted by sender]`;
              const msgText = c.message || '';
              const editNote = c.is_edited && c.original_message
                ? `\n  [Edited — original: ${c.original_message}]`
                : c.is_edited ? '\n  [Edited]' : '';
              return `[${time}] ${name}:\n${msgText}${editNote}`;
            }).join('\n\n') + '\n\n';
          }
          logData = await sendDiscordLog(
            displayData,
            isDelete ? 'Deleted' : 'Approved',
            item.submitter,
            item.first_reviewer,
            profile,
            chatTranscript,
            webhookConfig
          );
        } catch (discordErr) {
          console.warn('[NARP] Pre-flight/Discord notification failed:', discordErr);
        }

        const approvalItemName = isCharacter
          ? (displayData?.name && displayData.name !== 'OC Submission' ? displayData.name : 'OC Submission')
          : (displayData?.name || 'Unknown');
        const approvalDocLink = displayData?.link || 'N/A';
        const mainLogUrl = logData
          ? `https://discord.com/channels/${import.meta.env.VITE_DISCORD_GUILD_ID}/${logData.threadId}/${logData.messageId}`
          : '';
        const sess = await getCurrentSession();
        const authHdr = sess?.access_token ? { Authorization: `Bearer ${sess.access_token}` } : {};

        // Single work log embed per reviewer at approval time, labelled by role.
        const firstReviewer = item.first_reviewer;
        const hasDifferentFirstReviewer = item.operation === 'insert' && firstReviewer?.work_thread_id && firstReviewer.id !== profile?.id;
        if (item.operation === 'insert' && profile?.work_thread_id) {
          try {
            // "Second Reviewer" when a different person did first check; "Solo Approver" otherwise.
            const actionType = hasDifferentFirstReviewer ? 'Second Reviewer' : 'Solo Approver';
            await fetch('/.netlify/functions/reviewer-work-log', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', ...authHdr },
              body: JSON.stringify({
                threadId: profile.work_thread_id,
                reviewerId: profile.discord_id,
                reviewerName: profile.username,
                actionType,
                itemName: approvalItemName,
                docLink: approvalDocLink,
                mainLogUrl,
                myCharactersLink: displayData?.myCharactersLink || '',
                upgradesLink: displayData?.upgradesLink || '',
              }),
            });
          } catch (workLogErr) {
            console.warn('[NARP] Final approver work log failed:', workLogErr);
          }
        }

        // First reviewer's embed — sent at approval so it includes the log URL and all links.
        if (hasDifferentFirstReviewer) {
          try {
            await fetch('/.netlify/functions/reviewer-work-log', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', ...authHdr },
              body: JSON.stringify({
                threadId: firstReviewer.work_thread_id,
                reviewerId: firstReviewer.discord_id,
                reviewerName: firstReviewer.username,
                actionType: 'First Reviewer',
                itemName: approvalItemName,
                docLink: approvalDocLink,
                mainLogUrl,
                myCharactersLink: displayData?.myCharactersLink || '',
                upgradesLink: displayData?.upgradesLink || '',
              }),
            });
          } catch (workLogErr) {
            console.warn('[NARP] First reviewer work log failed:', workLogErr);
          }
        }

        const isSummonOrItem = item.data?.type === 'Summon' || item.data?.type === 'Custom Item';

        // DM submitter — approved
        if (item?.submitter?.discord_id) {
          const approvedMsg = (isCharacter || isSummonOrItem)
            ? `🎉 Your submission **${approvalItemName}** has been **approved**!`
            : `🎉 Your submission **${approvalItemName}** has been **approved**! It's now live in the database.`;
          fetch('/.netlify/functions/discord-dm', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...authHdr },
            body: JSON.stringify({
              discordUserId: item.submitter.discord_id,
              message: approvedMsg,
            }),
          }).catch(err => console.warn('[NARP] Approval DM failed:', err));
        }
        if (isCharacter || isSummonOrItem) {
          await cancelPendingJutsu(id); // No DB table write — remove from pending only
        } else {
          await approvePendingJutsu(id); // Standard database merge RPC
        }
      }

      // Optimistic update already removed the card; let realtime subscription sync any
      // stragglers. Fire a background refresh so the list stays consistent without blocking.
      setTimeout(() => refreshPending(), 1500);
    } catch (e) {
      alert('Approve failed: ' + e.message);
      // The optimistic removal already hid the card — restore the real state.
      refreshPending();
    } finally {
      setApprovingIds(prev => { const n = new Set(prev); n.delete(id); return n; });
    }
  };

  const handleDirectSummonItemUpload = useCallback(async (data) => {
    const entryData = { ...data, _createdAt: new Date().toISOString() };
    const logData = await sendDiscordLog(entryData, 'Approved', profile, null, profile, null, webhookConfig);

    if (profile?.work_thread_id) {
      const sess = await getCurrentSession();
      const authHdr = sess?.access_token ? { Authorization: `Bearer ${sess.access_token}` } : {};
      const mainLogUrl = logData
        ? `https://discord.com/channels/${import.meta.env.VITE_DISCORD_GUILD_ID}/${logData.threadId}/${logData.messageId}`
        : '';
      await fetch('/.netlify/functions/reviewer-work-log', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHdr },
        body: JSON.stringify({
          threadId: profile.work_thread_id,
          reviewerId: profile.discord_id,
          reviewerName: profile.username,
          actionType: 'Direct Upload',
          itemName: data.name || `${data.type} Submission`,
          docLink: data.link || 'N/A',
          mainLogUrl,
          myCharactersLink: '',
          upgradesLink: '',
        }),
      }).catch(err => console.warn('[NARP] Direct upload work log failed:', err));
    }
  }, [profile, webhookConfig]);

  // Frees the bloodline slot held by a granted Réservation Request. Called
  // before an entry is denied/retracted so reserved slots never leak.
  const releaseReservedSlot = async (item) => {
    if (item?.data?.subType !== 'reservation_request') return;
    if (item.data?.reservationStatus !== 'granted' || !item.data?.bloodline) return;
    try {
      const sess = await getCurrentSession();
      await fetch('/.netlify/functions/manage-bloodline-slot', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(sess?.access_token ? { Authorization: `Bearer ${sess.access_token}` } : {}),
        },
        body: JSON.stringify({ action: 'release', bloodline: item.data.bloodline, pendingId: item.id }),
      });
    } catch (err) {
      console.warn('[NARP] Failed to release reserved bloodline slot:', err);
    }
  };

  const handleCancelPending = async (id) => {
    try {
      // Optimistic: remove immediately so the UI doesn't hang
      setPendingJutsus(prev => prev.filter(p => p.id !== id));
      // Log the denial to Discord before removing the pending entry.
      const item = pendingJutsus.find(p => p.id === id);
      if (item) {
        await releaseReservedSlot(item);
        const isDelete = item.operation === 'delete';
        const displayData = isDelete
          ? ((db.jutsus || []).find(j => j._id === item.target_id) || { name: 'Unknown' })
          : item.data;

        // Detect whether this submission was ever claimed
        const wasEverClaimed = !!(item.assigned_to && (
          typeof item.assigned_to === 'object'
            ? item.assigned_to.id
            : (typeof item.assigned_to === 'string' && item.assigned_to.trim() !== '')
        ));

        let chats = [];
        let logData = null;
        try {
          chats = (await fetchReviewChats(id)) || [];
          let chatTranscript = null;
          if (chats.length > 0) {
            chatTranscript = chats.map(c => {
              const time = c.created_at ? new Date(c.created_at).toLocaleString() : 'N/A';
              const name = c.profiles?.site_nickname || c.profiles?.username || 'Unknown';
              if (c.is_deleted) return `[${time}] ${name}:\n[Message deleted by sender]`;
              const msgText = c.message || '';
              const editNote = c.is_edited && c.original_message
                ? `\n  [Edited — original: ${c.original_message}]`
                : c.is_edited ? '\n  [Edited]' : '';
              return `[${time}] ${name}:\n${msgText}${editNote}`;
            }).join('\n\n') + '\n\n';
          }
          logData = await sendDiscordLog(displayData, 'Denied', item.submitter, item.first_reviewer, profile, chatTranscript, webhookConfig);
        } catch (discordErr) {
          console.warn('[NARP] Pre-flight/Discord notification failed:', discordErr);
        }

        const denialItemName = displayData?.name || 'Unknown';
        const denialDocLink = displayData?.link || 'N/A';
        const denialLogUrl = logData
          ? `https://discord.com/channels/${import.meta.env.VITE_DISCORD_GUILD_ID}/${logData.threadId}/${logData.messageId}`
          : '';
        const sess = await getCurrentSession();
        const authHdr = sess?.access_token ? { Authorization: `Bearer ${sess.access_token}` } : {};

        if (item.operation === 'insert' && profile?.work_thread_id) {
          try {
            await fetch('/.netlify/functions/reviewer-work-log', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', ...authHdr },
              body: JSON.stringify({
                threadId: profile.work_thread_id,
                reviewerId: profile.discord_id,
                reviewerName: profile.username,
                actionType: 'Denied',
                itemName: denialItemName,
                docLink: denialDocLink,
                mainLogUrl: denialLogUrl,
              }),
            });
          } catch (workLogErr) {
            console.warn('[NARP] Reviewer work log failed:', workLogErr);
          }
        }

        // DM submitter — only when there was real engagement (claimed or chat happened)
        const hasChatActivity = chats.length > 0;
        if ((wasEverClaimed || hasChatActivity) && item?.submitter?.discord_id) {
          fetch('/.netlify/functions/discord-dm', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...authHdr },
            body: JSON.stringify({
              discordUserId: item.submitter.discord_id,
              message: `❌ Your submission **${denialItemName}** has been **denied** by the review team. Please check the Review Chat for feedback.`,
            }),
          }).catch(err => console.warn('[NARP] Denial DM failed:', err));
        }
      }

      await cancelPendingJutsu(id);
      setTimeout(() => refreshPending(), 1500);
    } catch (e) {
      alert('Cancel failed: ' + e.message);
    }
  };

  const handleReviewPending = async (id) => {
    try {
      if (!profile?.id) return;

      const item = pendingJutsus.find(p => p.id === id);
      const op = item?.operation;
      const display = op === 'delete' ? ((db.jutsus || []).find(j => j._id === item?.target_id) || {}) : (item?.data || {});
      const itemName = display.name || 'Unknown Jutsu';
      const itemType = 'Jutsu';

      // Optimistic: update status immediately so re-ordering happens at once
      setPendingJutsus(prev => prev.map(p =>
        p.id === id ? { ...p, status: 'pending_approval', first_reviewer_id: profile.id, first_reviewer: profile } : p
      ));

      await reviewPendingJutsu(id, profile.id);

      // No work log embed at first-check time — the single combined embed is sent at approval.

      fetch('/.netlify/functions/reviewer-ping', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ triggerType: 'second_approval', itemName, itemType }),
      }).catch((pingErr) => {
        console.warn('Failed to send reviewer second approval ping:', pingErr);
      });

      // DM submitter — their entry passed first check
      if (item?.submitter?.discord_id) {
        getCurrentSession().then(sess => {
          const authHdr = sess?.access_token ? { Authorization: `Bearer ${sess.access_token}` } : {};
          fetch('/.netlify/functions/discord-dm', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...authHdr },
            body: JSON.stringify({
              discordUserId: item.submitter.discord_id,
              message: `✅ Your submission **${itemName}** passed its first review check! It's now awaiting final approval from a second reviewer.`,
            }),
          }).catch(err => console.warn('[NARP] First check DM failed:', err));
        });
      }

      await refreshPending();
    } catch (e) {
      alert('Review failed: ' + e.message);
    }
  };

  const handleClaimPending = async (id) => {
    try {
      if (!profile?.id) return;
      // Optimistic: show as claimed immediately
      setPendingJutsus(prev => prev.map(p =>
        p.id === id ? { ...p, assigned_to: profile.id, assignee: profile } : p
      ));
      await claimPendingSubmission(id, profile.id);

      // DM the submitter to let them know their entry was claimed
      const item = pendingJutsus.find(p => p.id === id);
      if (item?.submitter?.discord_id) {
        const itemName = (item.data || {}).name || 'your submission';
        getCurrentSession().then(sess => {
          const authHdr = sess?.access_token ? { Authorization: `Bearer ${sess.access_token}` } : {};
          fetch('/.netlify/functions/discord-dm', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...authHdr },
            body: JSON.stringify({
              discordUserId: item.submitter.discord_id,
              message: `📋 **${profile.username || 'A reviewer'}** has claimed your submission **${itemName}** for review. You can now open the Review Chat to discuss it!`,
            }),
          }).catch(err => console.warn('[NARP] Claim DM failed:', err));
        });
      }

      await refreshPending();
    } catch (e) {
      alert('Claim failed: ' + e.message);
    }
  };

  const handleSubmitterCancelPending = async (id) => {
    try {
      const item = pendingJutsus.find(p => p.id === id) || myOwnSubmissions.find(p => p.id === id);
      await releaseReservedSlot(item);
      const itemName = (item?.data || {}).name || 'Unknown Submission';
      const itemType = 'Jutsu';

      // Post a plain retraction notice to the Discord log channel — no work log
      fetch('/.netlify/functions/reviewer-ping', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ triggerType: 'retracted', itemName, itemType }),
      }).catch(err => console.warn('[NARP] Retraction ping failed:', err));

      await cancelPendingJutsu(id);
      await refreshPending();
    } catch (e) {
      alert('Cancel failed: ' + e.message);
    }
  };

  const handleEditPending = (pendingItem) => {
    // OC submissions get their own form; everything else uses the jutsu form.
    if (pendingItem.data?.type === 'Character') {
      setOcEdit(pendingItem);
      return;
    }
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

  const sortedJutsuTypeTags = useMemo(() => {
    const tags = db.jutsuTypeTags || [];
    if (f.sort === 'za')     return [...tags].sort((a, b) => b.localeCompare(a));
    if (f.sort === 'oldest') return [...tags];
    if (f.sort === 'newest') return [...tags].reverse();
    return [...tags].sort((a, b) => a.localeCompare(b));
  }, [db.jutsuTypeTags, f.sort]);

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
      (!f.jty.length || f.jty.some(t => toArray(j.jutsu_type).includes(t))) &&
      (!f.rnk.length || f.rnk.some(r => toArray(j.rank).includes(r))) &&
      (!f.bm.length  || f.bm.includes(j.bm_tier)) &&
      (!f.bl.length  || f.bl.includes(j.bloodline)) &&
      (!f.lck || j.locked)    && (!f.lim || j.limited)    && (!f.pve || j.pve)    && (!f.mul || j.multiRank) &&
      (!f.hLck || !j.locked)  && (!f.hLim || !j.limited)  && (!f.hPve || !j.pve)  && (!f.hMul || !j.multiRank) &&
      (!f.hMP  || !toArray(j.types).includes('Multi-Post')) &&
      (!f.hAsk || !getSlotStatus(j.slots).showAskStaff)
    ).sort(sortByJutsu);
  }, [db.jutsus, f, sortByJutsu]);

  /* ---- Messages inbox: join chat threads with their pending submissions ---- */
  const chatThreadById = useMemo(
    () => new Map(chatThreads.map(t => [t.pending_id, t])),
    [chatThreads]
  );

  // Most recent public message per submission (feeds Recent Chat Activity)
  const recentChats = useMemo(
    () => chatThreads
      .map(t => t.lastMessage)
      .filter(Boolean)
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
      .slice(0, 20),
    [chatThreads]
  );

  /*
   * Inbox tab data (merged Messages + Pending + My Submissions). Every
   * pending item relevant to the viewer gets an entry here, including ones
   * with zero chat messages yet — a freshly-submitted, unclaimed item is
   * exactly what the old Pending tab existed to surface, so it must not
   * disappear just because nobody has said anything about it yet. Items
   * with no thread get status 'unclaimed' rather than being folded into
   * 'awaiting_them', since no reviewer has actually engaged yet.
   *
   * Post-merge, staff see every pending item here — unclaimed and
   * claimed-by-others included — not just ones they've personally claimed
   * or messaged in. That's intentional: folding the old Pending tab's
   * full-queue discovery function into Inbox requires the same visibility
   * here; restricting it back down would silently kill that function.
   */
  const inboxItems = useMemo(() => {
    if (!profile?.id) return [];
    const seen = new Set();
    const source = [];
    for (const p of [...myOwnSubmissions, ...(isStaff ? pendingJutsus : [])]) {
      if (!seen.has(p.id)) { seen.add(p.id); source.push(p); }
    }
    return source.map(p => {
      const thread = chatThreadById.get(p.id);
      if (!thread?.lastMessage) {
        return { pending: p, messages: [], lastMessage: null, turn: null, unreadCount: 0, status: 'unclaimed' };
      }
      const iAmSubmitter = p.submitted_by === profile.id;
      const turn = getChatTurn(thread.lastMessage, profile.id, iAmSubmitter);
      const readAt = chatReadMap[p.id] ? new Date(chatReadMap[p.id]).getTime() : 0;
      const unreadCount = thread.messages.filter(m =>
        m.sender_id !== profile.id && new Date(m.created_at).getTime() > readAt
      ).length;
      const status = p.status === 'pending_approval'
        ? 'ready'
        : (turn === 'you' ? 'awaiting_you' : 'awaiting_them');
      return { pending: p, messages: thread.messages, lastMessage: thread.lastMessage, turn, unreadCount, status };
    });
  }, [chatThreadById, pendingJutsus, myOwnSubmissions, profile?.id, isStaff, chatReadMap]);

  const inboxItemById = useMemo(
    () => new Map(inboxItems.map(it => [it.pending.id, it])),
    [inboxItems]
  );

  const inboxUnreadCount = useMemo(
    () => inboxItems.filter(c => c.unreadCount > 0).length,
    [inboxItems]
  );

  const resolvePendingName = useCallback((p) => {
    if (p.operation === 'delete') {
      const original = (db.jutsus || []).find(j => j._id === p.target_id);
      return original?.name ? `Delete: ${original.name}` : '(deletion request)';
    }
    return p.data?.name || '(no name)';
  }, [db.jutsus]);

  // Turn + unread metadata for a pending item, from the current user's view
  const getPendingChatMeta = useCallback((p) => {
    const thread = chatThreadById.get(p.id);
    const last = thread?.lastMessage;
    if (!last) return null;
    const iAmSubmitter = p.submitted_by === profile?.id;
    const turn = getChatTurn(last, profile?.id, iAmSubmitter);
    const readAt = chatReadMap[p.id] ? new Date(chatReadMap[p.id]).getTime() : 0;
    const hasUnread = last.sender_id !== profile?.id && new Date(last.created_at).getTime() > readAt;
    return { turn, hasUnread, lastMessage: last };
  }, [chatThreadById, profile?.id, chatReadMap]);

  if (loading) {
    return (
      <div className="w-full h-screen bg-black flex flex-col items-center justify-center gap-4">
        <div className="w-8 h-8 border-3 border-indigo-500 border-t-transparent rounded-full animate-spin"/>
        <p className="text-slate-400 text-sm font-semibold">Loading...</p>
      </div>
    );
  }

  const TABS = [
    { id: 'jutsus',     label: 'Jutsus',     count: (db.jutsus || []).length },
    { id: 'bloodlines', label: 'Bloodlines', count: (db.bloodlines || []).length },
    ...(profile ? [{ id: 'inbox', label: 'Inbox', count: inboxItems.length, unread: inboxUnreadCount, hasNew: inboxHasNew }] : []),
    ...(isAdmin ? [{ id: 'members', label: 'Member Board' }] : []),
    { id: 'roster', label: 'Roster' },
  ];

  const switchTab = (tabId) => {
    setTab(tabId);
    if (tabId === 'inbox') setInboxHasNew(false);
    setExpRow(null);
    clearF();
    setF(p => ({ ...p, sort: 'az', showFilters: false }));
  };

  // Pending's four review-queue groups (drawn only from OTHER people's
  // submissions), plus a fifth bucket for the viewer's own — folding My
  // Submissions in. For non-staff players, pendingJutsus is always empty
  // (see refreshPending), so only "My Submissions" ever renders for them.
  const pendingGroupClaimedByMe = pendingJutsus.filter(p => getPendingAssignedId(p) === profile?.id);
  const pendingGroupRest = pendingJutsus.filter(p => getPendingAssignedId(p) !== profile?.id);
  const pendingGroupApproval = pendingGroupRest.filter(p => p.status === 'pending_approval');
  const pendingGroupNeeds = pendingGroupRest.filter(p => p.status === 'pending_review' && !getPendingAssignedId(p));
  const pendingGroupOthers = pendingGroupRest.filter(p => !(p.status === 'pending_approval') && !(p.status === 'pending_review' && !getPendingAssignedId(p)));
  const pendingGroups = [
    { key: 'mine',       label: 'Claimed by Me',     emoji: '⭐', items: pendingGroupClaimedByMe },
    { key: 'approval',   label: 'Pending Approval',   emoji: '🔵', items: pendingGroupApproval },
    { key: 'needs',      label: 'Needs Reviewer',     emoji: '🟡', items: pendingGroupNeeds },
    { key: 'others',     label: 'Claimed by Others',  emoji: '⬜', items: pendingGroupOthers },
    { key: 'my_submissions', label: 'My Submissions', emoji: '📝', items: myOwnSubmissions },
  ].filter(g => g.items.length > 0);
  const selectedInboxItem = pendingJutsus.find(p => p.id === selectedInboxId)
    || myOwnSubmissions.find(p => p.id === selectedInboxId)
    || null;
  // For staff, only surface recent chats for submissions they claimed or messaged in.
  // Admins and owners see all.
  const visibleRecentChats = ['admin', 'owner'].includes(role)
    ? recentChats
    : recentChats.filter(c => {
        const claimed = getPendingAssignedId(pendingJutsus.find(p => p.id === c.pending_id)) === profile?.id;
        return claimed || myParticipatingIds.has(c.pending_id);
      });

  return (
    <div className="w-full min-h-screen bg-slate-200 flex flex-col font-sans text-slate-900">

      {/* HEADER AND FILTER BAR STICKY WRAPPER */}
      <div ref={headerRef} className="sticky top-0 z-40 shrink-0 flex flex-col shadow-lg">
        {/* HEADER */}
        <div className="bg-black text-white p-4 flex flex-col sm:flex-row justify-between items-center gap-3">
          <h1 className="text-lg font-bold tracking-widest uppercase flex items-center gap-2 w-full sm:w-auto justify-center sm:justify-start">
            <Icon n="Book" size={18} className="text-red-500" />
            <button onClick={() => setModals(m => ({ ...m, credits: true }))} className="hover:text-indigo-300">NARP Database</button>
          </h1>
          <div className="flex items-center gap-2 flex-wrap w-full sm:w-auto justify-center sm:justify-end pb-1 sm:pb-0">
            <div className="flex items-center gap-2">
              {isStaff && (
                <button
                  onClick={refreshDB}
                  disabled={refreshing}
                  title="Refresh Data"
                  className="p-2 rounded-lg border border-slate-700 bg-slate-800 text-slate-300 hover:bg-slate-700 disabled:opacity-40 transition-colors shrink-0">
                  <Icon n="Refresh" size={15} className={refreshing ? 'animate-spin' : ''} />
                </button>
              )}
              {isStaff && (
                <button onClick={() => setModals(m => ({ ...m, system: true }))}
                        className="text-xs px-3 py-1.5 font-bold rounded-lg border border-slate-700 bg-slate-800 text-slate-200 hover:bg-slate-700 flex items-center gap-1.5 shrink-0">
                  <Icon n="Settings" size={14}/>
                  <span className="hidden sm:inline">System Tools</span>
                </button>
              )}
              {'Notification' in window && profile && (
                <div className="relative shrink-0">
                  <button
                    type="button"
                    title={appNotifEnabled && appNotifPermission === 'granted' ? 'Chat notifications ON — click to disable' : appNotifPermission === 'denied' ? 'Notifications blocked in browser settings' : 'Enable chat notifications'}
                    onClick={async () => {
                      if (appNotifEnabled) {
                        setNotifEnabled(false);
                        setAppNotifEnabled(false);
                        setAppNotifDenied(false);
                        try {
                          const endpoint = await unsubscribeFromPush();
                          if (endpoint) await deletePushSubscription(endpoint);
                        } catch (e) {
                          console.warn('[NARP] Failed to unsubscribe from push:', e);
                        }
                      } else {
                        const perm = await requestNotifPermission();
                        setAppNotifPermission(perm);
                        if (perm === 'granted') {
                          setNotifEnabled(true);
                          setAppNotifEnabled(true);
                          setAppNotifDenied(false);
                          try {
                            const pushSub = await subscribeToPush();
                            if (pushSub) {
                              await savePushSubscription(pushSub);
                              // Immediately send a confirmation push so the user can
                              // verify the full server-side pipeline from one device.
                              try {
                                const { data: { session } } = await supabase.auth.getSession();
                                if (session?.access_token) {
                                  const res = await fetch('/.netlify/functions/send-test-push', {
                                    method: 'POST',
                                    headers: { Authorization: `Bearer ${session.access_token}` },
                                  });
                                  const out = await res.json().catch(() => ({}));
                                  if (!res.ok || !out.sent) {
                                    console.warn('[NARP] Test push not delivered:', res.status, out);
                                    alert(
                                      'Notifications are enabled, but the confirmation push could not be sent' +
                                      (out.error ? ` (${out.error})` : '') +
                                      '. Double-check the VAPID_* keys in the Netlify environment variables.'
                                    );
                                  }
                                }
                              } catch (e) {
                                console.warn('[NARP] Test push request failed:', e);
                              }
                            } else {
                              console.warn('[NARP] Notifications enabled but no push subscription was created (check VAPID config / service worker).');
                            }
                          } catch (e) {
                            console.warn('[NARP] Failed to subscribe to push:', e);
                          }
                        } else {
                          setAppNotifDenied(true);
                        }
                      }
                    }}
                    className={`p-2 rounded-lg border transition-colors shrink-0 ${appNotifEnabled && appNotifPermission === 'granted' ? 'border-indigo-500 bg-indigo-600 text-white hover:bg-indigo-500' : 'border-slate-700 bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-slate-200'}`}
                  >
                    <svg viewBox="0 0 24 24" width="15" height="15" fill={appNotifEnabled && appNotifPermission === 'granted' ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 0 1-3.46 0" />
                    </svg>
                  </button>
                  {appNotifDenied && (
                    <div className="absolute top-full right-0 mt-1 w-48 bg-rose-600 text-white text-[10px] font-semibold px-2.5 py-1.5 rounded-lg shadow-lg z-50 whitespace-normal">
                      Notifications blocked. Enable in your browser settings.
                    </div>
                  )}
                </div>
              )}
              {tab === 'jutsus' && (
                <div className="flex items-center bg-slate-800 p-1 rounded-lg border border-slate-700 mr-2 shrink-0">
                  <button onClick={() => setViewMode('card')} className={`p-1.5 rounded-md ${viewMode === 'card' ? 'bg-slate-700 text-white' : 'text-slate-400'}`}><Icon n="Grid" size={14}/></button>
                  <button onClick={() => setViewMode('row')}  className={`p-1.5 rounded-md ${viewMode === 'row'  ? 'bg-slate-700 text-white' : 'text-slate-400'}`}><Icon n="List" size={14}/></button>
                </div>
              )}
            </div>
            {viewAsRole && (
              <span className="text-[10px] font-bold px-2 py-1 bg-amber-500 text-white rounded-full shrink-0">
                Previewing as {viewAsRole === 'staff' ? 'Reviewer' : viewAsRole}
              </span>
            )}
            <UserMenu
              profile={profile}
              supabaseReady={supabaseReady}
              devRole={devRole}
              onToggleDevRole={setDevRole}
              onSignIn={handleSignIn}
              onDevSignIn={handleDevSignIn}
              onSignOut={handleSignOut}
              onProfileUpdate={setProfile}
              viewAsRole={viewAsRole}
              onSetViewAsRole={setViewAsRole}
            />
          </div>
        </div>

        {/* FILTER BAR — jutsu tab only */}
        {tab === 'jutsus' && (
          <FilterBar
            tab={tab} f={f} setF={setF}
            activeFilterCount={fCount}
            clearF={clearF}
            isAdmin={role !== 'guest'}
            onAdd={() => setAdminForm({ r: {}, tab: 'jutsus' })}
            onOpenStatelessSubmission={setStatelessType}
            submissionControls={submissionControls} />
        )}
      </div>

      {/* FILTER PANEL — outside sticky header, in normal document flow */}
      {tab === 'jutsus' && (
        <FilterBarPanel
          tab={tab} f={f} setF={setF}
          bloodlinesDb={sortedBloodlines}
          specOptions={sortedSpecs}
          jutsuTypeTagOptions={sortedJutsuTypeTags} />
      )}

      {/* TAB BAR */}
      {TABS.length > 1 && (
        <div className="bg-white border-b border-slate-300 shadow-sm shrink-0 sticky z-20" style={{ top: `${headerHeight}px` }}>
          <div className="max-w-6xl mx-auto px-4 flex gap-1 pt-2 overflow-x-auto scrollbar-hide">
            {TABS.map(t => (
              <button key={t.id} onClick={() => switchTab(t.id)}
                      className={`px-4 py-3 text-sm font-bold whitespace-nowrap border-b-2 -mb-px flex items-center gap-2 ${tab === t.id ? 'border-indigo-600 text-indigo-700' : 'border-transparent text-slate-500 hover:text-slate-800'}`}>
                <span className="relative">
                  {t.label}
                  {t.hasNew && tab !== t.id && (
                    <span className="absolute -top-1 -right-2 w-2 h-2 rounded-full bg-red-500 shadow-sm" />
                  )}
                </span>
                {t.count !== undefined && (
                  <span className={`text-[10px] tabular-nums px-2 py-0.5 rounded-full ${tab === t.id ? 'bg-indigo-100' : 'bg-slate-100'}`}>{t.count}</span>
                )}
                {t.unread > 0 && (
                  <span className="text-[10px] font-bold tabular-nums px-1.5 py-0.5 rounded-full bg-red-500 text-white shadow-sm" title={`${t.unread} conversation${t.unread === 1 ? '' : 's'} with unread messages`}>
                    {t.unread}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* MAIN CONTENT */}
      <div className={`flex-1 overflow-y-auto ${tab === 'roster' ? '' : 'p-4 md:p-6 pb-20'}`}>
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
                  {filtJ.slice(0, visibleCount).map(j => (
                    <JutsuCard key={j._id} j={j}
                               viewMode={viewMode} expRow={expRow} setExpRow={setExpRow}
                               pTags={pTags} setPersonalTagsForJutsu={setPersonalTagsForJutsu}
                               handleCopy={handleCopy} cart={cart} copiedId={modals.copiedId}
                               isAdmin={isStaff}
                               isActualAdmin={isAdmin}
                               onEdit={() => setAdminForm({ r: j, tab: 'jutsus' })}
                               onDelete={() => setConfirmDel({ id: j._id, name: j.name })}
                               onViewSlots={(jutsu) => setSlotsView(jutsu)} />
                  ))}
                </div>
                {filtJ.length > visibleCount && (
                  <div className="mt-8 flex flex-col items-center gap-3">
                    <p className="text-xs font-bold text-slate-500 uppercase tracking-wider">
                      Showing {visibleCount} of {filtJ.length} jutsus
                    </p>
                    <button
                      onClick={() => setVisibleCount(prev => prev + 200)}
                      className="bg-indigo-600 hover:bg-indigo-500 text-white px-6 py-2.5 rounded-xl font-bold text-sm shadow-md transition-all flex items-center gap-2"
                    >
                      <Icon n="Plus" size={16} /> Load More
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {tab === 'bloodlines' && (
          <BloodlinesRosterTab
            bloodlines={db.bloodlines || []}
            isAdmin={isAdmin}
            onEdit={(bl) => setAdminForm({ r: bl, tab: 'bloodlines' })}
            bF={bF}
            setBF={setBF}
          />
        )}

        {tab === 'inbox' && profile && (
          <InboxPage
            inboxItems={inboxItems}
            pendingGroups={pendingGroups}
            profile={profile}
            role={role}
            isAdmin={isAdmin}
            isStaff={isStaff}
            selectedId={selectedInboxId}
            onSelect={setSelectedInboxId}
            onMarkRead={markChatRead}
            resolveName={resolvePendingName}
            getPendingChatMeta={getPendingChatMeta}
            refreshTrigger={refreshTrigger}
            refreshPending={refreshPending}
            dbJutsus={db.jutsus || []}
            onApprove={handleApprovePending}
            onCancel={handleCancelPending}
            onSubmitterCancel={handleSubmitterCancelPending}
            onReview={handleReviewPending}
            onEdit={handleEditPending}
            onClaim={handleClaimPending}
            approvingIds={approvingIds}
            collapsedGroups={collapsedGroups}
            setCollapsedGroups={setCollapsedGroups}
            visibleRecentChats={visibleRecentChats}
            pendingLoaded={pendingLoaded}
          />
        )}

        {tab === 'members' && isAdmin && (
          <div className="max-w-6xl mx-auto">
            <div className="bg-white rounded-3xl border border-slate-200 shadow-xs overflow-hidden">
              <div className="bg-slate-900 text-white p-5 flex justify-between items-center shrink-0">
                <div className="flex items-center gap-2">
                  <Icon n="User" size={20} className="text-indigo-400" />
                  <h3 className="font-bold text-lg font-serif">Member Board</h3>
                  <span className="text-[10px] uppercase font-bold text-slate-400 bg-slate-800 border border-slate-700 px-2 py-0.5 rounded">
                    {profilesList.length} Total
                  </span>
                </div>
                <button
                  onClick={loadProfiles}
                  disabled={profilesLoading}
                  className="bg-indigo-600 hover:bg-indigo-700 text-white px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 disabled:opacity-50"
                >
                  <Icon n="Refresh" size={12} className={profilesLoading ? "animate-spin" : ""} />
                  Refresh
                </button>
              </div>

              <div className="p-6">
                {profilesLoading && profilesList.length === 0 ? (
                  <div className="text-center py-16 text-slate-400 text-sm font-semibold">Loading members...</div>
                ) : profilesList.length === 0 ? (
                  <div className="text-center py-16 text-slate-400 text-sm font-semibold">No members found.</div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse text-sm">
                      <thead>
                        <tr className="border-b border-slate-200 text-xs font-bold text-slate-400 uppercase tracking-wider">
                          <th className="py-3 px-4">Member</th>
                          <th className="py-3 px-4">Discord User ID</th>
                          <th className="py-3 px-4">Joined At</th>
                          <th className="py-3 px-4">Work Thread ID</th>
                          <th className="py-3 px-4">Wanderer Ticket</th>
                          <th className="py-3 px-4 text-right">Role</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {profilesList.map((m) => {
                          const isCurrentUser = m.id === profile?.id;
                          return (
                            <tr key={m.id} className="hover:bg-slate-50/50 transition-colors">
                              <td className="py-3 px-4 flex items-center gap-3">
                                {m.avatar_url ? (
                                  <img
                                    src={getNetlifyImageUrl(m.avatar_url, 32)}
                                    srcSet={getNetlifyImageSrcSet(m.avatar_url)}
                                    alt={m.username}
                                    className="w-8 h-8 rounded-full object-cover border border-slate-200"
                                    width={32}
                                    height={32}
                                    loading="lazy"
                                  />
                                ) : (
                                  <div className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center border border-slate-200 text-xs font-bold text-slate-500">
                                    {m.username ? m.username.slice(0, 2).toUpperCase() : '??'}
                                  </div>
                                )}
                                <div>
                                  <div className="font-bold text-slate-800 flex items-center gap-1.5">
                                    {m.username || 'Unknown'}
                                    {isCurrentUser && (
                                      <span className="text-[10px] font-extrabold uppercase bg-indigo-50 text-indigo-600 border border-indigo-200 px-1.5 py-0.5 rounded-sm">
                                        You
                                      </span>
                                    )}
                                  </div>
                                  <div className="text-xs text-slate-400 font-mono truncate max-w-[200px]">{isOwner ? m.email : maskEmail(m.email)}</div>
                                </div>
                              </td>
                              <td className="py-3 px-4 text-slate-500 font-mono text-xs">
                                {m.discord_id || '—'}
                              </td>
                              <td className="py-3 px-4 text-slate-500 text-xs">
                                {m.created_at ? new Date(m.created_at).toLocaleDateString() : '—'}
                              </td>
                              <td className="py-3 px-4">
                                <MemberWorkThreadInput member={m} onSave={handleWorkThreadChange} />
                              </td>
                              <td className="py-3 px-4">
                                {m.wanderer_ticket ? (
                                  <span className="text-[10px] font-extrabold uppercase tracking-wider px-2 py-1 rounded border bg-amber-100 text-amber-700 border-amber-200">
                                    Ticket Active
                                  </span>
                                ) : (
                                  <button
                                    type="button"
                                    onClick={() => handleGrantWandererTicket(m.id, m.username)}
                                    className="border border-slate-200 hover:border-slate-300 rounded-lg px-2.5 py-1.5 text-xs font-bold text-slate-700 bg-white shadow-xs transition-all"
                                  >
                                    Grant Ticket
                                  </button>
                                )}
                              </td>
                              <td className="py-3 px-4 text-right">
                                <select
                                  value={m.role === 'owner' ? 'admin' : (m.role || 'user')}
                                  disabled={isCurrentUser || m.role === 'owner'}
                                  onChange={(e) => handleRoleChange(m.id, e.target.value)}
                                  className="border border-slate-200 hover:border-slate-300 rounded-lg px-2.5 py-1.5 text-xs font-bold text-slate-700 bg-white shadow-xs focus:outline-hidden focus:ring-2 focus:ring-indigo-500 disabled:opacity-50 disabled:bg-slate-50 disabled:cursor-not-allowed cursor-pointer transition-all"
                                >
                                  <option value="user">User</option>
                                  <option value="staff">Reviewer</option>
                                  <option value="admin">Admin</option>
                                </select>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {tab === 'roster' && (
          <RosterPage userRole={role} userId={profile?.id} />
        )}
      </div>

      {/* FOOTER */}
      <div className="bg-black text-center py-3 text-[10px] font-bold text-slate-500 uppercase tracking-widest shrink-0 flex items-center justify-center gap-2 relative z-30">
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
            isAdmin={isAdmin}
            isPendingEdit={adminForm.isPendingEdit}
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
          isAdmin={isAdmin}
          isStaff={isStaff}
          webhookConfig={webhookConfig}
          onWebhookConfigSave={(key, value) => {
            saveWebhookConfig(key, value).then(() => {
              setWebhookConfig(prev => ({ ...prev, [key]: value }));
            }).catch(e => console.warn('[NARP] webhook config save failed:', e));
          }}
          onOpenAuditLog={() => setModals(m => ({ ...m, audit: true }))}
          onManageBL={() => setModals(m => ({ ...m, manageBL: true }))}
          submissionControls={submissionControls}
          onToggleSubmission={(key, value) => setSubmissionControls(prev => ({ ...prev, [key]: value }))}
          currentUserId={profile?.id}
          profile={profile}
          onProfileUpdate={setProfile} />
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
        const isPendingDelete = effectiveTab === 'jutsus' && (
          (isStaff && !isAdmin) || (isAdmin && askSecondApprovalDelete)
        );
        return (
          <div className="fixed inset-0 z-[100] bg-black/60 flex items-center justify-center p-4 animate-in fade-in" onClick={() => { setConfirmDel(null); setAskSecondApprovalDelete(false); }}>
            <div className="bg-white p-6 rounded-3xl max-w-sm w-full" onClick={e => e.stopPropagation()}>
              <h3 className="font-bold text-xl mb-2 text-slate-900">
                {isPendingDelete ? 'Submit deletion for approval?' : 'Confirm Deletion'}
              </h3>
              <p className="text-sm text-slate-600 mb-6">
                {isPendingDelete
                  ? `Your request to delete '${confirmDel.name || 'this entry'}' will need a second approval before it's removed.`
                  : `Are you sure you want to delete '${confirmDel.name || 'this entry'}'? This action cannot be undone.`}
              </p>

              {isAdmin && effectiveTab === 'jutsus' && (
                <div className="flex items-center justify-between mb-6 bg-slate-50 p-3 rounded-xl border">
                  <div>
                    <p className="text-xs font-bold text-slate-800">Ask second approval</p>
                    <p className="text-[10px] text-slate-500">Require review before deletion</p>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      checked={askSecondApprovalDelete}
                      onChange={(e) => setAskSecondApprovalDelete(e.target.checked)}
                      className="sr-only peer"
                    />
                    <div className="w-9 h-5 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-indigo-600"></div>
                  </label>
                </div>
              )}

              <div className="flex gap-3">
                <button onClick={() => { setConfirmDel(null); setAskSecondApprovalDelete(false); }} className="flex-1 px-4 py-3 bg-slate-100 text-slate-700 font-bold rounded-xl hover:bg-slate-200">Cancel</button>
                <button onClick={async () => {
                          try {
                            await submitChange({
                              tab: effectiveTab,
                              operation: 'delete',
                              targetId: confirmDel.id,
                              entity: { name: confirmDel.name },
                              askSecondApproval: askSecondApprovalDelete
                            });
                          } catch (e) {
                            alert('Delete failed: ' + e.message);
                          }
                          setConfirmDel(null);
                          setAskSecondApprovalDelete(false);
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
              {!appInstalled && (installPrompt || /iphone|ipad|ipod/i.test(navigator.userAgent)) && (
                <div className="border-t pt-4">
                  <p className="text-[10px] font-bold uppercase text-slate-400 mb-3">Install App</p>
                  {installPrompt ? (
                    <button
                      onClick={async () => {
                        installPrompt.prompt();
                        const { outcome } = await installPrompt.userChoice;
                        if (outcome === 'accepted') { setInstallPrompt(null); setAppInstalled(true); setModals(m => ({ ...m, credits: false })); }
                      }}
                      className="w-full flex items-center justify-center gap-2 bg-slate-800 hover:bg-slate-700 text-white font-bold py-2.5 rounded-xl text-sm transition-colors">
                      <Icon n="Download" size={14} /> Install NARP Database
                    </button>
                  ) : (
                    <button
                      onClick={() => { setModals(m => ({ ...m, credits: false, iosInstall: true })); }}
                      className="w-full flex items-center justify-center gap-2 bg-slate-800 hover:bg-slate-700 text-white font-bold py-2.5 rounded-xl text-sm transition-colors">
                      <Icon n="Download" size={14} /> Install on iPhone / iPad
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {modals.iosInstall && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-end sm:items-center justify-center p-4 animate-in fade-in" onClick={() => setModals(m => ({ ...m, iosInstall: false }))}>
          <div className="bg-white rounded-3xl max-w-sm w-full overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="bg-slate-900 text-white p-5 flex justify-between items-center">
              <div className="flex items-center gap-2">
                <Icon n="Download" size={18} className="text-indigo-400" />
                <h3 className="font-bold text-base">Install on iPhone / iPad</h3>
              </div>
              <button onClick={() => setModals(m => ({ ...m, iosInstall: false }))} className="text-slate-400 hover:text-white"><Icon n="X" size={18} /></button>
            </div>
            <div className="p-6 space-y-4 text-sm text-slate-700">
              <p className="font-semibold text-slate-800">Add NARP Database to your home screen in 3 steps:</p>
              <ol className="space-y-3">
                <li className="flex items-start gap-3">
                  <span className="shrink-0 w-6 h-6 rounded-full bg-indigo-100 text-indigo-700 font-bold text-xs flex items-center justify-center">1</span>
                  <span>Tap the <strong>Share</strong> button at the bottom of Safari (the square with an arrow pointing up).</span>
                </li>
                <li className="flex items-start gap-3">
                  <span className="shrink-0 w-6 h-6 rounded-full bg-indigo-100 text-indigo-700 font-bold text-xs flex items-center justify-center">2</span>
                  <span>Scroll down and tap <strong>"Add to Home Screen"</strong>.</span>
                </li>
                <li className="flex items-start gap-3">
                  <span className="shrink-0 w-6 h-6 rounded-full bg-indigo-100 text-indigo-700 font-bold text-xs flex items-center justify-center">3</span>
                  <span>Tap <strong>"Add"</strong> in the top-right corner. The app will appear on your home screen.</span>
                </li>
              </ol>
              <p className="text-xs text-slate-400 pt-1">Note: This feature requires Safari on iOS 16.4 or later.</p>
            </div>
            <div className="px-6 pb-6">
              <button onClick={() => setModals(m => ({ ...m, iosInstall: false }))}
                      className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl text-sm transition-colors">
                Got it
              </button>
            </div>
          </div>
        </div>
      )}

      {statelessType === 'Character' && (
        <OCSubmissionModal
          profile={profile}
          bloodlines={db.bloodlines || []}
          onClose={() => setStatelessType(null)}
          onAfterSubmit={refreshPending}
        />
      )}
      {statelessType && statelessType !== 'Character' && (
        <StatelessSubmissionModal
          type={statelessType}
          profile={profile}
          onClose={() => setStatelessType(null)}
          isAdmin={isAdmin}
          onDirectUpload={handleDirectSummonItemUpload}
          onAfterSubmit={refreshPending}
        />
      )}
      {ocEdit && (
        <OCSubmissionModal
          profile={profile}
          bloodlines={db.bloodlines || []}
          editPending={ocEdit}
          onClose={() => setOcEdit(null)}
          onSavedEdit={async (newData) => {
            await updatePendingJutsuData(ocEdit.id, newData);
            await refreshPending();
          }}
        />
      )}

      <SessionListCart list={cart}
                       onClear={() => setCart([])}
                       onRemove={(id) => setCart(prev => prev.filter(x => x._id !== id))} />
    </div>
  );
}
