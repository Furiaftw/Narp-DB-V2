import { useState, useEffect } from 'react';
import {
  supabase,
  getCurrentSession,
  sendReviewChat,
  updatePendingJutsuData,
} from '../../lib/supabase';
import { getNetlifyImageUrl, getNetlifyImageSrcSet } from '../../utils/helpers';
import Icon from '../ui/Icon';
import ConfirmButton from '../ui/ConfirmButton';
import ReviewChat, { JOIN_PREFIX } from './ReviewChat';

/* ============================================================================
   COMPONENT: ReservationControls — reviewer tools for a "Réservation Request"
   OC entry: grant the 48h reservation (holds a bloodline slot), extend it by
   another 48h when the sheet shows real progress, or release the slot and
   deny the entry. Submitters see the countdown but no buttons.
   ============================================================================ */
function ReservationControls({ pending, canAct, onCancel, refreshPending }) {
  const [busy, setBusy] = useState(false);
  const data = pending.data || {};
  const granted = data.reservationStatus === 'granted';
  const expiresAt = data.reservationExpiresAt ? new Date(data.reservationExpiresAt) : null;
  const msLeft = expiresAt ? expiresAt.getTime() - Date.now() : 0;
  const expired = granted && expiresAt && msLeft <= 0;
  const hoursLeft = Math.max(0, Math.floor(msLeft / 3600000));
  const minsLeft = Math.max(0, Math.floor((msLeft % 3600000) / 60000));
  const extensions = data.reservationExtensions || 0;

  const callSlots = async (action) => {
    const sess = await getCurrentSession();
    const res = await fetch('/.netlify/functions/manage-bloodline-slot', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(sess?.access_token ? { Authorization: `Bearer ${sess.access_token}` } : {}),
      },
      body: JSON.stringify({
        action,
        bloodline: data.bloodline,
        pendingId: pending.id,
        label: `Reserved — ${data.name || 'OC'}`,
      }),
    });
    if (!res.ok) {
      const out = await res.json().catch(() => ({}));
      throw new Error(out.error || `Slot ${action} failed`);
    }
  };

  const dmSubmitter = (message) => {
    const discordId = pending.submitter?.discord_id;
    if (!discordId) return;
    getCurrentSession().then(sess => {
      fetch('/.netlify/functions/discord-dm', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(sess?.access_token ? { Authorization: `Bearer ${sess.access_token}` } : {}),
        },
        body: JSON.stringify({ discordUserId: discordId, message }),
      }).catch(err => console.warn('[NARP] Reservation DM failed:', err));
    });
  };

  const handleGrant = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await callSlots('reserve');
      await updatePendingJutsuData(pending.id, {
        ...data,
        reservationStatus: 'granted',
        reservationGrantedAt: new Date().toISOString(),
        reservationExpiresAt: new Date(Date.now() + 48 * 3600000).toISOString(),
        reservationExtensions: 0,
      });
      dmSubmitter(`⏳ Your bloodline reservation for **${data.name || 'your OC'}** (${data.bloodline}) has been **granted**! You now have **48 hours** to complete your OC sheet.`);
      if (refreshPending) await refreshPending();
    } catch (err) {
      alert('Could not grant the reservation: ' + (err.message || err));
    } finally {
      setBusy(false);
    }
  };

  const handleExtend = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await updatePendingJutsuData(pending.id, {
        ...data,
        reservationExpiresAt: new Date(Date.now() + 48 * 3600000).toISOString(),
        reservationExtensions: extensions + 1,
      });
      dmSubmitter(`⏳ Your reservation for **${data.name || 'your OC'}** (${data.bloodline}) has been **extended by 48 hours**. Keep the progress going!`);
      if (refreshPending) await refreshPending();
    } catch (err) {
      alert('Could not extend the reservation: ' + (err.message || err));
    } finally {
      setBusy(false);
    }
  };

  const handleRelease = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await callSlots('release');
    } catch (err) {
      console.warn('[NARP] Slot release failed (continuing with denial):', err);
    } finally {
      setBusy(false);
    }
    onCancel(pending.id); // full denial flow: Discord log, submitter DM, delete
  };

  return (
    <div className="text-xs bg-purple-50 border border-purple-200 rounded-lg p-3 space-y-2">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <span className="font-extrabold uppercase tracking-wider text-[10px] text-purple-700">⏳ Réservation Request — {data.bloodline}</span>
        {granted && !expired && (
          <span className="text-[10px] font-bold text-amber-700 bg-amber-100 border border-amber-200 px-2 py-0.5 rounded tabular-nums">
            {hoursLeft}h {minsLeft}m left{extensions > 0 ? ` · extended ×${extensions}` : ''}
          </span>
        )}
        {expired && (
          <span className="text-[10px] font-bold text-rose-700 bg-rose-100 border border-rose-200 px-2 py-0.5 rounded animate-pulse">
            Expired — awaiting reviewer decision
          </span>
        )}
        {!granted && (
          <span className="text-[10px] font-bold text-slate-500 bg-slate-100 border border-slate-200 px-2 py-0.5 rounded">
            Awaiting reservation grant
          </span>
        )}
      </div>
      <p className="text-purple-900/70">
        {granted
          ? expired
            ? 'The 48h window has passed. Extend it if the sheet shows real progress (≥50% complete), or release the slot and deny the entry.'
            : 'A slot is being held in this bloodline while the submitter completes their OC sheet.'
          : 'This bloodline is nearly full. Granting the reservation holds a slot and starts the submitter’s 48-hour completion window.'}
      </p>
      {canAct && (
        <div className="flex gap-2 flex-wrap pt-1">
          {!granted ? (
            <ConfirmButton
              onConfirm={handleGrant}
              disabled={busy}
              armedLabel="Confirm grant?"
              armedClassName="ring-2 ring-emerald-300 animate-pulse"
              className="bg-emerald-600 hover:bg-emerald-700 text-white px-3 py-1.5 rounded-lg font-bold text-xs disabled:opacity-60">
              {busy ? 'Working…' : 'Grant Reservation (48h)'}
            </ConfirmButton>
          ) : (
            <ConfirmButton
              onConfirm={handleExtend}
              disabled={busy}
              armedLabel="Confirm +48h?"
              armedClassName="ring-2 ring-amber-300 animate-pulse"
              className="bg-amber-500 hover:bg-amber-600 text-white px-3 py-1.5 rounded-lg font-bold text-xs disabled:opacity-60">
              {busy ? 'Working…' : 'Extend 48h'}
            </ConfirmButton>
          )}
          {granted && (
            <ConfirmButton
              onConfirm={handleRelease}
              disabled={busy}
              armedLabel="Confirm release & deny?"
              armedClassName="ring-2 ring-rose-300 animate-pulse"
              className="bg-rose-600 hover:bg-rose-700 text-white px-3 py-1.5 rounded-lg font-bold text-xs disabled:opacity-60">
              {busy ? 'Working…' : 'Release Slot & Deny'}
            </ConfirmButton>
          )}
        </div>
      )}
    </div>
  );
}

