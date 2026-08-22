import { useState } from 'react';
import { NATURES, RANK_COST_NUM } from '../constants/catalog';

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

export const formatBytes = (bytes) => {
  if (bytes == null || Number.isNaN(bytes)) return '—';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let val = bytes / 1024;
  let i = 0;
  while (val >= 1024 && i < units.length - 1) { val /= 1024; i++; }
  return `${val.toFixed(val >= 10 ? 0 : 1)} ${units[i]}`;
};

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

/* ---------------------------------------------------------------------------
   DISCORD-FLAVORED CHAT MARKDOWN
   --------------------------------------------------------------------------- */
// Click-to-reveal spoiler, matching Discord's ||text|| behavior.
function Spoiler({ children }) {
  const [revealed, setRevealed] = useState(false);
  if (revealed) {
    return <span className="bg-slate-500/10 rounded px-0.5">{children}</span>;
  }
  return (
    <span
      onClick={(e) => { e.stopPropagation(); setRevealed(true); }}
      title="Click to reveal"
      className="bg-slate-600 text-transparent rounded px-0.5 cursor-pointer select-none hover:bg-slate-500"
    >
      {children}
    </span>
  );
}

const MARKDOWN_TOKEN_SOURCE =
  '```([\\s\\S]+?)```' +               // 1: code block
  '|`([^`\\n]+)`' +                    // 2: inline code
  '|\\|\\|([\\s\\S]+?)\\|\\|' +        // 3: spoiler
  '|\\*\\*([\\s\\S]+?)\\*\\*' +        // 4: bold
  '|__([\\s\\S]+?)__' +                // 5: underline
  '|~~([\\s\\S]+?)~~' +                // 6: strikethrough
  '|\\*([^*\\n]+?)\\*' +               // 7: italic (*)
  '|(?<!\\w)_([^_\\n]+?)_(?!\\w)' +    // 8: italic (_)
  '|(https?:\\/\\/[^\\s]+)';           // 9: bare URL

// Splits plain (non-token) text on @mentions of chat participants, if a mentionRegex is given.
function applyMentions(str, mentionRegex, isMe, keyBase) {
  if (!mentionRegex || !str) return str;
  const segs = str.split(mentionRegex);
  if (segs.length === 1) return str;
  return segs.map((seg, j) => j % 2 === 1
    ? (
      <span key={`${keyBase}-m${j}`} className={`font-bold rounded px-1 ${isMe ? 'bg-white/25 text-white' : 'bg-indigo-100 text-indigo-700'}`}>
        @{seg}
      </span>
    )
    : seg
  );
}

function renderInlineMarkdown(str, opts, keyBase, depth) {
  if (!str) return str;
  if (depth > 6) return applyMentions(str, opts.mentionRegex, opts.isMe, keyBase);
  const re = new RegExp(MARKDOWN_TOKEN_SOURCE, 'g');
  const out = [];
  let lastIndex = 0;
  let m;
  let i = 0;
  while ((m = re.exec(str))) {
    if (m.index > lastIndex) {
      out.push(applyMentions(str.slice(lastIndex, m.index), opts.mentionRegex, opts.isMe, `${keyBase}-t${i}`));
    }
    const key = `${keyBase}-k${i}`;
    if (m[1] !== undefined) {
      out.push(
        <pre key={key} className={`my-1 rounded-md px-2 py-1.5 text-xs font-mono whitespace-pre-wrap break-words ${opts.isMe ? 'bg-black/20' : 'bg-slate-800 text-slate-100'}`}>
          {m[1]}
        </pre>
      );
    } else if (m[2] !== undefined) {
      out.push(
        <code key={key} className={`rounded px-1 py-0.5 text-[0.85em] font-mono ${opts.isMe ? 'bg-black/20' : 'bg-slate-200 text-slate-800'}`}>
          {m[2]}
        </code>
      );
    } else if (m[3] !== undefined) {
      out.push(<Spoiler key={key}>{renderInlineMarkdown(m[3], opts, key, depth + 1)}</Spoiler>);
    } else if (m[4] !== undefined) {
      out.push(<strong key={key}>{renderInlineMarkdown(m[4], opts, key, depth + 1)}</strong>);
    } else if (m[5] !== undefined) {
      out.push(<span key={key} className="underline">{renderInlineMarkdown(m[5], opts, key, depth + 1)}</span>);
    } else if (m[6] !== undefined) {
      out.push(<span key={key} className="line-through opacity-80">{renderInlineMarkdown(m[6], opts, key, depth + 1)}</span>);
    } else if (m[7] !== undefined) {
      out.push(<em key={key}>{renderInlineMarkdown(m[7], opts, key, depth + 1)}</em>);
    } else if (m[8] !== undefined) {
      out.push(<em key={key}>{renderInlineMarkdown(m[8], opts, key, depth + 1)}</em>);
    } else if (m[9] !== undefined) {
      out.push(
        <a key={key} href={m[9]} target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:text-blue-400 hover:underline">
          {m[9]}
        </a>
      );
    }
    lastIndex = re.lastIndex;
    i++;
  }
  if (lastIndex < str.length) {
    out.push(applyMentions(str.slice(lastIndex), opts.mentionRegex, opts.isMe, `${keyBase}-tail`));
  }
  return out;
}

// Renders chat text with Discord-flavored markdown (bold/italic/underline/
// strikethrough/inline code/code block/spoiler/blockquote), bare URLs, and
// @mentions of chat participants (mentionRegex is a `/@(name1|name2)/gi`
// built by the caller from the participant list).
export function renderDiscordMarkdown(text, { mentionRegex = null, isMe = false } = {}) {
  if (!text) return '';
  const lines = String(text).split('\n');
  const opts = { mentionRegex, isMe };
  return lines.map((line, li) => {
    const quoteMatch = /^>\s?(.*)$/.exec(line);
    const body = quoteMatch
      ? (
        <span className={`block border-l-4 pl-2 italic ${isMe ? 'border-white/40 text-white/80' : 'border-slate-300 text-slate-500'}`}>
          {renderInlineMarkdown(quoteMatch[1], opts, `l${li}`, 0)}
        </span>
      )
      : renderInlineMarkdown(line, opts, `l${li}`, 0);
    return (
      <span key={li}>
        {body}
        {li < lines.length - 1 ? '\n' : null}
      </span>
    );
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

  const out = ['**My SARP List**'];
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

