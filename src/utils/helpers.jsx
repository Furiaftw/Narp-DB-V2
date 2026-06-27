import { NATURES } from '../constants/catalog';

/* ---------------------------------------------------------------------------
   STORAGE UTILITY
   --------------------------------------------------------------------------- */
export const LS = {
  get: (k, d) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};

/* ---------------------------------------------------------------------------
   ARRAY & STRING UTILITIES
   --------------------------------------------------------------------------- */
export const toArray = (v) => Array.isArray(v)
  ? v
  : (typeof v === 'string' && v.trim() ? v.split(',').map(s => s.trim()).filter(Boolean) : []);

export const copyText = (text, cb) => {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.cssText = 'position:fixed;left:-9999px';
  document.body.appendChild(ta);
  ta.focus(); ta.select();
  try { document.execCommand('copy'); cb && cb(); } catch {}
  document.body.removeChild(ta);
};

export const getSlotStatus = (slotsJson) => {
  try {
    const parsed = JSON.parse(slotsJson || '[]');
    if (!parsed.length) return { showAskStaff: false, remaining: 0, total: 0, parsed: [] };
    const remaining = parsed.length - parsed.filter(s => s.username).length;
    return { showAskStaff: remaining <= 2 && remaining > 0, remaining, total: parsed.length, parsed };
  } catch {
    return { showAskStaff: false, remaining: 0, total: 0, parsed: [] };
  }
};

export const getIdVal = (id) => parseInt(String(id).replace(/\D/g, '') || '0', 10);

export const getSortKey = (item) => {
  if (item._createdAt) {
    const t = new Date(item._createdAt).getTime();
    if (!isNaN(t)) return t;
  }
  return getIdVal(item._id);
};

export const getNatureColor = (n) => ({
  Fire:      'bg-orange-100 text-orange-800 border-orange-200',
  Water:     'bg-blue-100 text-blue-800 border-blue-200',
  Lightning: 'bg-yellow-100 text-yellow-800 border-yellow-300',
  Earth:     'bg-red-100 text-red-800 border-red-300',
  Wind:      'bg-green-100 text-green-800 border-green-200',
  Yang:      'bg-amber-100 text-amber-900 border-amber-300',
  Yin:       'bg-purple-100 text-purple-900 border-purple-300',
  Sound:     'bg-pink-100 text-pink-800 border-pink-200',
}[n] || 'bg-slate-200 text-slate-800 border-slate-300');

export const maskEmail = (email) => {
  if (!email) return '';
  const parts = email.split('@');
  if (parts.length !== 2) return '***';
  const name = parts[0];
  const domain = parts[1];
  const maskedName = name.length > 2 ? name[0] + '***' + name[name.length - 1] : '***';
  return `${maskedName}@${domain}`;
};

export function renderMessageWithLinks(text) {
  if (!text) return '';
  const urlRegex = /(https?:\/\/[^\s]+)/g;
  const parts = text.split(urlRegex);
  return parts.map((part, index) => {
    if (/^https?:\/\//.test(part)) {
      return (
        <a
          key={index}
          href={part}
          target="_blank"
          rel="noopener noreferrer"
          className="text-blue-500 hover:text-blue-400 hover:underline"
        >
          {part}
        </a>
      );
    }
    return part;
  });
}

/* ---------------------------------------------------------------------------
   SESSION LIST FORMATTING
   --------------------------------------------------------------------------- */
export const RANK_ORDER_NUM = { E: 1, D: 2, C: 3, B: 4, A: 5, S: 6 };

export const groupForJutsu = (j) => {
  if (toArray(j.types).includes('Battlemode')) return { type: 'battlemode', name: 'Battlemode' };
  if (j.bloodline)                               return { type: 'bloodline',  name: j.bloodline };
  const firstNature = toArray(j.nature)[0];
  if (firstNature && firstNature !== 'N/A')     return { type: 'nature',     name: firstNature };
  return { type: 'other', name: 'Other' };
};

