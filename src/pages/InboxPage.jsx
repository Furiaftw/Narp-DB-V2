import { useState, useEffect, useMemo } from 'react';
import Icon from '../components/ui/Icon';
import ReviewChat from '../components/features/ReviewChat';
import RecentChatActivity from '../components/features/RecentChatActivity';
import PendingJutsuCard, { OP_BADGE_COLORS, OP_BADGE_LABELS } from '../components/features/PendingJutsuCard';
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
  { id: 'unclaimed',     label: 'Unclaimed' },
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
  unclaimed: {
    label: 'Unclaimed',
    cls: 'bg-slate-100 text-slate-600 border-slate-200',
    dot: 'bg-slate-300',
  },
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

/*
 * A chat-less row still needs a status line. Copy differs by audience so
 * staff and the submitter each understand what's actually happening.
 */
function noChatCopy({ isStaff, iAmSubmitter, claimed }) {
  if (iAmSubmitter) return claimed ? 'Claimed — chat not started yet' : 'Waiting for a reviewer to claim this';
  if (isStaff) return claimed ? 'No messages yet — claimed, chat not started' : 'No messages yet — unclaimed';
  return 'No messages yet';
}

/* ============================================================================
   PAGE: InboxPage — the Submissions page: merged Messages + Pending +
   My Submissions, plus the Submit menu for filing a new entry.
   Staff: Pending's collapsible review-queue groups (Claimed by Me / Pending
   Approval / Needs Reviewer / Claimed by Others / My Submissions), narrowed
   by Messages' filter chips + sort. Players: same shell, but only their own
   items ever populate a group, so in practice they just see "My Submissions".
   Desktop: split view (row list + sticky detail panel). Mobile: inline
   expansion. The detail panel is the full PendingJutsuCard (actions +
   reservation controls + embedded chat), not a bare chat window.
   ============================================================================ */
