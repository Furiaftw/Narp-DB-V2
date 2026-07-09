import { useState, useEffect, useMemo } from 'react';
import Icon from '../components/ui/Icon';
import ReviewChat from '../components/features/ReviewChat';
import useIsDesktop from '../hooks/useIsDesktop';
import { getNetlifyImageUrl, getNetlifyImageSrcSet } from '../utils/helpers';

const PREFS_KEY = 'narp_msgs_prefs_v1';

const loadPrefs = () => {
  try {
    const v = localStorage.getItem(PREFS_KEY);
    return v ? JSON.parse(v) : {};
  } catch { return {}; }
};
const savePrefs = (prefs) => {
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch {}
};

const FILTERS = [
  { id: 'all',           label: 'All' },
  { id: 'awaiting_you',  label: 'Awaiting You' },
  { id: 'awaiting_them', label: 'Awaiting Them' },
  { id: 'ready',         label: 'Ready' },
  { id: 'unread',        label: 'Unread' },
];

const SORTS = [
  { id: 'newest', label: 'Newest First' },
  { id: 'oldest', label: 'Oldest First' },
  { id: 'az',     label: 'Alphabetical' },
];

const STATUS_BADGES = {
  awaiting_you: {
    label: 'Awaiting You',
    cls: 'bg-rose-100 text-rose-700 border-rose-200',
    dot: 'bg-rose-500 animate-pulse',
  },
  awaiting_them: {
    label: 'Awaiting Them',
    cls: 'bg-amber-100 text-amber-700 border-amber-200',
    dot: 'bg-amber-500',
  },
  ready: {
    label: 'Ready for Approval',
    cls: 'bg-emerald-100 text-emerald-700 border-emerald-200',
    dot: 'bg-emerald-500',
  },
};

