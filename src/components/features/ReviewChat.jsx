import React, { useState, useEffect, useRef } from 'react';
import {
  supabase,
  fetchReviewChats,
  sendReviewChat,
  editChatMessage,
  deleteChatMessage,
  updatePendingJutsuData,
  getCurrentSession,
} from '../../lib/supabase';
import { renderMessageWithLinks, getNetlifyImageUrl, getNetlifyImageSrcSet, copyText } from '../../utils/helpers';
import Icon from '../ui/Icon';

/* ---- SystemFinalStepBlock -------------------------------------------------- */

function SystemFinalStepBlock({ msg, pending, currentUserId, onUpdatePending }) {
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

  const linksSavedAndVerified =
    pending?.data?.myCharactersLink &&
    pending.data.myCharactersLink.includes('1473338902264676424') &&
    pending?.data?.upgradesLink &&
    pending.data.upgradesLink.includes('1473338902264676425');

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
    if (!myLink.trim() || !upgLink.trim()) { setError('Both links are required.'); return; }
    if (!myLink.includes('1473338902264676424')) { setError('Invalid link — paste a link from the #my-characters forum on the server.'); return; }
    if (!upgLink.includes('1473338902264676425')) { setError('Invalid link — paste a link from the #character-upgrades forum on the server.'); return; }
    setError('');
    setSaving(true);
    try {
      await onUpdatePending({ ...pending.data, myCharactersLink: myLink.trim(), upgradesLink: upgLink.trim() });
    } catch (err) {
      setError('Failed to save links: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleNudge = async () => {
    if (!pending?.data?.second_reviewer_discord_id) {
      alert("Reviewer info couldn't be found. Please refresh the page and try again.");
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
          docLink: pending.data.link,
        }),
      });
      if (res.ok) { setNudged(true); }
      else { const t = await res.text(); alert('Nudge failed: ' + t); }
    } catch (err) {
      alert('Nudge error: ' + err.message);
    } finally {
      setNudging(false);
    }
  };

  return (
    <div className="w-full bg-slate-900 border border-amber-500/30 rounded-3xl p-5 my-2 flex flex-col gap-4 text-white shadow-lg animate-in fade-in">
      <div className="flex items-center gap-2 border-b border-slate-800 pb-3">
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2.5" className="text-amber-400">
          <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
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
        <p className="mt-2">Use the template below for both threads. Once done, your character will be added to the rosters!</p>
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
              {!myLinkValid && <p className="text-red-400 text-[10px] font-bold">Invalid link. Must be from the my-characters forum</p>}
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
              {!upgLinkValid && <p className="text-red-400 text-[10px] font-bold">Invalid link. Must be from the character-upgrades forum</p>}
            </div>

            {error && <p className="text-red-400 text-xs font-bold bg-red-950/30 border border-red-900/50 p-2.5 rounded-xl">{error}</p>}

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

/* ---- ReviewChat ------------------------------------------------------------ */

export default function ReviewChat({
  pending,
  name,
  currentUserId,
  currentUserProfile,
  isStaff,
  isStrictSubmitter,
  isClaimed,
  refreshTrigger,
  refreshPending,
  onClose,
}) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [editDraft, setEditDraft] = useState('');
  const [isSavingEdit, setIsSavingEdit] = useState(false);
  const [deletingId, setDeletingId] = useState(null);
  const [isActivating, setIsActivating] = useState(false);
  const [nudgeCooldown, setNudgeCooldown] = useState(false);
  const messagesEndRef = useRef(null);
  const profileCacheRef = useRef({});

  const visibleMessages = messages.filter(m =>
    isStaff || m.is_staff_only === false || m.is_staff_only === null || m.is_staff_only === undefined
  );

  // Load messages on open / parent refresh
  useEffect(() => {
    fetchReviewChats(pending.id).then(msgs => {
      if (msgs) setMessages(msgs);
    });
  }, [pending.id, refreshTrigger]);

  // Realtime: INSERT adds new messages, UPDATE patches existing ones (edit / soft-delete)
  useEffect(() => {
    if (!pending?.id || !supabase) return;

    const channel = supabase
      .channel(`review-chat-${pending.id}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'pending_chats', filter: `pending_id=eq.${pending.id}` },
        async ({ new: newChat }) => {
          if (!newChat) return;
          let profile = profileCacheRef.current[newChat.sender_id];
          if (!profile) {
            try {
              const { data, error } = await supabase
                .from('profiles')
                .select('username, site_nickname, avatar_url, role')
                .eq('id', newChat.sender_id)
                .single();
              if (!error && data) {
                profileCacheRef.current[newChat.sender_id] = data;
                profile = data;
              }
            } catch {}
          }
          setMessages(prev =>
            prev.some(m => m.id === newChat.id) ? prev : [...prev, { ...newChat, profiles: profile ?? null }]
          );
        }
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'pending_chats', filter: `pending_id=eq.${pending.id}` },
        ({ new: updated }) => {
          if (!updated) return;
          setMessages(prev => prev.map(m => m.id === updated.id ? { ...m, ...updated } : m));
        }
      )
      .subscribe();

    return () => supabase.removeChannel(channel);
  }, [pending?.id]);

  // Auto-scroll to newest message
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = async (e) => {
    e?.preventDefault();
    const text = input.trim();
    if (!text || isSending) return;
    setIsSending(true);
    try {
      await sendReviewChat(pending.id, text, false);
      setInput('');
      const fresh = await fetchReviewChats(pending.id);
      if (fresh) setMessages(fresh);
      // Fire-and-forget push notification to other participants
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (session?.access_token) {
          fetch('/.netlify/functions/send-chat-push', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${session.access_token}`,
            },
            body: JSON.stringify({ pending_id: pending.id, message: text }),
          }).then(async (res) => {
            if (!res.ok) {
              const out = await res.json().catch(() => ({}));
              console.warn('[NARP] send-chat-push failed:', res.status, out);
            }
          }).catch((e) => {
            console.warn('[NARP] send-chat-push request error:', e);
          });
        }
      } catch {}
    } catch (err) {
      alert('Error sending message: ' + (err.message || err));
    } finally {
      setIsSending(false);
    }
  };

  const handleSaveEdit = async (msgId) => {
    const trimmed = editDraft.trim();
    if (!trimmed || isSavingEdit) return;
    setIsSavingEdit(true);
    try {
      const updated = await editChatMessage(msgId, trimmed);
      setMessages(prev => prev.map(m => m.id === msgId ? { ...m, ...updated } : m));
      setEditingId(null);
    } catch (err) {
      alert('Could not save edit: ' + err.message);
    } finally {
      setIsSavingEdit(false);
    }
  };

  const handleDelete = async (msgId) => {
    try {
      await deleteChatMessage(msgId);
      setMessages(prev => prev.map(m => m.id === msgId ? { ...m, is_deleted: true } : m));
      setDeletingId(null);
    } catch (err) {
      alert('Could not delete: ' + err.message);
    }
  };

  const finalStepActivated =
    pending.data?.finalStepActivated || messages.some(m => m.message?.startsWith('[SYSTEM_FINAL_STEP]'));

  const handleActivateFinalStep = async () => {
    if (isActivating) return;
    setIsActivating(true);
    try {
      const systemMessage = `[SYSTEM_FINAL_STEP] Initialized by ${currentUserProfile?.username || 'Reviewer'}`;
      await sendReviewChat(pending.id, systemMessage, false);
      const nextData = {
        ...pending.data,
        finalStepActivated: true,
        second_reviewer_id: currentUserId,
        second_reviewer_discord_id: currentUserProfile?.discord_id || '',
        second_reviewer_username: currentUserProfile?.username || '',
      };
      await updatePendingJutsuData(pending.id, nextData);
      if (refreshPending) await refreshPending();
      const fresh = await fetchReviewChats(pending.id);
      if (fresh) setMessages(fresh);
    } catch {
      alert("Couldn't start the OC approval flow. Refresh the page and try again.");
    } finally {
      setIsActivating(false);
    }
  };

  const lastStaffMsgTime = messages
    .filter(m => ['staff', 'admin', 'owner'].includes(m.profiles?.role))
    .reduce((latest, m) => Math.max(latest, new Date(m.created_at).getTime()), 0);
  const nudgeReviewerLocked = lastStaffMsgTime > 0 && Date.now() - lastStaffMsgTime < 30 * 60 * 1000;

  const handleNudgeReviewer = async () => {
    if (nudgeCooldown) return;
    const reviewerDiscordId = pending.assignee?.discord_id || pending.first_reviewer?.discord_id;
    if (!reviewerDiscordId) { alert('Reviewer Discord ID not available.'); return; }
    setNudgeCooldown(true);
    setTimeout(() => setNudgeCooldown(false), 5000);
    try {
      const sess = await getCurrentSession();
      const authHdr = sess?.access_token ? { Authorization: `Bearer ${sess.access_token}` } : {};
      const res = await fetch('/.netlify/functions/discord-dm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHdr },
        body: JSON.stringify({
          discordUserId: reviewerDiscordId,
          message: `⏰ Reminder from **${pending.submitter?.username || 'Player'}**: Still waiting on your review for **${name}**. Please check the Review Chat when you get a chance!`,
        }),
      });
      if (!res.ok) { await res.text(); alert("Couldn't send the nudge. Please try again in a moment."); }
    } catch { alert("Couldn't send the nudge. Please try again in a moment."); }
  };

  const handleNudgeSubmitter = async () => {
    if (nudgeCooldown) return;
    const discordId = pending.submitter?.discord_id;
    if (!discordId) { alert('Submitter Discord ID not available.'); return; }
    setNudgeCooldown(true);
    setTimeout(() => setNudgeCooldown(false), 5000);
    try {
      const sess = await getCurrentSession();
      const authHdr = sess?.access_token ? { Authorization: `Bearer ${sess.access_token}` } : {};
      const res = await fetch('/.netlify/functions/discord-dm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHdr },
        body: JSON.stringify({
          discordUserId: discordId,
          message: `👋 Hey **${pending.submitter?.username || 'Player'}**! The review team needs your attention on **${name}**. Please open the Review Chat and respond.`,
        }),
      });
      if (!res.ok) { await res.text(); alert("Couldn't send the nudge. Please try again in a moment."); }
    } catch { alert("Couldn't send the nudge. Please try again in a moment."); }
  };

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-40 bg-black/60 animate-in fade-in" onClick={onClose} />

      {/* Drawer */}
      <div
        className="fixed inset-y-0 right-0 z-50 w-full md:w-[500px] bg-white flex flex-col shadow-2xl animate-in slide-in-from-right duration-200"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="bg-slate-900 text-white p-5 flex justify-between items-center shrink-0">
          <div className="flex items-center gap-2">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-amber-400">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
            <h3 className="font-bold text-lg font-serif">Review Chat: {name}</h3>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white transition-colors">
            <Icon n="X" size={18} />
          </button>
        </div>

        {isStrictSubmitter && !isClaimed ? (
          /* Lock screen — no reviewer has claimed this yet */
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
            {/* Final step banner — only for Character-type submissions */}
            {pending?.data?.type === 'Character' && isStaff && currentUserId !== pending.submitted_by && !finalStepActivated && (
              <div className="p-4 bg-amber-50 border-b border-amber-200 flex flex-col gap-2 items-center text-center shrink-0">
                <p className="text-xs text-amber-800 font-semibold">
                  Activate the final approval step to send the player their forum thread instructions and template.
                </p>
                <button
                  type="button"
                  onClick={handleActivateFinalStep}
                  disabled={isActivating}
                  className="bg-amber-600 hover:bg-amber-700 disabled:opacity-60 text-white px-4 py-2 rounded-xl text-xs font-bold transition-all shadow-sm flex items-center gap-1.5"
                >
                  {isActivating
                    ? <><Icon n="Refresh" size={14} className="animate-spin" /> Activating...</>
                    : <><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg> Send Thread Instructions</>
                  }
                </button>
              </div>
            )}

            {/* Message list */}
            <div className="flex-1 overflow-y-auto p-6 bg-slate-50 custom-scrollbar flex flex-col gap-3">
              {visibleMessages.length === 0 ? (
                <div className="flex-1 flex flex-col items-center justify-center text-slate-400 py-12">
                  <svg viewBox="0 0 24 24" width="36" height="36" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="mb-2 text-slate-300">
                    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                  </svg>
                  <p className="text-sm font-semibold">No messages yet.</p>
                  <p className="text-xs text-slate-400 mt-1">
                    {isStaff ? 'Discuss the submission with the player.' : 'The reviewer will respond here soon.'}
                  </p>
                </div>
              ) : (
                visibleMessages.map((msg) => {
                  if (msg.message?.startsWith('[SYSTEM_FINAL_STEP]')) {
                    return (
                      <SystemFinalStepBlock
                        key={msg.id}
                        msg={msg}
                        pending={pending}
                        currentUserId={currentUserId}
                        onUpdatePending={async (newData) => {
                          await updatePendingJutsuData(pending.id, newData);
                          if (refreshPending) await refreshPending();
                        }}
                      />
                    );
                  }

                  const isMe = msg.sender_id === currentUserId;
                  const senderName = msg.profiles?.site_nickname || msg.profiles?.username || 'Unknown User';
                  const isDeleted = msg.is_deleted;
                  const isEdited = msg.is_edited;
                  const isEditingThis = editingId === msg.id;
                  const isDeletingThis = deletingId === msg.id;

                  return (
                    <div key={msg.id} className={`flex flex-col gap-0.5 ${isMe ? 'items-end' : 'items-start'}`}>
                      {/* Message bubble */}
                      <div className={`flex flex-col max-w-[85%] rounded-2xl px-4 py-2.5 text-sm shadow-xs ${
                        isDeleted
                          ? 'opacity-60 bg-slate-100 border border-slate-200 text-slate-400'
                          : isMe
                            ? 'self-end bg-indigo-600 text-white rounded-tr-none border border-indigo-500'
                            : 'self-start bg-white border border-slate-200 text-slate-800 rounded-tl-none'
                      }`}>
                        {isDeleted ? (
                          <p className="text-xs italic text-slate-400">Message removed.</p>
                        ) : isEditingThis ? (
                          <div className="flex flex-col gap-1.5 mt-1">
                            <textarea
                              value={editDraft}
                              onChange={e => setEditDraft(e.target.value)}
                              rows={3}
                              autoFocus
                              className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 resize-none border-indigo-400/40 bg-indigo-500/20 text-white placeholder-indigo-200/60 focus:ring-indigo-300/50"
                              onKeyDown={e => { if (e.key === 'Escape') setEditingId(null); }}
                            />
                            <div className="flex gap-1.5">
                              <button
                                type="button"
                                disabled={isSavingEdit}
                                onClick={() => handleSaveEdit(msg.id)}
                                className="text-[11px] font-bold bg-white/25 hover:bg-white/35 text-white px-3 py-1 rounded-lg disabled:opacity-60 transition-colors"
                              >
                                {isSavingEdit ? 'Saving…' : 'Save'}
                              </button>
                              <button
                                type="button"
                                onClick={() => setEditingId(null)}
                                className="text-[11px] font-bold text-white/70 hover:text-white px-2 py-1 rounded-lg transition-colors"
                              >
                                Cancel
                              </button>
                            </div>
                          </div>
                        ) : isDeletingThis ? (
                          <>
                            <div className="flex items-center gap-1.5 mb-1 flex-wrap">
                              {msg.profiles?.avatar_url && (
                                <img
                                  src={getNetlifyImageUrl(msg.profiles.avatar_url, 20)}
                                  srcSet={getNetlifyImageSrcSet(msg.profiles.avatar_url)}
                                  alt={senderName}
                                  className="w-5 h-5 rounded-full object-cover shrink-0"
                                  width={20} height={20} loading="lazy"
                                />
                              )}
                              <span className="font-serif font-bold text-xs text-indigo-100">{senderName}</span>
                            </div>
                            <p className="whitespace-pre-wrap break-words leading-relaxed text-sm opacity-50 line-clamp-2">
                              {msg.message}
                            </p>
                            <div className="flex items-center gap-2 mt-2 pt-2 flex-wrap border-t border-indigo-400/30">
                              <span className="text-[11px] text-white/80 font-medium">Remove this message?</span>
                              <button
                                type="button"
                                onClick={() => handleDelete(msg.id)}
                                className="text-[11px] font-bold bg-rose-500 hover:bg-rose-600 text-white px-3 py-1 rounded-lg transition-colors"
                              >
                                Remove
                              </button>
                              <button
                                type="button"
                                onClick={() => setDeletingId(null)}
                                className="text-[11px] font-bold text-white/70 hover:text-white px-2 py-1 rounded-lg transition-colors"
                              >
                                Cancel
                              </button>
                            </div>
                          </>
                        ) : (
                          <>
                            <div className="flex items-center gap-1.5 mb-1 flex-wrap">
                              {msg.profiles?.avatar_url && (
                                <img
                                  src={getNetlifyImageUrl(msg.profiles.avatar_url, 20)}
                                  srcSet={getNetlifyImageSrcSet(msg.profiles.avatar_url)}
                                  alt={senderName}
                                  className="w-5 h-5 rounded-full object-cover shrink-0"
                                  width={20} height={20} loading="lazy"
                                />
                              )}
                              <span className={`font-serif font-bold text-xs ${isMe ? 'text-indigo-100' : 'text-slate-900'}`}>
                                {senderName}
                              </span>
                              {msg.profiles?.role && (() => {
                                const r = msg.profiles.role === 'owner' ? 'admin' : msg.profiles.role;
                                return (
                                  <span className={`text-[9px] font-extrabold uppercase tracking-wider px-1.5 py-0.5 rounded-sm ${
                                    isMe
                                      ? 'bg-indigo-500/30 text-indigo-50'
                                      : r === 'admin' ? 'bg-indigo-100 text-indigo-700'
                                      : r === 'staff' ? 'bg-emerald-100 text-emerald-700'
                                      : 'bg-slate-100 text-slate-600'
                                  }`}>
                                    {r === 'staff' ? 'Reviewer' : r}
                                  </span>
                                );
                              })()}
                              <span className={`text-[10px] ${isMe ? 'text-indigo-200' : 'text-slate-400'}`}>
                                · {new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                              </span>
                              {isEdited && (
                                <span className={`text-[9px] italic ${isMe ? 'text-white/60' : 'text-slate-400'}`}>edited</span>
                              )}
                            </div>
                            <p className="whitespace-pre-wrap break-words leading-relaxed text-sm">
                              {renderMessageWithLinks(msg.message)}
                            </p>
                          </>
                        )}
                      </div>

                      {/* Edit / Delete buttons — only visible below own non-deleted messages */}
                      {isMe && !isDeleted && !isEditingThis && !isDeletingThis && (
                        <div className="flex items-center gap-3 px-1">
                          <button
                            type="button"
                            onClick={() => { setEditingId(msg.id); setEditDraft(msg.message); }}
                            className="text-[11px] text-slate-400 hover:text-indigo-600 active:text-indigo-700 transition-colors"
                          >
                            Edit
                          </button>
                          <span className="text-slate-300 text-[11px] select-none">·</span>
                          <button
                            type="button"
                            onClick={() => setDeletingId(msg.id)}
                            className="text-[11px] text-slate-400 hover:text-rose-500 active:text-rose-600 transition-colors"
                          >
                            Delete
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Input footer */}
            <div
              className="p-4 border-t shrink-0 bg-indigo-50/80 border-indigo-100"
              style={{ paddingBottom: 'calc(1rem + env(safe-area-inset-bottom, 0px))' }}
            >
              {((isStrictSubmitter && !isStaff && isClaimed) || isStaff) && (
                <div className="flex gap-2 mb-2.5">
                  {isStrictSubmitter && !isStaff && isClaimed && (
                    <button
                      type="button"
                      onClick={handleNudgeReviewer}
                      disabled={nudgeReviewerLocked || nudgeCooldown}
                      title={nudgeReviewerLocked ? "Wait 30 min after the reviewer's last message before nudging again" : 'Send a DM reminder to the reviewer'}
                      className={`flex-1 text-xs font-bold py-2 px-3 rounded-xl flex items-center justify-center gap-1.5 transition-all ${
                        nudgeReviewerLocked || nudgeCooldown
                          ? 'bg-slate-100 text-slate-400 cursor-not-allowed'
                          : 'bg-amber-50 text-amber-700 border border-amber-200 hover:bg-amber-100'
                      }`}
                    >
                      <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 0 1-3.46 0" />
                      </svg>
                      {nudgeReviewerLocked ? 'Nudge available in ~30 min' : nudgeCooldown ? 'Nudge Sent!' : 'Nudge Reviewer'}
                    </button>
                  )}
                  {isStaff && (
                    <button
                      type="button"
                      onClick={handleNudgeSubmitter}
                      disabled={nudgeCooldown}
                      title="Send a DM reminder to the submitter"
                      className={`flex-1 text-xs font-bold py-2 px-3 rounded-xl flex items-center justify-center gap-1.5 transition-all ${nudgeCooldown ? 'bg-slate-100 text-slate-400 cursor-not-allowed' : 'bg-slate-50 text-slate-600 border border-slate-200 hover:bg-slate-100'}`}
                    >
                      <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 0 1-3.46 0" />
                      </svg>
                      {nudgeCooldown ? 'Nudge Sent!' : 'Nudge Submitter'}
                    </button>
                  )}
                </div>
              )}
              <form onSubmit={handleSend} className="flex gap-2 items-center">
                <input
                  type="text"
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  disabled={isSending}
                  placeholder={isStaff ? 'Type a message to the player...' : 'Type a message to the team...'}
                  className="flex-1 border rounded-xl px-4 py-3 text-sm focus:outline-hidden focus:ring-2 transition-all text-slate-800 placeholder-slate-400 bg-white border-indigo-200 focus:ring-indigo-500 focus:border-indigo-500 disabled:opacity-60"
                />
                <button
                  type="submit"
                  disabled={isSending}
                  className="text-white px-5 py-3 rounded-xl font-bold text-sm flex items-center gap-1.5 shrink-0 shadow-sm transition-all hover:shadow-md bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 disabled:opacity-60"
                >
                  {isSending
                    ? <><Icon n="Refresh" size={14} className="animate-spin" /> Sending</>
                    : <>Send <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" /></svg></>
                  }
                </button>
              </form>
            </div>
          </>
        )}
      </div>
    </>
  );
}