export default function InboxPage({
  inboxItems,
  pendingGroups,
  profile,
  role,
  isAdmin,
  isStaff,
  selectedId,
  onSelect,
  onMarkRead,
  resolveName,
  getPendingChatMeta,
  refreshTrigger,
  refreshPending,
  dbJutsus = [],
  onApprove,
  onCancel,
  onSubmitterCancel,
  onReview,
  onEdit,
  onClaim,
  onPingSecondApproval,
  approvingIds,
  collapsedGroups,
  setCollapsedGroups,
  visibleRecentChats = [],
  pendingLoaded = true,
  submitMenu = null,
}) {
  const [filter, setFilter] = useState(() => loadPrefs().filter || 'all');
  const [sort, setSort] = useState(() => loadPrefs().sort || 'newest');

  useEffect(() => { savePrefs({ filter, sort }); }, [filter, sort]);

  const itemById = useMemo(() => new Map(inboxItems.map(it => [it.pending.id, it])), [inboxItems]);

  const selectedPending = useMemo(
    () => (pendingGroups.flatMap(g => g.items).find(p => p.id === selectedId)) || null,
    [pendingGroups, selectedId]
  );
  const selectedItem = selectedId ? itemById.get(selectedId) : null;

  // Clear the unread badge while a thread is open and new messages arrive.
  useEffect(() => {
    if (selectedItem && selectedItem.unreadCount > 0) onMarkRead(selectedItem.pending.id);
  }, [selectedItem, onMarkRead]);

  const matchesFilter = (item) => {
    if (!item) return filter === 'all';
    if (filter === 'unread') return item.unreadCount > 0;
    if (filter === 'all') return true;
    return item.status === filter;
  };

  const sortItems = (items) => {
    const byTime = (p) => {
      const it = itemById.get(p.id);
      const t = it?.lastMessage?.created_at || p.submitted_at;
      return t ? new Date(t).getTime() : 0;
    };
    return [...items].sort((a, b) => {
      if (sort === 'oldest') return byTime(a) - byTime(b);
      if (sort === 'az') return resolveName(a).localeCompare(resolveName(b));
      return byTime(b) - byTime(a);
    });
  };

  const filterCounts = useMemo(() => ({
    all: inboxItems.length,
    unclaimed: inboxItems.filter(c => c.status === 'unclaimed').length,
    awaiting_you: inboxItems.filter(c => c.status === 'awaiting_you').length,
    awaiting_them: inboxItems.filter(c => c.status === 'awaiting_them').length,
    ready: inboxItems.filter(c => c.status === 'ready').length,
    unread: inboxItems.filter(c => c.unreadCount > 0).length,
  }), [inboxItems]);

  const visibleGroups = useMemo(() => {
    return pendingGroups
      .map(g => ({ ...g, items: sortItems(g.items.filter(p => matchesFilter(itemById.get(p.id)))) }))
      .filter(g => g.items.length > 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingGroups, filter, sort, itemById]);

  const totalCount = inboxItems.length;

  const renderChat = (p, variant) => {
    const iAmSubmitter = p.submitted_by === profile?.id;
    const viewerIsStaff = (['reviewer', 'admin', 'owner'].includes(role) || role === 'grader') && !iAmSubmitter;
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

  const renderCard = (p, variant) => (
    <PendingJutsuCard
      pending={p}
      originalJutsu={p.target_id ? dbJutsus.find(j => j._id === p.target_id) : null}
      currentUserId={profile?.id}
      isAdmin={isAdmin}
      onApprove={onApprove}
      onCancel={onCancel}
      onSubmitterCancel={onSubmitterCancel}
      onReview={onReview}
      onEdit={onEdit}
      currentUserRole={role}
      refreshTrigger={refreshTrigger}
      onClaim={onClaim}
      onPingSecondApproval={onPingSecondApproval}
      currentUserProfile={profile}
      refreshPending={refreshPending}
      isApproving={approvingIds.has(p.id)}
      chatMeta={getPendingChatMeta(p)}
      onChatOpened={() => onMarkRead(p.id)}
      chatVariant={variant}
    />
  );

  const FilterSortBar = (
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
  );

  const Row = ({ p }) => {
    const item = itemById.get(p.id);
    const status = item?.status || 'unclaimed';
    const badge = STATUS_BADGES[status];
    const last = item?.lastMessage;
    const senderName = last?.profiles?.site_nickname || last?.profiles?.username || 'Unknown';
    const isSelected = selectedId === p.id;
    const iAmSubmitter = p.submitted_by === profile?.id;
    const stale = last && (Date.now() - new Date(last.created_at).getTime()) > 72 * 3600 * 1000;
    const typeLabel = p.data?.type || 'Jutsu';
    const docLink = p.data?.link;
    const op = p.operation;
    const isReservation = p.data?.subType === 'reservation_request';
    const claimed = isClaimedPending(p);
    const elapsedTs = last?.created_at || p.submitted_at;

    return (
      <div
        key={p.id}
        id={`pending-row-${p.id}`}
        role="button"
        tabIndex={0}
        onClick={() => onSelect(p.id)}
        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(p.id); } }}
        className={`w-full text-left cursor-pointer bg-white rounded-2xl border shadow-sm px-4 py-3 flex items-start gap-3 transition-all hover:shadow-md ${
          isSelected
            ? 'border-indigo-400 ring-2 ring-indigo-200'
            : (item?.unreadCount || 0) > 0
              ? 'border-rose-200'
              : 'border-slate-200'
        }`}
      >
        <span className={`mt-1.5 w-2.5 h-2.5 rounded-full shrink-0 ${(item?.unreadCount || 0) > 0 ? 'bg-rose-500 animate-pulse' : (badge?.dot || 'bg-slate-200')}`} />

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="font-bold text-slate-900 text-sm truncate">{resolveName(p)}</span>
            <span className={`text-[9px] font-extrabold uppercase tracking-wider px-1.5 py-0.5 rounded-sm border shrink-0 ${OP_BADGE_COLORS[op] || 'bg-slate-100 text-slate-500 border-slate-200'}`}>
              {OP_BADGE_LABELS[op] || typeLabel}
            </span>
            {isReservation && (
              <span className="text-[9px] font-extrabold uppercase tracking-wider text-purple-700 bg-purple-50 border border-purple-200 px-1.5 py-0.5 rounded-sm shrink-0">
                Réservation
              </span>
            )}
            {(item?.unreadCount || 0) > 0 && (
              <span className="text-[10px] font-bold text-white bg-rose-500 px-1.5 py-0.5 rounded-full tabular-nums shrink-0">
                {item.unreadCount} new
              </span>
            )}
          </div>
          <p className="text-[11px] text-slate-400 mt-0.5 truncate">
            {iAmSubmitter ? 'Your submission' : `by ${p.submitter?.username || 'Unknown'}`}
            {p.assignee?.username && !iAmSubmitter ? ` · claimed by ${p.assignee.username}` : ''}
          </p>
          {last ? (
            <p className="text-xs text-slate-600 mt-1 truncate">
              <span className="font-semibold">{last.sender_id === profile?.id ? 'You' : senderName}:</span>{' '}
              {previewText(last)}
            </p>
          ) : (
            <p className="text-xs text-slate-400 italic mt-1 truncate">
              {noChatCopy({ isStaff: isStaff && !iAmSubmitter, iAmSubmitter, claimed })}
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
          <span className={`text-[10px] whitespace-nowrap ${stale && status === 'awaiting_them' ? 'text-amber-600 font-bold' : 'text-slate-400'}`}>
            {elapsedLabel(elapsedTs)}
          </span>
        </div>
      </div>
    );
  };

  const groupsList = (
    <div className="flex flex-col gap-3">
      {isStaff && visibleRecentChats.length > 0 && (
        <RecentChatActivity
          recentChats={visibleRecentChats}
          pendingItems={pendingGroups.flatMap(g => g.items)}
          onSelectPending={(id) => {
            onSelect(id);
            const p2 = pendingGroups.flatMap(g => g.items).find(x => x.id === id);
            const groupKey = pendingGroups.find(g => g.items.some(x => x.id === p2?.id))?.key;
            if (groupKey) setCollapsedGroups(prev => { const n = new Set(prev); n.delete(groupKey); return n; });
            setTimeout(() => document.getElementById(`pending-row-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100);
          }}
        />
      )}

      <div className="flex items-center justify-between gap-3 mb-3">
        <h2 className="text-lg font-bold font-serif text-slate-800">Submissions</h2>
        {submitMenu}
      </div>

      {FilterSortBar}

      {!pendingLoaded ? (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm text-center py-14 px-6">
          <p className="text-slate-500 font-semibold text-sm">Loading your submissions...</p>
        </div>
      ) : visibleGroups.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm text-center py-14 px-6">
          <svg viewBox="0 0 24 24" width="36" height="36" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="mx-auto mb-3 text-slate-300">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
          <p className="text-slate-500 font-semibold text-sm">
            {totalCount === 0
              ? 'Nothing here yet. Submissions and their review chats will show up here.'
              : 'Nothing matches this filter.'}
          </p>
          {totalCount > 0 && filter !== 'all' && (
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
        visibleGroups.map(({ key, label, emoji, items }) => (
          <div key={key}>
            {/* Single-group case (the common one for players) skips the
                collapsible header — no point collapsing your only bucket. */}
            {visibleGroups.length > 1 && (
              <button
                type="button"
                onClick={() => setCollapsedGroups(prev => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n; })}
                className="w-full flex items-center gap-2 px-4 py-2.5 bg-slate-100 hover:bg-slate-200 rounded-xl mb-1.5 transition-colors"
              >
                <span className="text-base">{emoji}</span>
                <span className="font-bold text-slate-700 text-sm flex-1 text-left">{label}</span>
                <span className="bg-white border border-slate-200 text-slate-600 text-xs font-bold px-2 py-0.5 rounded-full">{items.length}</span>
                <Icon n={collapsedGroups.has(key) ? 'Down' : 'Up'} size={14} className="text-slate-400" />
              </button>
            )}
            {(visibleGroups.length === 1 || !collapsedGroups.has(key)) && (
              <div className="flex flex-col gap-1.5 mb-3">
                {items.map(p => <Row key={p.id} p={p} />)}
              </div>
            )}
          </div>
        ))
      )}
    </div>
  );

  /* One layout for every screen size: the row list, plus — when a row is
     selected — a full-screen slide-in takeover (like opening a Discord
     channel) with a back button. The old desktop split view is gone: its
     sticky in-flow panel fought the page scroll (the embedded chat's
     auto-scroll dragged the whole window down) and never used the full
     viewport for the review card and its action buttons.
     z-50 (not lower): the app's own sticky header is z-40, and since
     `fixed` + `z-index` opens a new stacking context here, anything below
     40 gets trapped underneath the header — including the back button. */
  return (
    <div className="max-w-2xl mx-auto">
      {groupsList}
      {selectedPending && (
        <div className="fixed inset-0 z-50 bg-slate-100 flex flex-col animate-in slide-in-from-right duration-200">
          <div className="shrink-0 flex items-center gap-2 px-4 py-3 border-b border-slate-200 bg-white">
            <button
              type="button"
              onClick={() => onSelect(null)}
              className="p-1.5 -ml-1.5 rounded-lg hover:bg-slate-100 text-slate-500"
              aria-label="Back to Submissions"
            >
              <Icon n="X" size={18} />
            </button>
            <span className="font-bold text-slate-900 text-sm truncate">{resolveName(selectedPending)}</span>
          </div>
          <div className="flex-1 overflow-y-auto custom-scrollbar p-3 md:p-6">
            <div className="max-w-3xl mx-auto">
              {renderCard(selectedPending, 'drawer')}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