/* ============================================================================
   COMPONENT: PendingJutsuCard — export op badges/colors so list rows in
   InboxPage can render a matching small badge without re-declaring the map.
   ============================================================================ */
export const OP_BADGE_COLORS = {
  insert: 'bg-emerald-100 text-emerald-800 border-emerald-300',
  update: 'bg-amber-100  text-amber-800  border-amber-300',
  delete: 'bg-rose-100   text-rose-800   border-rose-300',
};
export const OP_BADGE_LABELS = { insert: 'New', update: 'Edit', delete: 'Delete' };

export default function PendingJutsuCard({
  pending,
  originalJutsu,
  currentUserId,
  isAdmin,
  onApprove,
  onCancel,
  onSubmitterCancel,
  onReview,
  onEdit,
  currentUserRole,
  refreshTrigger,
  onClaim,
  currentUserProfile = null,
  refreshPending = null,
  isApproving = false,
  chatMeta = null,
  onChatOpened = null,
  chatVariant = 'drawer',
}) {
  const currentUser = { id: currentUserId, role: currentUserRole };
  const pendingItem = pending;

  // isStrictSubmitter: true for anyone who submitted this item, regardless of role.
  // Staff reviewing their OWN submission see the submitter view, not the reviewer view.
  const isStrictSubmitter = currentUser.id === pendingItem.submitted_by;

  const hasStaffPrivileges = ['staff', 'admin', 'owner'].includes(currentUser.role) && !isStrictSubmitter;

  const isMine     = pending.submitted_by === currentUserId;
  const op         = pending.operation;
  const submitter  = pending.submitter;
  const submitterName = submitter?.username || 'Unknown';

  const isReviewerOrAdmin = currentUserRole === 'staff' || currentUserRole === 'admin' || currentUserRole === 'owner';
  const isStaff = isReviewerOrAdmin;

  const opColors = OP_BADGE_COLORS;

  const display = op === 'delete' ? (originalJutsu || {}) : (pending.data || {});
  const name = display.name || originalJutsu?.name || '(no name)';

  const [isChatOpen, setIsChatOpen] = useState(false);
  const [chatSenderIds, setChatSenderIds] = useState(() => new Set());
  const [isJoiningChat, setIsJoiningChat] = useState(false);

  const isClaimed = !!(
    pendingItem.assigned_to !== null &&
    pendingItem.assigned_to !== undefined &&
    (typeof pendingItem.assigned_to === 'object'
      ? (pendingItem.assigned_to.id !== null && pendingItem.assigned_to.id !== undefined)
      : (typeof pendingItem.assigned_to === 'string' && pendingItem.assigned_to.trim() !== ''))
  );

  const elapsed = (() => {
    const baseTimeStr = pending.submitted_at;
    if (!baseTimeStr) return { formatted: '', hours: 0 };
    const baseTime = new Date(baseTimeStr);
    const now = new Date();
    const diffMs = now - baseTime;
    const hours = Math.max(0, Math.floor(diffMs / (1000 * 60 * 60)));

    if (hours < 48) {
      return { formatted: `${hours}h`, hours };
    } else {
      const days = Math.floor(hours / 24);
      const remainingHours = hours % 24;
      let formatted = `${days}d`;
      if (remainingHours > 0) {
        formatted += ` ${remainingHours}h`;
      }
      return { formatted, hours };
    }
  })();

  const timerColorClass = elapsed.hours >= 48
    ? 'text-red-500 animate-pulse font-bold'
    : elapsed.hours >= 24
      ? 'text-yellow-500'
      : 'text-green-500';

  // For staff: scan who has sent messages in this chat. Feeds two gates:
  // whether the submitter ever chatted, and whether the current reviewer has
  // entered the chat (a [SYSTEM_JOIN] marker is a message from the joiner).
  useEffect(() => {
    if (!hasStaffPrivileges || !pending?.id || !supabase) return;
    supabase
      .from('pending_chats')
      .select('sender_id')
      .eq('pending_id', pending.id)
      .then(({ data }) => { setChatSenderIds(new Set((data || []).map(r => r.sender_id))); });
  }, [pending.id, hasStaffPrivileges, refreshTrigger]);

  const hasSubmitterChatted = chatSenderIds.has(pending.submitted_by);

  // Characters can't be approved until the player finishes the final step:
  // Character Area thread link registered + upgrades thread confirmed.
  const isCharacterEntry = pending.data?.type === 'Character';
  const ocFinalStepDone = !isCharacterEntry || !!(
    pending.data?.myCharactersLink &&
    (pending.data?.upgradesConfirmed || pending.data?.upgradesLink)
  );

  const assignedId = pendingItem.assigned_to && typeof pendingItem.assigned_to === 'object'
    ? pendingItem.assigned_to.id
    : pendingItem.assigned_to;
  const iAmAssignee = isClaimed && assignedId === currentUserId;
  const hasEnteredChat = iAmAssignee || chatSenderIds.has(currentUserId);
  // Once someone else claims the entry, other reviewers must join the review
  // chat before they can review, approve, deny, or edit it. Reading stays open.
  const mustJoinToAct = isClaimed && hasStaffPrivileges && !hasEnteredChat;

  const handleJoinChat = async () => {
    if (isJoiningChat || hasEnteredChat) return;
    setIsJoiningChat(true);
    try {
      const dn = currentUserProfile?.site_nickname || currentUserProfile?.username || 'A reviewer';
      await sendReviewChat(pending.id, `${JOIN_PREFIX} ${dn} joined the review chat`, false);
      setChatSenderIds(prev => new Set([...prev, currentUserId]));
      setIsChatOpen(true);
      onChatOpened?.();
    } catch (err) {
      alert('Could not join the chat: ' + (err.message || err));
    } finally {
      setIsJoiningChat(false);
    }
  };

  return (
    <div className={`bg-white rounded-2xl shadow-sm border border-amber-200 p-4 flex flex-col gap-3 transition-all duration-500 ${isApproving ? 'opacity-40 scale-95 pointer-events-none' : ''}`}>
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
            {pending.data?.subType === 'reservation_request' && (
              <span className="text-[10px] font-bold uppercase text-purple-700 bg-purple-50 border border-purple-200 px-2 py-0.5 rounded">
                Réservation Request
              </span>
            )}
            {chatMeta?.turn === 'you' && (
              <span className="text-[10px] font-bold uppercase text-rose-600 bg-rose-50 border border-rose-200 px-2 py-0.5 rounded flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-rose-500 animate-pulse" />
                Awaiting Your Response
              </span>
            )}
            {chatMeta?.turn === 'them' && (
              <span className="text-[10px] font-bold uppercase text-amber-600 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                {isMine ? 'Awaiting Reviewer' : 'Awaiting Player'}
              </span>
            )}
            {pending.assignee && (
              <span className="text-[10px] font-bold uppercase text-teal-700 bg-teal-50 border border-teal-200 px-2 py-0.5 rounded flex items-center gap-1">
                Claimed by
                {pending.assignee.avatar_url && (
                  <img
                    src={getNetlifyImageUrl(pending.assignee.avatar_url, 14)}
                    srcSet={getNetlifyImageSrcSet(pending.assignee.avatar_url)}
                    alt=""
                    className="w-3.5 h-3.5 rounded-full object-cover shrink-0"
                    width={14}
                    height={14}
                    loading="lazy"
                  />
                )}
                <span className="truncate max-w-[100px]">{pending.assignee.username}</span>
              </span>
            )}
          </div>
          <h3 className="font-bold text-slate-900 text-base truncate">{name}</h3>
          <p className="text-xs text-slate-500 mt-0.5">
            Submitted by <strong>{submitterName}</strong> · {new Date(pending.submitted_at).toLocaleString()}
          </p>
        </div>
        {elapsed.formatted && (
          <div className={`text-xs flex items-center gap-1 whitespace-nowrap shrink-0 select-none ${timerColorClass}`} title="Time since last activity">
            <span>⏳</span>
            <span>{elapsed.formatted}</span>
          </div>
        )}
      </div>

      {op !== 'delete' && (
        <div className="text-xs text-slate-600 bg-slate-50 border border-slate-100 rounded-lg p-3 space-y-1">
          {display.oc_number                               && <div><span className="font-semibold">OC:</span> {display.oc_number === 1 ? 'First' : display.oc_number === 2 ? 'Second' : 'Third'} character</div>}
          {display.ninja_rank                              && <div><span className="font-semibold">Ninja Rank:</span> {display.ninja_rank}{display.councilor ? ' · Councilor' : ''}</div>}
          {display.village                                 && <div><span className="font-semibold">{display.village === 'Wanderer' ? 'Faction' : 'Village'}:</span> {display.village}</div>}
          {display.squad_type && display.squad_number      && <div><span className="font-semibold">Squad:</span> {display.squad_type === 'genin' ? 'Genin' : 'Chunin'} Squad {display.squad_number}{display.squad_is_new ? ' (new squad)' : ''}</div>}
          {display.mentor_squad_number                     && <div><span className="font-semibold">Mentors:</span> Genin Squad {display.mentor_squad_number}</div>}
          {display.nature                                  && <div><span className="font-semibold">Nature:</span> {display.nature}</div>}
          {Array.isArray(display.rank) && display.rank.length > 0 && <div><span className="font-semibold">Rank:</span> {display.rank.join(', ')}</div>}
          {Array.isArray(display.types) && display.types.length > 0 && <div><span className="font-semibold">Type:</span> {display.types.join(', ')}</div>}
          {display.bloodline                               && <div><span className="font-semibold">Bloodline:</span> {display.bloodline}</div>}
          {Array.isArray(display.spec) && display.spec.length > 0 && <div><span className="font-semibold">Specialization:</span> {display.spec.join(', ')}</div>}
          {display.link && <div><span className="font-semibold">Link:</span>{' '}<a href={display.link} target="_blank" rel="noopener noreferrer" className="text-indigo-600 hover:underline break-all">{display.link}</a></div>}
        </div>
      )}
      {op === 'delete' && (
        <div className="text-xs text-rose-700 bg-rose-50 border border-rose-100 rounded-lg p-3">
          {originalJutsu
            ? <>This will permanently delete <strong>{originalJutsu.name}</strong> from the database.</>
            : <>Target jutsu no longer exists. Cancel this pending entry.</>}
        </div>
      )}

      {pending.data?.subType === 'reservation_request' && (
        <ReservationControls
          pending={pending}
          canAct={hasStaffPrivileges && isClaimed && !mustJoinToAct}
          onCancel={onCancel}
          refreshPending={refreshPending}
        />
      )}

      <div className="flex gap-2 mt-1 flex-wrap">
        {isClaimed ? (
          <>
            {mustJoinToAct ? (
              /* ── Claimed by someone else and not in the chat yet: reviewing,
                    approving, denying, and editing are locked behind joining. ── */
              <ConfirmButton
                onConfirm={handleJoinChat}
                disabled={isJoiningChat}
                armedLabel={<><Icon n="Check" size={14}/> Click again to join</>}
                armedClassName="ring-2 ring-indigo-300 animate-pulse"
                className="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-xl font-bold text-sm flex items-center justify-center gap-1.5 disabled:opacity-60"
                title="Join the review chat to act on this entry"
              >
                {isJoiningChat
                  ? <><Icon n="Refresh" size={14} className="animate-spin"/> Joining…</>
                  : <>👋 Join Chat</>}
              </ConfirmButton>
            ) : (
              <>
                {/* ── All action buttons — only visible once the entry is claimed ── */}
                {pending.status === 'pending_review' ? (
                  hasStaffPrivileges ? (
                    <>
                      <ConfirmButton
                        onConfirm={() => onReview(pending.id)}
                        armedLabel={<><Icon n="Check" size={14}/> Confirm second review?</>}
                        armedClassName="ring-2 ring-slate-400 animate-pulse"
                        className="flex-1 bg-slate-800 hover:bg-slate-700 text-white px-4 py-2 rounded-xl font-bold text-sm flex items-center justify-center gap-1.5">
                        <Icon n="Check" size={14}/> Begin Second Review
                      </ConfirmButton>
                      {['admin', 'owner'].includes(currentUser.role) && (
                        ocFinalStepDone ? (
                          <ConfirmButton
                            onConfirm={() => onApprove(pending.id)}
                            disabled={isApproving}
                            armedLabel={<><Icon n="Check" size={14}/> Confirm approve?</>}
                            armedClassName="ring-2 ring-emerald-300 animate-pulse"
                            className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-xl font-bold text-sm flex items-center justify-center gap-1.5 disabled:opacity-60">
                            {isApproving
                              ? <><Icon n="Refresh" size={14} className="animate-spin"/> Approving...</>
                              : <><Icon n="Check" size={14}/> Admin Approve</>}
                          </ConfirmButton>
                        ) : (
                          <div className="flex-1 text-[10px] font-bold text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 flex items-center justify-center text-center">
                            ⏳ Final step pending — the player must register their character area threads first
                          </div>
                        )
                      )}
                    </>
                  ) : (
                    <>
                      {isMine && !hasStaffPrivileges && (
                        <ConfirmButton
                          onConfirm={() => onSubmitterCancel(pending.id)}
                          armedLabel={<><Icon n="X" size={14}/> Confirm cancel?</>}
                          armedClassName="ring-2 ring-rose-300 animate-pulse !bg-rose-50 !text-rose-700"
                          className="flex-1 bg-slate-100 hover:bg-rose-50 hover:text-rose-700 text-slate-600 px-4 py-2 rounded-xl font-bold text-sm flex items-center justify-center gap-1.5">
                          <Icon n="X" size={14}/> Cancel Submission
                        </ConfirmButton>
                      )}
                      {isStrictSubmitter && (
                        <div className="text-[10px] text-slate-400 italic self-center">
                          Another Reviewer must perform Begin Second Review
                        </div>
                      )}
                    </>
                  )
                ) : (
                  hasStaffPrivileges && (pending.first_reviewer_id !== currentUserId || ['admin', 'owner'].includes(currentUser.role)) && (
                    ocFinalStepDone ? (
                      <ConfirmButton
                        onConfirm={() => onApprove(pending.id)}
                        disabled={isApproving}
                        armedLabel={<><Icon n="Check" size={14}/> Confirm approve?</>}
                        armedClassName="ring-2 ring-emerald-300 animate-pulse"
                        className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-xl font-bold text-sm flex items-center justify-center gap-1.5 disabled:opacity-60">
                        {isApproving
                          ? <><Icon n="Refresh" size={14} className="animate-spin"/> Approving...</>
                          : <><Icon n="Check" size={14}/> Approve</>}
                      </ConfirmButton>
                    ) : (
                      <div className="flex-1 text-[10px] font-bold text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 flex items-center justify-center text-center">
                        ⏳ Final step pending — the player must register their character area threads first
                      </div>
                    )
                  )
                )}
                {onEdit && (!isStrictSubmitter || !isClaimed) && (
                  <button onClick={() => onEdit(pending)}
                          className="bg-slate-100 hover:bg-slate-200 text-slate-600 px-3 py-2 rounded-xl font-bold text-sm flex items-center justify-center gap-1.5"
                          title="Edit pending payload">
                    <Icon n="Edit" size={14}/> Edit
                  </button>
                )}
                {hasStaffPrivileges && (['admin', 'owner'].includes(currentUser.role) || hasSubmitterChatted) && (
                  <ConfirmButton
                    onConfirm={() => onCancel(pending.id)}
                    armedLabel={<><Icon n="X" size={14}/> Confirm deny?</>}
                    armedClassName="ring-2 ring-rose-300 animate-pulse !bg-rose-50 !text-rose-700"
                    className={`${(!isMine && pending.status !== 'pending_review') ? 'flex-none px-4' : 'flex-1'} bg-slate-100 hover:bg-rose-50 hover:text-rose-700 text-slate-600 px-4 py-2 rounded-xl font-bold text-sm flex items-center justify-center gap-1.5`}>
                    <Icon n="X" size={14}/> Cancel Submission
                  </ConfirmButton>
                )}
              </>
            )}
            {(isReviewerOrAdmin || isMine) && (
              <button
                onClick={() => { setIsChatOpen(true); onChatOpened?.(); }}
                className="relative bg-slate-100 hover:bg-amber-50 hover:text-amber-700 text-slate-600 px-3 py-2 rounded-xl font-bold text-sm flex items-center justify-center gap-1.5"
                title="Open Chat"
              >
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                </svg>
                Review Chat
                {chatMeta?.hasUnread && (
                  <span className="absolute -top-1 -right-1 w-3 h-3 rounded-full bg-rose-500 border-2 border-white animate-pulse" title="Unread messages" />
                )}
              </button>
            )}
            {mustJoinToAct && (
              <div className="text-[10px] text-slate-400 italic self-center basis-full">
                Claimed by another Reviewer. Join the review chat to review, approve, or deny — you can still read the chat.
              </div>
            )}
            {!mustJoinToAct && isStrictSubmitter && pending.status === 'pending_approval' && (
              <div className="text-[10px] text-slate-400 italic self-center">
                Another Reviewer must approve
              </div>
            )}
            {!mustJoinToAct && !['admin', 'owner'].includes(currentUser.role) && pending.first_reviewer_id === currentUserId && pending.status === 'pending_approval' && (
              <div className="text-[10px] text-slate-400 italic self-center">
                You reviewed this. Another Reviewer must approve.
              </div>
            )}
          </>
        ) : (
          <>
            {/* ── Unclaimed: only show "Assign to Me" for staff, and info text ── */}
            {hasStaffPrivileges && (
              <ConfirmButton
                onConfirm={() => onClaim(pending.id)}
                armedLabel={<><Icon n="Check" size={14}/> Confirm claim?</>}
                armedClassName="ring-2 ring-teal-300 animate-pulse"
                className="bg-teal-600 hover:bg-teal-700 text-white px-3 py-2 rounded-xl font-bold text-sm flex items-center justify-center gap-1.5"
                title="Assign to Me">
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10" />
                </svg>
                Assign to Me
              </ConfirmButton>
            )}
            {isStrictSubmitter && (
              <div className="text-[10px] text-slate-400 italic self-center">
                Waiting for a Reviewer to claim this entry.
              </div>
            )}
          </>
        )}
      </div>

      {isChatOpen && chatVariant === 'inline' && (
        <div className="border-t border-slate-200 mt-1 -mx-4 -mb-4 rounded-b-2xl overflow-hidden h-[70vh] min-h-[420px]">
          <ReviewChat
            pending={pending}
            name={name}
            currentUserId={currentUserId}
            currentUserProfile={currentUserProfile}
            isStaff={isStaff}
            isStrictSubmitter={isStrictSubmitter}
            isClaimed={isClaimed}
            refreshTrigger={refreshTrigger}
            refreshPending={refreshPending}
            onClose={() => setIsChatOpen(false)}
            onRead={onChatOpened}
            variant="inline"
          />
        </div>
      )}
      {isChatOpen && chatVariant !== 'inline' && (
        <ReviewChat
          pending={pending}
          name={name}
          currentUserId={currentUserId}
          currentUserProfile={currentUserProfile}
          isStaff={isStaff}
          isStrictSubmitter={isStrictSubmitter}
          isClaimed={isClaimed}
          refreshTrigger={refreshTrigger}
          refreshPending={refreshPending}
          onClose={() => setIsChatOpen(false)}
          onRead={onChatOpened}
        />
      )}
    </div>
  );
}