function elapsedLabel(ts) {
  if (!ts) return '';
  const diff = Math.max(0, Date.now() - new Date(ts).getTime());
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function previewText(msg) {
  if (!msg?.message) return '';
  if (msg.message.startsWith('[SYSTEM_FINAL_STEP]')) return '📋 Final approval instructions sent';
  if (msg.message.startsWith('[SYSTEM_JOIN]')) return `👋 ${msg.message.replace('[SYSTEM_JOIN]', '').trim()}`;
  return msg.message;
}

function isClaimedPending(p) {
  if (p.assigned_to === null || p.assigned_to === undefined) return false;
  return typeof p.assigned_to === 'object'
    ? (p.assigned_to.id !== null && p.assigned_to.id !== undefined)
    : (typeof p.assigned_to === 'string' && p.assigned_to.trim() !== '');
}

/* ============================================================================
   PAGE: MessagesPage — inbox of all active review conversations.
   Desktop: split view (conversation list + sticky chat panel).
   Mobile: list only; selecting a conversation opens the chat drawer.
   ============================================================================ */
export default function MessagesPage({
  conversations,
  profile,
  role,
  selectedId,
  onSelect,
  onMarkRead,
  resolveName,
  refreshTrigger,
  refreshPending,
  headerOffset = 120,
}) {
  const isDesktop = useIsDesktop();
  const [filter, setFilter] = useState(() => loadPrefs().filter || 'all');
  const [sort, setSort] = useState(() => loadPrefs().sort || 'newest');

  useEffect(() => { savePrefs({ filter, sort }); }, [filter, sort]);

  const selected = conversations.find(c => c.pending.id === selectedId) || null;

  // Clear the unread badge while a thread is open and new messages arrive.
  useEffect(() => {
    if (selected && selected.unreadCount > 0) onMarkRead(selected.pending.id);
  }, [selected, onMarkRead]);

  const visible = useMemo(() => {
    let list = conversations;
    if (filter === 'unread') list = list.filter(c => c.unreadCount > 0);
    else if (filter !== 'all') list = list.filter(c => c.status === filter);
    const byTime = (c) => new Date(c.lastMessage?.created_at || 0).getTime();
    return [...list].sort((a, b) => {
      if (sort === 'oldest') return byTime(a) - byTime(b);
      if (sort === 'az') return resolveName(a.pending).localeCompare(resolveName(b.pending));
      return byTime(b) - byTime(a);
    });
  }, [conversations, filter, sort, resolveName]);

  const filterCounts = useMemo(() => ({
    all: conversations.length,
    awaiting_you: conversations.filter(c => c.status === 'awaiting_you').length,
    awaiting_them: conversations.filter(c => c.status === 'awaiting_them').length,
    ready: conversations.filter(c => c.status === 'ready').length,
    unread: conversations.filter(c => c.unreadCount > 0).length,
  }), [conversations]);

  const renderChat = (conv, variant) => {
    const p = conv.pending;
    const iAmSubmitter = p.submitted_by === profile?.id;
    const viewerIsStaff = ['staff', 'admin', 'owner'].includes(role) && !iAmSubmitter;
    return (
      <ReviewChat
        pending={p}
        name={resolveName(p)}
        currentUserId={profile?.id}
        currentUserProfile={profile}
        isStaff={viewerIsStaff}
        isStrictSubmitter={iAmSubmitter}
        isClaimed={isClaimedPending(p)}
        refreshTrigger={refreshTrigger}
        refreshPending={refreshPending}
        onClose={() => onSelect(null)}
        variant={variant}
        onRead={() => onMarkRead(p.id)}
      />
    );
  };

  const list = (
    <div className="flex flex-col gap-3">
      {/* Filter + sort controls */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-3 flex flex-col gap-2.5">
        <div className="flex flex-wrap gap-1.5">
          {FILTERS.map(f => (
            <button
              key={f.id}
              type="button"
              onClick={() => setFilter(f.id)}
              className={`text-xs px-2.5 py-1 rounded-lg font-bold transition-colors flex items-center gap-1.5 ${
                filter === f.id
                  ? 'bg-indigo-600 text-white'
                  : 'bg-slate-50 text-slate-600 border border-slate-200 hover:bg-slate-100'
              }`}
            >
              {f.label}
              <span className={`text-[10px] tabular-nums px-1.5 py-px rounded-full ${filter === f.id ? 'bg-indigo-500 text-indigo-100' : 'bg-slate-200 text-slate-500'}`}>
                {filterCounts[f.id]}
              </span>
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <Icon n="Sort" size={13} className="text-slate-400 shrink-0" />
          <select
            value={sort}
            onChange={e => setSort(e.target.value)}
            className="text-xs font-bold text-slate-600 bg-slate-50 border border-slate-200 rounded-lg px-2 py-1.5 outline-none focus:ring-1 focus:ring-indigo-500"
          >
            {SORTS.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
        </div>
      </div>

      {/* Conversation list */}
      {visible.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm text-center py-14 px-6">
          <svg viewBox="0 0 24 24" width="36" height="36" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="mx-auto mb-3 text-slate-300">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
          <p className="text-slate-500 font-semibold text-sm">
            {conversations.length === 0
              ? 'No active conversations yet. Chats on pending submissions will show up here.'
              : 'No conversations match this filter.'}
          </p>
          {conversations.length > 0 && (
            <button
              type="button"
              onClick={() => setFilter('all')}
              className="mt-3 text-xs font-bold text-indigo-600 bg-indigo-50 hover:bg-indigo-100 px-3 py-1.5 rounded-lg"
            >
              Show All
            </button>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-1.5">
          {visible.map(conv => {
            const p = conv.pending;
            const name = resolveName(p);
            const badge = STATUS_BADGES[conv.status];
            const last = conv.lastMessage;
            const senderName = last?.profiles?.site_nickname || last?.profiles?.username || 'Unknown';
            const isSelected = selectedId === p.id;
            const iAmSubmitter = p.submitted_by === profile?.id;
            const stale = last && (Date.now() - new Date(last.created_at).getTime()) > 72 * 3600 * 1000;
            const typeLabel = p.data?.type || 'Jutsu';

            const docLink = p.data?.link;

            return (
              <div
                key={p.id}
                role="button"
                tabIndex={0}
                onClick={() => onSelect(isSelected && isDesktop ? null : p.id)}
                onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(isSelected && isDesktop ? null : p.id); } }}
                className={`w-full text-left cursor-pointer bg-white rounded-2xl border shadow-sm px-4 py-3 flex items-start gap-3 transition-all hover:shadow-md ${
                  isSelected
                    ? 'border-indigo-400 ring-2 ring-indigo-200'
                    : conv.unreadCount > 0
                      ? 'border-rose-200'
                      : 'border-slate-200'
                }`}
              >
                {/* Unread / status dot */}
                <span className={`mt-1.5 w-2.5 h-2.5 rounded-full shrink-0 ${conv.unreadCount > 0 ? 'bg-rose-500 animate-pulse' : (badge?.dot || 'bg-slate-200')}`} />

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="font-bold text-slate-900 text-sm truncate">{name}</span>
                    <span className="text-[9px] font-extrabold uppercase tracking-wider text-slate-500 bg-slate-100 border border-slate-200 px-1.5 py-0.5 rounded-sm shrink-0">
                      {typeLabel}
                    </span>
                    {conv.unreadCount > 0 && (
                      <span className="text-[10px] font-bold text-white bg-rose-500 px-1.5 py-0.5 rounded-full tabular-nums shrink-0">
                        {conv.unreadCount} new
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] text-slate-400 mt-0.5 truncate">
                    {iAmSubmitter ? 'Your submission' : `by ${p.submitter?.username || 'Unknown'}`}
                    {p.assignee?.username && !iAmSubmitter ? ` · claimed by ${p.assignee.username}` : ''}
                  </p>
                  {last && (
                    <p className="text-xs text-slate-600 mt-1 truncate">
                      <span className="font-semibold">{last.sender_id === profile?.id ? 'You' : senderName}:</span>{' '}
                      {previewText(last)}
                    </p>
                  )}
                  {docLink && (
                    <a
                      href={docLink}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={e => e.stopPropagation()}
                      className="inline-flex items-center gap-1 mt-1.5 text-[10px] font-bold text-indigo-600 bg-indigo-50 border border-indigo-200 hover:bg-indigo-100 px-2 py-0.5 rounded-lg max-w-full"
                      title={docLink}
                    >
                      <svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" />
                      </svg>
                      <span className="truncate">Google Doc</span>
                    </a>
                  )}
                </div>

                <div className="flex flex-col items-end gap-1 shrink-0">
                  {badge && (
                    <span className={`text-[9px] font-extrabold uppercase tracking-wider px-1.5 py-0.5 rounded border whitespace-nowrap ${badge.cls}`}>
                      {badge.label}
                    </span>
                  )}
                  <span className={`text-[10px] whitespace-nowrap ${stale && conv.status === 'awaiting_them' ? 'text-amber-600 font-bold' : 'text-slate-400'}`}>
                    {elapsedLabel(last?.created_at)}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );

  if (!isDesktop) {
    return (
      <div className="max-w-2xl mx-auto">
        {list}
        {selected && renderChat(selected, 'drawer')}
      </div>
    );
  }

  // Desktop split view: list on the left, sticky chat panel on the right.
  const panelHeight = `calc(100vh - ${headerOffset + 32}px)`;
  return (
    <div className="max-w-6xl mx-auto grid grid-cols-5 gap-4 items-start">
      <div className="col-span-2">{list}</div>
      <div className="col-span-3 sticky" style={{ top: `${headerOffset + 8}px` }}>
        {selected ? (
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden" style={{ height: panelHeight }}>
            {renderChat(selected, 'inline')}
          </div>
        ) : (
          <div
            className="bg-white/60 rounded-2xl border-2 border-dashed border-slate-300 flex flex-col items-center justify-center text-slate-400 gap-3"
            style={{ height: panelHeight }}
          >
            <svg viewBox="0 0 24 24" width="42" height="42" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-slate-300">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
            <p className="text-sm font-semibold">Select a conversation to open the chat</p>
          </div>
        )}
      </div>
    </div>
  );
}
