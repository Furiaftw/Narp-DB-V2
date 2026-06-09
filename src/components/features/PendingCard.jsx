import React, { useState, useEffect, useRef } from 'react';
import Icon from '../ui/Icon';
import { copyText, renderMessageWithLinks, getSlotStatus, toArray, getNetlifyImageUrl, getNetlifyImageSrcSet } from '../../utils/helpers';
import {
  supabase,
  fetchReviewChats,
  sendReviewChat,
  updatePendingJutsuData,
  cancelPendingJutsu,
  approvePendingJutsu,
  reviewPendingJutsu,
  claimPendingSubmission,
} from '../../lib/supabase';

/* ============================================================================
   COMPONENT: SystemFinalStepBlock
   ============================================================================ */
export function SystemFinalStepBlock({ msg, pending, currentUserId, onUpdatePending }) {
  const [myLink, setMyLink] = useState(pending?.data?.myCharactersLink || '');
  const [upgLink, setUpgLink] = useState(pending?.data?.upgradesLink || '');
  const [copied, setCopied] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [nudged, setNudged] = useState(false);
  const [nudging, setNudging] = useState(false);

  const isSubmitter = currentUserId === pending?.submitted_by;

  const myLinkValid = !myLink || myLink.includes('1473338902264676424');
  const upgLinkValid = !upgLink || upgLink.includes('1473338902264676425');

  const linksSavedAndVerified = pending?.data?.myCharactersLink && 
                                pending?.data?.myCharactersLink.includes('1473338902264676424') && 
                                pending?.data?.upgradesLink && 
                                pending?.data?.upgradesLink.includes('1473338902264676425');

  const templateText = `Character name | @tagyourself
Village: [If not in village put wanderer or rogue]
Rank: [As per character sheet]
Bloodline/hidden: [Name of bloodline, if there is one]
Approved by: [Tag the reviewers involved]
Other: [For Jinchuriki/Sage/seven sword, other non bloodline things]
Character Doc: [Link your approved character's google doc here]`;

  const handleCopy = () => {
    copyText(templateText, () => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  const handleSave = async () => {
    if (!myLink.trim() || !upgLink.trim()) {
      setError('Both links are required.');
      return;
    }
    if (!myLink.includes('1473338902264676424')) {
      setError('Invalid link — paste a link from the #my-characters forum on the server.');
      return;
    }
    if (!upgLink.includes('1473338902264676425')) {
      setError('Invalid link — paste a link from the #character-upgrades forum on the server.');
      return;
    }

    setError('');
    setSaving(true);
    try {
      await onUpdatePending({
        ...pending.data,
        myCharactersLink: myLink.trim(),
        upgradesLink: upgLink.trim()
      });
    } catch (err) {
      setError('Failed to save links: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleNudge = async () => {
    if (!pending?.data?.second_reviewer_discord_id) {
      alert('Reviewer info couldn\'t be found. Please refresh the page and try again.');
      return;
    }
    setNudging(true);
    try {
      const res = await fetch('/.netlify/functions/nudge-reviewer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pendingId: pending.id,
          submitterName: pending.submitter?.username || 'Player',
          reviewerDiscordId: pending.data.second_reviewer_discord_id,
          myCharactersLink: pending.data.myCharactersLink,
          upgradesLink: pending.data.upgradesLink,
          docLink: pending.data.link
        })
      });
      if (res.ok) {
        setNudged(true);
      } else {
        await res.text();
        alert('Couldn\'t send the nudge. Please try again in a moment.');
      }
    } catch (err) {
      console.error('[NARP] Nudge error:', err);
      alert('Couldn\'t send the nudge. Please try again in a moment.');
    } finally {
      setNudging(false);
    }
  };

  return (
    <div className="w-full bg-slate-900 border border-amber-500/30 rounded-3xl p-5 my-2 flex flex-col gap-4 text-white shadow-lg animate-in fade-in">
      <div className="flex items-center gap-2 border-b border-slate-800 pb-3">
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2.5" className="text-amber-400">
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="8" x2="12" y2="12" />
          <line x1="12" y1="16" x2="12.01" y2="16" />
        </svg>
        <span className="font-serif font-black tracking-wider text-sm uppercase text-amber-400">Final Step: OC Submission</span>
      </div>

      <div className="text-xs space-y-2 text-slate-300 leading-relaxed">
        <p className="font-bold text-white text-sm">Your character is almost approved!</p>
        <p>Please create a thread in the following forums on Discord:</p>
        <div className="flex flex-col gap-1.5 pl-2 mt-1">
          <a href="https://discord.com/channels/1473338897697214584/1473338902264676424" target="_blank" rel="noopener noreferrer" className="text-indigo-400 hover:text-indigo-300 font-bold flex items-center gap-1.5">
            ◈ my-characters — your character RP log area
          </a>
          <a href="https://discord.com/channels/1473338897697214584/1473338902264676425" target="_blank" rel="noopener noreferrer" className="text-indigo-400 hover:text-indigo-300 font-bold flex items-center gap-1.5">
            ◈ character-upgrades — your character upgrades log area
          </a>
        </div>
        <p className="mt-2">Use the template below for both threads. Once you submit both links, you're all set!</p>
      </div>

      <div className="bg-slate-950 rounded-2xl p-4 border border-slate-800/80">
        <div className="flex justify-between items-center mb-2">
          <span className="text-[10px] uppercase tracking-wider font-extrabold text-slate-400">Thread Template</span>
          <button
            type="button"
            onClick={handleCopy}
            className={`text-[10px] font-bold px-2.5 py-1 rounded-lg transition-all flex items-center gap-1.5 ${copied ? 'bg-emerald-500 text-white' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'}`}
          >
            {copied ? 'Copied!' : 'Copy Template'}
          </button>
        </div>
        <pre className="text-[10px] font-mono whitespace-pre-wrap text-slate-300 bg-slate-900/50 p-3 rounded-xl max-h-36 overflow-y-auto border border-slate-800/50">
          {templateText}
        </pre>
      </div>

      <div className="border-t border-slate-800/80 pt-4 flex flex-col gap-3">
        {isSubmitter ? (
          <>
            <div className="flex flex-col gap-2">
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">My-Characters Thread Link</label>
              <input
                type="url"
                value={myLink}
                onChange={e => { setMyLink(e.target.value); setError(''); }}
                placeholder="https://discord.com/channels/.../1473338902264676424"
                className="w-full text-xs border border-slate-800 bg-slate-950 rounded-xl px-3 py-2.5 text-white focus:outline-none focus:border-indigo-500 placeholder-slate-600"
              />
              {!myLinkValid && (
                <p className="text-red-400 text-[10px] font-bold">Invalid link. Must be from the my-characters forum</p>
              )}
            </div>

            <div className="flex flex-col gap-2">
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Character-Upgrades Thread Link</label>
              <input
                type="url"
                value={upgLink}
                onChange={e => { setUpgLink(e.target.value); setError(''); }}
                placeholder="https://discord.com/channels/.../1473338902264676425"
                className="w-full text-xs border border-slate-800 bg-slate-950 rounded-xl px-3 py-2.5 text-white focus:outline-none focus:border-indigo-500 placeholder-slate-600"
              />
              {!upgLinkValid && (
                <p className="text-red-400 text-[10px] font-bold">Invalid link. Must be from the character-upgrades forum</p>
              )}
            </div>

            {error && (
              <p className="text-red-400 text-xs font-bold bg-red-950/30 border border-red-900/50 p-2.5 rounded-xl">{error}</p>
            )}

            {!linksSavedAndVerified ? (
              <button
                type="button"
                onClick={handleSave}
                disabled={saving || !myLink.trim() || !upgLink.trim() || !myLinkValid || !upgLinkValid}
                className="w-full mt-1 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-bold py-2.5 rounded-xl text-xs transition-colors"
              >
                {saving ? 'Verifying...' : 'Verify and Save Links'}
              </button>
            ) : (
              <div className="flex flex-col gap-2.5 mt-1 bg-emerald-950/20 border border-emerald-900/50 p-4 rounded-2xl">
                <div className="flex items-center gap-2 text-emerald-400 text-xs font-bold">
                  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="3" className="shrink-0">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                  <span>Links verified and saved successfully!</span>
                </div>
                <button
                  type="button"
                  onClick={handleNudge}
                  disabled={nudging || nudged}
                  className={`w-full font-bold py-2.5 rounded-xl text-xs transition-all flex items-center justify-center gap-2 shadow-sm ${nudged ? 'bg-slate-800 text-slate-500 cursor-not-allowed' : 'bg-emerald-600 hover:bg-emerald-700 text-white'}`}
                >
                  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 0 1-3.46 0" />
                  </svg>
                  {nudged ? 'Reviewer Nudged!' : nudging ? 'Nudging...' : 'Nudge Second Reviewer'}
                </button>
              </div>
            )}
          </>
        ) : (
          <div className="text-xs space-y-3">
            {linksSavedAndVerified ? (
              <div className="bg-slate-950 rounded-2xl p-4 border border-slate-800">
                <p className="text-slate-400 text-[10px] font-bold uppercase tracking-wider mb-2">Verified links provided by submitter:</p>
                <div className="flex flex-col gap-2 pl-1">
                  <a href={pending.data.myCharactersLink} target="_blank" rel="noopener noreferrer" className="text-indigo-400 hover:underline font-bold flex items-center gap-1.5 truncate">
                    My-Characters Thread Link
                  </a>
                  <a href={pending.data.upgradesLink} target="_blank" rel="noopener noreferrer" className="text-indigo-400 hover:underline font-bold flex items-center gap-1.5 truncate">
                    Character-Upgrades Thread Link
                  </a>
                </div>
              </div>
            ) : (
              <div className="bg-slate-950 rounded-2xl p-4 border border-slate-800 flex items-center gap-2.5 text-slate-400">
                <div className="w-2 h-2 rounded-full bg-amber-500 animate-pulse shrink-0" />
                <span>Waiting for submitter to submit forum links...</span>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/* ============================================================================
   COMPONENT: PendingJutsuCard
   ============================================================================ */
export function PendingJutsuCard({
  pending,
  originalJutsu,
  currentUserId,
  isAdmin,
  onApprove,
  onCancel,
  onReview,
  onEdit,
  currentUserRole,
  refreshTrigger,
  onClaim,
  isMySubmissionsView = false,
  currentUserProfile = null,
  refreshPending = null
}) {
  const currentUser = { id: currentUserId, role: currentUserRole };
  const pendingItem = pending;

  const isStrictSubmitter = currentUser.id === pendingItem.submitted_by && !['staff', 'admin', 'owner'].includes(currentUser.role);

  const hasStaffPrivileges = ['staff', 'admin', 'owner'].includes(currentUser.role) && !isStrictSubmitter;

  const isMine     = pending.submitted_by === currentUserId;
  const op         = pending.operation;
  const submitter  = pending.submitter;
  const submitterName = submitter?.username || 'Unknown';

  const isReviewerOrAdmin = currentUserRole === 'staff' || currentUserRole === 'admin' || currentUserRole === 'owner';
  const isStaff = isReviewerOrAdmin;

  const opColors = {
    insert: 'bg-emerald-100 text-emerald-800 border-emerald-300',
    update: 'bg-amber-100  text-amber-800  border-amber-300',
    delete: 'bg-rose-100   text-rose-800   border-rose-300',
  };

  const display = op === 'delete' ? (originalJutsu || {}) : (pending.data || {});
  const name = display.name || originalJutsu?.name || '(no name)';

  const [isChatOpen, setIsChatOpen] = useState(false);
  const [chatMessages, setChatMessages] = useState([]);
  const [chatInput, setChatInput] = useState('');
  const [activeTab, setActiveTab] = useState('submitter'); // 'submitter' or 'staff'
  const messagesEndRef = useRef(null);

  const showStaffSync = currentUserRole === 'owner' || (['staff', 'admin'].includes(currentUserRole) && currentUserId !== pending.submitted_by);

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

  useEffect(() => {
    if (isChatOpen) {
      if (isStrictSubmitter) {
        setActiveTab('submitter');
      } else if (currentUserId === pending.submitted_by) {
        setActiveTab('submitter');
      } else if (!showStaffSync) {
        setActiveTab('submitter');
      }
    }
  }, [isChatOpen, currentUserId, pending.submitted_by, showStaffSync, isStrictSubmitter]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    if (isChatOpen) {
      fetchReviewChats(pending.id).then(msgs => {
        if (msgs) {
          setChatMessages(msgs);
        }
      });
    }
  }, [isChatOpen, refreshTrigger, pending.id]);

  useEffect(() => {
    if (!isChatOpen || !pending?.id || !supabase) return;

    const channel = supabase
      .channel(`pending-chats-${pending.id}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'pending_chats',
          filter: `pending_id=eq.${pending.id}`
        },
        async (payload) => {
          const newChat = payload.new;
          if (!newChat) return;
          try {
            const { data: profile, error } = await supabase
              .from('profiles')
              .select('username, avatar_url, role')
              .eq('id', newChat.sender_id)
              .single();

            const newMessage = {
              ...newChat,
              profiles: error ? null : profile
            };

            setChatMessages((prev) => {
              if (prev.some((msg) => msg.id === newMessage.id)) {
                return prev;
              }
              return [...prev, newMessage];
            });
          } catch (err) {
            console.error('[NARP] Realtime handler error joining profile:', err);
            const newMessage = {
              ...newChat,
              profiles: null
            };
            setChatMessages((prev) => {
              if (prev.some((msg) => msg.id === newMessage.id)) {
                return prev;
              }
              return [...prev, newMessage];
            });
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [isChatOpen, pending?.id]);

  useEffect(() => {
    if (isChatOpen) {
      scrollToBottom();
    }
  }, [chatMessages, isChatOpen]);

  const handleSend = async (e) => {
    if (e) e.preventDefault();
    const messageText = chatInput.trim();
    if (!messageText) return;

    try {
      const isStaffOnly = activeTab === 'staff';
      await sendReviewChat(pending.id, messageText, isStaffOnly);
      setChatInput('');
      const freshMsgs = await fetchReviewChats(pending.id);
      if (freshMsgs) {
        setChatMessages(freshMsgs);
      }
    } catch (err) {
      alert('Error sending message: ' + (err.message || err));
    }
  };

  const finalStepActivated = pending.data?.finalStepActivated || chatMessages.some(m => m.message && m.message.startsWith('[SYSTEM_FINAL_STEP]'));

  const handleActivateFinalStep = async () => {
    try {
      const systemMessage = `[SYSTEM_FINAL_STEP] Initialized by ${currentUserProfile?.username || 'Reviewer'}`;
      await sendReviewChat(pending.id, systemMessage, false);

      const nextData = {
        ...pending.data,
        finalStepActivated: true,
        second_reviewer_id: currentUserId,
        second_reviewer_discord_id: currentUserProfile?.discord_id || '',
        second_reviewer_username: currentUserProfile?.username || ''
      };
      await updatePendingJutsuData(pending.id, nextData);

      if (refreshPending) {
        await refreshPending();
      }
      const freshMsgs = await fetchReviewChats(pending.id);
      if (freshMsgs) {
        setChatMessages(freshMsgs);
      }
    } catch (err) {
      alert('Couldn\'t start the OC approval flow. Refresh the page and try again.');
    }
  };

  const filteredMessages = chatMessages.filter(msg => {
    if (activeTab === 'staff') {
      // Overhaul: Show both public player messages and private staff sync comments in the Staff Sync tab
      // This gives reviewers full context of the discussion without constantly switching tabs!
      return true;
    } else {
      // activeTab === 'submitter' (Public Submitter Chat)
      // Standard players/users should only see public messages
      return msg.is_staff_only === false || msg.is_staff_only === null || msg.is_staff_only === undefined;
    }
  });

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

      <div className="flex gap-2 mt-1 flex-wrap">
        {pending.status === 'pending_review' ? (
          hasStaffPrivileges ? (
            <>
              <button onClick={() => onReview(pending.id)}
                      className="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-xl font-bold text-sm flex items-center justify-center gap-1.5">
                <Icon n="Check" size={14}/> Review (Step 1)
              </button>
              {['admin', 'owner'].includes(currentUser.role) && (
                <button onClick={() => onApprove(pending.id)}
                        className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-xl font-bold text-sm flex items-center justify-center gap-1.5">
                  <Icon n="Check" size={14}/> Admin Approve
                </button>
              )}
            </>
          ) : (
            isStrictSubmitter && (
              <div className="text-[10px] text-slate-400 italic self-center">
                Another Reviewer must perform Review (Step 1)
              </div>
            )
          )
        ) : (
          hasStaffPrivileges && (pending.first_reviewer_id !== currentUserId || ['admin', 'owner'].includes(currentUser.role)) && (
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
        {hasStaffPrivileges && (
          <button onClick={() => onCancel(pending.id)}
                  className={`${(!isMine && pending.status !== 'pending_review') ? 'flex-none px-4' : 'flex-1'} bg-slate-100 hover:bg-rose-50 hover:text-rose-700 text-slate-600 px-4 py-2 rounded-xl font-bold text-sm flex items-center justify-center gap-1.5`}>
            <Icon n="X" size={14}/> Cancel Submission
          </button>
        )}
        {!isClaimed && hasStaffPrivileges && (
          <button onClick={() => onClaim(pending.id)}
                  className="bg-teal-600 hover:bg-teal-700 text-white px-3 py-2 rounded-xl font-bold text-sm flex items-center justify-center gap-1.5"
                  title="Claim Review">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10" />
            </svg>
            Assign to Me
          </button>
        )}
        {(isReviewerOrAdmin || isMine) && (
          <button
            onClick={() => setIsChatOpen(true)}
            className="bg-slate-100 hover:bg-amber-50 hover:text-amber-700 text-slate-600 px-3 py-2 rounded-xl font-bold text-sm flex items-center justify-center gap-1.5"
            title="Open Chat"
          >
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
            Review Chat
          </button>
        )}
        {isStrictSubmitter && pending.status === 'pending_approval' && (
          <div className="text-[10px] text-slate-400 italic self-center">
            Another Reviewer must approve
          </div>
        )}
        {!['admin', 'owner'].includes(currentUser.role) && pending.first_reviewer_id === currentUserId && pending.status === 'pending_approval' && (
          <div className="text-[10px] text-slate-400 italic self-center">
            You reviewed this. Another Reviewer must approve.
          </div>
        )}
      </div>

      {isChatOpen && (
        <>
          {/* Backdrop overlay */}
          <div className="fixed inset-0 z-40 bg-black/60 animate-in fade-in" onClick={() => setIsChatOpen(false)} />

          {/* Drawer */}
          <div className="fixed inset-y-0 right-0 z-50 w-full md:w-[500px] bg-white flex flex-col shadow-2xl animate-in slide-in-from-right duration-200" onClick={e => e.stopPropagation()}>
            {/* Header */}
            <div className="bg-slate-900 text-white p-5 flex justify-between items-center shrink-0">
              <div className="flex items-center gap-2">
                <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-amber-400">
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                </svg>
                <h3 className="font-bold text-lg font-serif">Review Chat: {name}</h3>
              </div>
              <button onClick={() => setIsChatOpen(false)} className="text-slate-400 hover:text-white transition-colors">
                <Icon n="X" size={18} />
              </button>
            </div>

            {(isStrictSubmitter && !isClaimed) ? (
              <div className="flex-1 flex flex-col items-center justify-center text-slate-500 p-12 bg-slate-50">
                <svg viewBox="0 0 24 24" width="48" height="48" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="mb-4 text-amber-500 animate-pulse">
                  <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                  <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                </svg>
                <p className="text-sm font-semibold text-center text-slate-700 max-w-md leading-relaxed">
                  Your submission has been received. The chat will open automatically once a reviewer claims this entry.
                </p>
              </div>
            ) : (
              <>
                {/* Tabs (Staff only) */}
                {isStaff && !isStrictSubmitter && (
                  <div className="flex border-b border-slate-200 bg-slate-100 shrink-0">
                    <button
                      onClick={() => setActiveTab('submitter')}
                      className={`flex-1 py-3 text-center text-sm font-bold transition-all border-b-2 flex items-center justify-center gap-2 ${
                        activeTab === 'submitter'
                          ? 'border-indigo-600 text-indigo-600 bg-white font-black'
                          : 'border-transparent text-slate-500 hover:text-slate-800 hover:bg-slate-50'
                      }`}
                    >
                      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                        <circle cx="9" cy="7" r="4" />
                        <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                        <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                      </svg>
                      Submitter Chat (Public)
                    </button>
                    {showStaffSync && (
                      <button
                        onClick={() => setActiveTab('staff')}
                        className={`flex-1 py-3 text-center text-sm font-bold transition-all border-b-2 flex items-center justify-center gap-2 ${
                          activeTab === 'staff'
                            ? 'border-amber-600 text-amber-600 bg-white font-black'
                            : 'border-transparent text-slate-500 hover:text-slate-800 hover:bg-slate-50'
                      }`}
                    >
                      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                        <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                      </svg>
                      Reviewer Notes (Private)
                    </button>
                    )}
                  </div>
                )}

                {/* Activate Final Step Banner */}
                {pending?.data?.type === 'Character' && isStaff && currentUserId !== pending.submitted_by && !finalStepActivated && (
                  <div className="p-4 bg-amber-50 border-b border-amber-200 flex flex-col gap-2 items-center text-center shrink-0">
                    <p className="text-xs text-amber-800 font-semibold">
                      Activate the final approval step to send the player their forum thread instructions and template.
                    </p>
                    <button
                      type="button"
                      onClick={handleActivateFinalStep}
                      className="bg-amber-600 hover:bg-amber-700 text-white px-4 py-2 rounded-xl text-xs font-bold transition-all shadow-sm flex items-center gap-1.5"
                    >
                      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5">
                        <line x1="12" y1="5" x2="12" y2="19" />
                        <line x1="5" y1="12" x2="19" y2="12" />
                      </svg>
                      Send Thread Instructions
                    </button>
                  </div>
                )}

                {/* Chat Body */}
                <div className="flex-1 overflow-y-auto p-6 bg-slate-50 custom-scrollbar flex flex-col gap-3">
                  {filteredMessages.length === 0 ? (
                    <div className="flex-1 flex flex-col items-center justify-center text-slate-400 py-12">
                      <svg viewBox="0 0 24 24" width="36" height="36" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="mb-2 text-slate-300">
                        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                      </svg>
                      <p className="text-sm font-semibold">No messages yet.</p>
                      <p className="text-xs text-slate-400 mt-1">
                        {activeTab === 'staff' ? 'All messages — including private reviewer notes — appear here.' : 'Discuss the submission with the player.'}
                      </p>
                    </div>
                  ) : (
                    filteredMessages.map((msg) => {
                      const isSystemFinalStep = msg.message && msg.message.startsWith('[SYSTEM_FINAL_STEP]');
                      if (isSystemFinalStep) {
                        return (
                          <SystemFinalStepBlock
                            key={msg.id}
                            msg={msg}
                            pending={pending}
                            currentUserId={currentUserId}
                            onUpdatePending={async (newData) => {
                              await updatePendingJutsuData(pending.id, newData);
                              if (refreshPending) {
                                await refreshPending();
                              }
                            }}
                          />
                        );
                      }

                      const isMe = msg.sender_id === currentUserId;
                      const senderName = msg.profiles?.username || 'Unknown User';
                      const isPrivate = msg.is_staff_only;
                      return (
                        <div
                          key={msg.id}
                          className={`flex flex-col max-w-[85%] rounded-2xl px-4 py-2.5 text-sm shadow-xs ${
                            isMe
                              ? isPrivate
                                ? 'self-end bg-amber-600 text-white rounded-tr-none border border-amber-500'
                                : 'self-end bg-indigo-600 text-white rounded-tr-none border border-indigo-500'
                              : isPrivate
                                ? 'self-start bg-amber-50 border border-amber-100 text-amber-900 rounded-tl-none'
                                : 'self-start bg-white border border-slate-200 text-slate-800 rounded-tl-none'
                          }`}
                        >
                          <div className="flex items-center gap-1.5 mb-1 flex-wrap">
                            {msg.profiles?.avatar_url && (
                              <img
                                src={getNetlifyImageUrl(msg.profiles.avatar_url, 20)}
                                srcSet={getNetlifyImageSrcSet(msg.profiles.avatar_url)}
                                alt={senderName}
                                className="w-5 h-5 rounded-full object-cover shrink-0"
                                width={20}
                                height={20}
                                loading="lazy"
                              />
                            )}
                            <span className={`font-serif font-bold text-xs ${isMe ? (isPrivate ? 'text-amber-100' : 'text-indigo-100') : 'text-slate-900'}`}>
                              {senderName}
                            </span>
                            {msg.profiles?.role && (() => {
                              const senderRole = msg.profiles.role;
                              return (
                                <span className={`text-[9px] font-extrabold uppercase tracking-wider px-1.5 py-0.5 rounded-sm ${
                                  isMe
                                    ? isPrivate ? 'bg-amber-500/30 text-amber-50' : 'bg-indigo-500/30 text-indigo-50'
                                    : senderRole === 'owner'
                                      ? 'bg-amber-100 text-amber-700'
                                      : senderRole === 'admin'
                                        ? 'bg-indigo-100 text-indigo-700'
                                        : senderRole === 'staff'
                                          ? 'bg-emerald-100 text-emerald-700'
                                          : 'bg-slate-100 text-slate-600'
                                }`}>
                                  {senderRole === 'staff' ? 'Reviewer' : senderRole === 'owner' ? 'Operator' : senderRole}
                                </span>
                              );
                            })()}
                            {isPrivate ? (
                              <span className="text-[9px] font-extrabold uppercase tracking-wider px-1.5 py-0.5 rounded-sm bg-amber-200 text-amber-800 border border-amber-300">
                                Private
                              </span>
                            ) : (
                              activeTab === 'staff' && (
                                <span className={`text-[9px] font-extrabold uppercase tracking-wider px-1.5 py-0.5 rounded-sm ${
                                  isMe ? 'bg-indigo-500/30 text-indigo-50 border border-indigo-500/20' : 'bg-slate-100 text-slate-600 border border-slate-200'
                                }`}>
                                  Public Message
                                </span>
                              )
                            )}
                            <span className={`text-[10px] ${isMe ? (isPrivate ? 'text-amber-200' : 'text-indigo-200') : 'text-slate-400'}`}>
                              · {new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </span>
                          </div>
                          <p className="whitespace-pre-wrap break-words leading-relaxed text-sm">
                            {renderMessageWithLinks(msg.message)}
                          </p>
                        </div>
                      );
                    })
                  )}
                  <div ref={messagesEndRef} />
                </div>

                {/* Input Footer */}
                <div 
                  className={`p-4 border-t shrink-0 transition-colors ${
                    activeTab === 'staff'
                      ? 'bg-amber-50/80 border-amber-100'
                      : 'bg-indigo-50/80 border-indigo-100'
                  }`}
                  style={{ paddingBottom: 'calc(1rem + env(safe-area-inset-bottom, 0px))' }}
                >
                  <form onSubmit={handleSend} className="flex gap-2 items-center">
                    <span className={`text-[10px] font-bold px-2 py-1.5 rounded-lg shrink-0 select-none uppercase border ${
                      activeTab === 'staff'
                        ? 'text-amber-800 bg-amber-100 border-amber-200'
                        : 'text-indigo-800 bg-indigo-100 border-indigo-200'
                    }`}>
                      {activeTab === 'staff' ? 'Private' : 'Public'}
                    </span>
                    <input
                      type="text"
                      value={chatInput}
                      onChange={(e) => setChatInput(e.target.value)}
                      placeholder={
                        activeTab === 'staff'
                          ? "Type a staff-only message..."
                          : isStaff
                            ? "Type a message to the player..."
                            : "Type a message to the team..."
                      }
                      className={`flex-1 border rounded-xl px-4 py-3 text-sm focus:outline-hidden focus:ring-2 transition-all text-slate-800 placeholder-slate-400 ${
                        activeTab === 'staff'
                          ? 'bg-white border-amber-200 focus:ring-amber-500 focus:border-amber-500'
                          : 'bg-white border-indigo-200 focus:ring-indigo-500 focus:border-indigo-500'
                      }`}
                    />
                    <button
                      type="submit"
                      className={`text-white px-5 py-3 rounded-xl font-bold text-sm flex items-center gap-1.5 shrink-0 shadow-sm transition-all hover:shadow-md ${
                        activeTab === 'staff'
                          ? 'bg-amber-600 hover:bg-amber-700 active:bg-amber-800'
                          : 'bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800'
                      }`}
                    >
                      Send
                      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <line x1="22" y1="2" x2="11" y2="13" />
                        <polygon points="22 2 15 22 11 13 2 9 22 2" />
                      </svg>
                    </button>
                  </form>
                </div>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}

export default PendingJutsuCard;