export const compareForList = (a, b) => {
  if (!!a.multiRank !== !!b.multiRank) return a.multiRank ? -1 : 1;
  const lowestRank = (j) => {
    const rArr = toArray(j.rank);
    return rArr.length ? Math.min(...rArr.map(r => RANK_ORDER_NUM[r] || 99)) : 99;
  };
  const diff = lowestRank(a) - lowestRank(b);
  return diff !== 0 ? diff : a.name.localeCompare(b.name);
};

export const formatSessionList = (items) => {
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
      const ranks = toArray(j.rank).slice().sort((a, b) => (RANK_ORDER_NUM[a] || 0) - (RANK_ORDER_NUM[b] || 0));

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
      if (j.pve)                tags.push('Pve');

      const display = j.link && j.link !== '#' ? `[${j.name}](${j.link})` : j.name;
      const tagPart = tags.length ? ` · ${tags.join(' · ')}` : '';
      out.push(`- ${display} — ${rankStr}${tagPart}`);
    }
  });

  return out.join('\n');
};

/* ---------------------------------------------------------------------------
   DISCORD WEBHOOK LOGGING
   --------------------------------------------------------------------------- */
export async function sendDiscordLog(itemData, actionType, submitterProfile, firstReviewerProfile, finalApproverProfile, chatTranscript = null) {
  const baseUrl = import.meta.env.VITE_DISCORD_LOG_WEBHOOK_URL;
  if (!baseUrl) return null; // Logging not configured — skip silently.

  const isCharacter = itemData?.type === 'Character';

  // Route to the correct forum thread based on the jutsu's type.
  let threadId = toArray(itemData?.types).includes('Battlemode')
    ? import.meta.env.VITE_DISCORD_BATTLEMODE_THREAD_ID
    : import.meta.env.VITE_DISCORD_JUTSU_THREAD_ID;

  if (isCharacter) {
    threadId = import.meta.env.VITE_DISCORD_OC_THREAD_ID;
  }

  const baseWebhookUrl = threadId ? `${baseUrl}?thread_id=${threadId}` : baseUrl;
  const webhookUrl = baseWebhookUrl.includes('?') ? `${baseWebhookUrl}&wait=true` : `${baseWebhookUrl}?wait=true`;

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

  const payload = {
    embeds: [{
      title: isCharacter ? 'OC Submission' : (itemData?.name || 'Jutsu Entry'),
      description,
      color,
    }],
  };

  let body;
  const headers = {};

  if (chatTranscript) {
    const nameSlug = (itemData?.name || 'entry')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '');
    const fileName = `transcript-${nameSlug || 'entry'}.txt`;

    const blob = new Blob([chatTranscript], { type: 'text/plain' });
    const formData = new FormData();
    formData.append('file', blob, fileName);
    formData.append('payload_json', JSON.stringify(payload));
    body = formData;
  } else {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(payload);
  }

  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers,
      body,
    });
    if (!response.ok) {
      throw new Error(`Discord webhook returned status ${response.status}`);
    }
    const data = await response.json();
    return { messageId: data?.id, threadId: threadId };
  } catch (err) {
    // Never let a logging failure block the underlying database action.
    console.warn('[NARP] Discord log failed:', err);
    return null;
  }
}

/* ---------------------------------------------------------------------------
   NETLIFY IMAGE CDN UTILITIES
   --------------------------------------------------------------------------- */
export const getNetlifyImageUrl = (url, width) => {
  if (!url) return '';
  if (url.startsWith('/.netlify/images') || url.startsWith('data:')) return url;
  return `/.netlify/images?url=${encodeURIComponent(url)}&w=${width}&fm=avif&q=80`;
};

export const getNetlifyImageSrcSet = (url) => {
  if (!url) return '';
  if (url.startsWith('data:')) return '';
  const w400 = getNetlifyImageUrl(url, 400);
  const w800 = getNetlifyImageUrl(url, 800);
  const w1200 = getNetlifyImageUrl(url, 1200);
  return `${w400} 400w, ${w800} 800w, ${w1200} 1200w`;
};

