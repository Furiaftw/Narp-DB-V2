import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  supabase,
  fetchReviewChats,
  sendReviewChat,
  editChatMessage,
  deleteChatMessage,
  updatePendingJutsuData,
  getCurrentSession,
} from '../../lib/supabase';
import { getNetlifyImageUrl, getNetlifyImageSrcSet, copyText } from '../../utils/helpers';
import { DISCORD_ROLES, applyDiscordRoles } from '../../lib/discordRoles';
import Icon from '../ui/Icon';
import ConfirmButton from '../ui/ConfirmButton';
import useIsDesktop from '../../hooks/useIsDesktop';

/*
 * System message posted when a reviewer joins a claimed chat. Also acts as the
 * persistence for join state: anyone with a message in the thread (join marker
 * included) counts as having entered the chat.
 */
export const JOIN_PREFIX = '[SYSTEM_JOIN]';

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Website display name: custom site nickname wins over the Discord username.
const displayNameOf = (p) => p?.site_nickname || p?.username || 'Unknown User';

/* ---- SystemFinalStepBlock -------------------------------------------------- */

// A forum THREAD link is discord.com/channels/<guildId>/<threadId> — it never
// contains the parent forum's channel ID, so the only URL-checkable fact is
// that the thread lives in our server (guild). Reviewers verify the rest.
const NARP_GUILD_ID = '1473338897697214584';
const isServerThreadLink = (link) =>
  new RegExp(`discord(?:app)?\\.com/channels/${NARP_GUILD_ID}/\\d+`).test(link || '');

function SystemFinalStepBlock({ msg, pending, currentUserId, onUpdatePending, participants = [] }) {
  const d = pending?.data || {};
  const [myLink, setMyLink] = useState(d.myCharactersLink || '');
  const [areaChecked, setAreaChecked] = useState(!!d.myCharactersLink);
  const [upgradesChecked, setUpgradesChecked] = useState(!!(d.upgradesConfirmed || d.upgradesLink));
  const [copied, setCopied] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [nudged, setNudged] = useState(false);
  const [nudging, setNudging] = useState(false);

  const isSubmitter = currentUserId === pending?.submitted_by;

  const myLinkValid = !myLink || isServerThreadLink(myLink);
  const myLinkComplete = !!myLink.trim() && isServerThreadLink(myLink);

  // Older entries stored an upgradesLink; either that or the new checkbox
  // confirmation counts as the upgrades thread being done.
  const linksSavedAndVerified =
    d.myCharactersLink &&
    isServerThreadLink(d.myCharactersLink) &&
    (d.upgradesConfirmed || d.upgradesLink);

  // Discord mentions of every reviewer involved: staff who entered this chat
  // (claimer, joiners, anyone who messaged), plus the recorded first/second
  // reviewers as a fallback when chat data hasn't loaded.
  const reviewerMentions = [...new Set([
    ...participants
      .filter(p => ['staff', 'admin', 'owner'].includes(p.role) && p.id !== pending?.submitted_by)
      .map(p => p.discord_id),
    pending?.assignee?.discord_id,
    pending?.first_reviewer?.discord_id,
    d.second_reviewer_discord_id,
  ].filter(Boolean))].map(id => `<@${id}>`).join(' ');

  const submitterMention = pending?.submitter?.discord_id
    ? `<@${pending.submitter.discord_id}>`
    : '@tagyourself';

  // Template pre-filled from the OC entry — paste-ready for Discord.
  const ocName = d.name && d.name !== 'OC Submission' ? d.name : 'Character name';
  const templateText = `${ocName} | ${submitterMention}
Village: ${d.village || '[If not in village put wanderer or rogue]'}
Rank: ${d.ninja_rank || '[As per character sheet]'}
Clan/KKG/hidden: ${d.bloodline || '[Name of clan, if there is one]'}
Approved by: ${reviewerMentions || '[Tag the reviewers involved]'}
Other: [For Jinchuriki/Sage/seven sword, other non clan things]
Character Doc: ${d.link || "[Link your approved character's google doc here]"}`;

  const handleCopy = () => {
    copyText(templateText, () => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  const handleSave = async () => {
    if (!myLinkComplete) { setError('Paste your Character Area thread link from the NARP server (right-click your thread → Copy Link).'); return; }
    if (!areaChecked || !upgradesChecked) { setError('Check both boxes once the threads are created.'); return; }
    setError('');
    setSaving(true);
    try {
      await onUpdatePending({ ...pending.data, myCharactersLink: myLink.trim(), upgradesConfirmed: true });
    } catch (err) {
      setError('Failed to save: ' + err.message);
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
          upgradesLink: pending.data.upgradesLink || '',
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
        <p className="font-bold text-white text-sm">Your character is almost approved! There is one last step before you are all set.</p>
        <p>Please create a thread in:</p>
        <div className="flex flex-col gap-1.5 pl-2 mt-1">
          <a href="https://discord.com/channels/1473338897697214584/1473338902264676424" target="_blank" rel="noopener noreferrer" className="text-indigo-400 hover:text-indigo-300 font-bold flex items-center gap-1.5">
            ◈ #my-characters → your character RP log area
          </a>
          <a href="https://discord.com/channels/1473338897697214584/1473338902264676425" target="_blank" rel="noopener noreferrer" className="text-indigo-400 hover:text-indigo-300 font-bold flex items-center gap-1.5">
            ◈ #character-upgrades → your character upgrades log area
          </a>
        </div>
        <p className="mt-2">
          Make sure to use the template below for your character area thread. Once done, your character will be added to
          the rosters and you will receive your roles! If you need help, ping <strong className="text-indigo-300">@Reviewer</strong> on
          Discord and we will guide you through it.
        </p>
      </div>

      <div className="bg-slate-950 rounded-2xl p-4 border border-slate-800/80">
        <div className="flex justify-between items-center mb-2">
          <span className="text-[10px] uppercase tracking-wider font-extrabold text-slate-400">Copy the template below for #my-characters</span>
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
            {/* Thread checklist: character area needs its Discord link to be
                checkable; the upgrades thread is a simple confirmation. */}
            <div className="flex flex-col gap-2 bg-slate-950 rounded-2xl p-4 border border-slate-800/80">
              <div className="flex items-start gap-2.5">
                <input
                  type="checkbox"
                  id={`fs-area-${pending.id}`}
                  checked={areaChecked}
                  disabled={!myLinkComplete}
                  onChange={e => { setAreaChecked(e.target.checked); setError(''); }}
                  className="w-4 h-4 mt-0.5 rounded accent-indigo-500 disabled:opacity-40 shrink-0"
                />
                <label htmlFor={`fs-area-${pending.id}`} className="text-xs font-bold text-slate-200 cursor-pointer select-none">
                  Character Area thread created (#my-characters)
                  <span className="block text-[10px] font-semibold text-slate-500 mt-0.5">Paste the thread link below to unlock this checkbox.</span>
                </label>
              </div>
              <input
                type="url"
                value={myLink}
                onChange={e => {
                  setMyLink(e.target.value);
                  setError('');
                  if (!isServerThreadLink(e.target.value)) setAreaChecked(false);
                }}
                placeholder="https://discord.com/channels/.../your-thread-id"
                className="w-full text-xs border border-slate-800 bg-slate-900 rounded-xl px-3 py-2.5 text-white focus:outline-none focus:border-indigo-500 placeholder-slate-600"
              />
              {!myLinkValid && <p className="text-red-400 text-[10px] font-bold">Invalid link. Paste your thread's link from the NARP server (right-click the thread → Copy Link)</p>}
            </div>

            <div className="flex items-start gap-2.5 bg-slate-950 rounded-2xl p-4 border border-slate-800/80">
              <input
                type="checkbox"
                id={`fs-upg-${pending.id}`}
                checked={upgradesChecked}
                onChange={e => { setUpgradesChecked(e.target.checked); setError(''); }}
                className="w-4 h-4 mt-0.5 rounded accent-indigo-500 shrink-0"
              />
              <label htmlFor={`fs-upg-${pending.id}`} className="text-xs font-bold text-slate-200 cursor-pointer select-none">
                Character Upgrades thread created (#character-upgrades)
                <span className="block text-[10px] font-semibold text-slate-500 mt-0.5">No link needed — just confirm you created it.</span>
              </label>
            </div>

            {error && <p className="text-red-400 text-xs font-bold bg-red-950/30 border border-red-900/50 p-2.5 rounded-xl">{error}</p>}

            {!linksSavedAndVerified ? (
              <button
                type="button"
                onClick={handleSave}
                disabled={saving || !myLinkComplete || !areaChecked || !upgradesChecked}
                className="w-full mt-1 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-bold py-2.5 rounded-xl text-xs transition-colors"
              >
                {saving ? 'Verifying...' : 'Complete Final Step'}
              </button>
            ) : (
              <div className="flex flex-col gap-2.5 mt-1 bg-emerald-950/20 border border-emerald-900/50 p-4 rounded-2xl">
                <div className="flex items-center gap-2 text-emerald-400 text-xs font-bold">
                  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="3" className="shrink-0">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                  <span>Final step complete! A second reviewer will verify everything and approve.</span>
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
                <p className="text-slate-400 text-[10px] font-bold uppercase tracking-wider mb-2">Final step completed by submitter:</p>
                <div className="flex flex-col gap-2 pl-1">
                  <a href={pending.data.myCharactersLink} target="_blank" rel="noopener noreferrer" className="text-indigo-400 hover:underline font-bold flex items-center gap-1.5 truncate">
                    ✓ Character Area Thread Link
                  </a>
                  {pending.data.upgradesLink ? (
                    <a href={pending.data.upgradesLink} target="_blank" rel="noopener noreferrer" className="text-indigo-400 hover:underline font-bold flex items-center gap-1.5 truncate">
                      ✓ Character Upgrades Thread Link
                    </a>
                  ) : (
                    <span className="text-emerald-400 font-bold flex items-center gap-1.5">
                      ✓ Upgrades thread confirmed by submitter
                    </span>
                  )}
                </div>
                <p className="text-slate-500 text-[10px] mt-3">Verify the threads, then approve the submission from the Pending tab.</p>
              </div>
            ) : (
              <div className="bg-slate-950 rounded-2xl p-4 border border-slate-800 flex items-center gap-2.5 text-slate-400">
                <div className="w-2 h-2 rounded-full bg-amber-500 animate-pulse shrink-0" />
                <span>Waiting for the submitter to create their threads and register the Character Area link...</span>
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
  variant = 'drawer',
  onRead = null,
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
  const [isJoiningChat, setIsJoiningChat] = useState(false);
  const [mentionQuery, setMentionQuery] = useState(null); // null = picker closed
  const [mentionIndex, setMentionIndex] = useState(0);
  const messagesListRef = useRef(null);
  const profileCacheRef = useRef({});
  const inputRef = useRef(null);
  const isDesktop = useIsDesktop();

  const visibleMessages = messages.filter(m =>
    isStaff || m.is_staff_only === false || m.is_staff_only === null || m.is_staff_only === undefined
  );

  const assignedId = pending?.assigned_to && typeof pending.assigned_to === 'object'
    ? pending.assigned_to.id
    : pending?.assigned_to;

  /* Everyone who entered this chat: submitter, claimer, and message senders
     (a join marker is a message, so joined reviewers are included). Feeds the
     @mention picker and the mention-highlight renderer. */
  const participants = useMemo(() => {
    const map = new Map();
    const add = (id, prof) => {
      if (!id || !prof) return;
      const existing = map.get(id);
      // Prefer entries that carry a discord_id so mention pings can be delivered
      if (!existing || (!existing.discord_id && prof.discord_id)) map.set(id, { id, ...prof });
    };
    add(pending?.submitted_by, pending?.submitter);
    add(assignedId, pending?.assignee);
    messages.forEach(m => add(m.sender_id, m.profiles));
    return [...map.values()];
  }, [messages, pending, assignedId]);

  const hasJoined =
    isStrictSubmitter ||
    currentUserId === assignedId ||
    messages.some(m => m.sender_id === currentUserId);

  // Highlights any "@Website Name" / "@discordname" of a chat participant.
  const mentionRegex = useMemo(() => {
    const names = [...new Set(participants.flatMap(p => [p.site_nickname, p.username]).filter(Boolean))]
      .sort((a, b) => b.length - a.length)
      .map(escapeRegex);
    return names.length ? new RegExp(`@(${names.join('|')})`, 'gi') : null;
  }, [participants]);

  const renderMessageBody = (text, isMe) => {
    if (!text) return '';
    const urlParts = String(text).split(/(https?:\/\/[^\s]+)/g);
    return urlParts.map((part, i) => {
      if (/^https?:\/\//.test(part)) {
        return (
          <a key={i} href={part} target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:text-blue-400 hover:underline">
            {part}
          </a>
        );
      }
      if (!mentionRegex) return part;
      const segs = part.split(mentionRegex);
      if (segs.length === 1) return part;
      return segs.map((seg, j) => j % 2 === 1
        ? (
          <span key={`${i}-${j}`} className={`font-bold rounded px-1 ${isMe ? 'bg-white/25 text-white' : 'bg-indigo-100 text-indigo-700'}`}>
            @{seg}
          </span>
        )
        : seg
      );
    });
  };

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
                .select('username, site_nickname, avatar_url, role, discord_id')
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

  // Auto-scroll to newest message. Scoped to the chat's own scroll container
  // (scrollTop, not scrollIntoView) — scrollIntoView also scrolls ancestor
  // scrollers including the page itself, which yanked the whole window down
  // whenever messages loaded while the chat was rendered in document flow.
  useEffect(() => {
    const list = messagesListRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [messages]);

  // Report that the thread is being viewed so unread badges clear — on open
  // and again whenever new messages arrive while the chat stays open.
  const onReadRef = useRef(onRead);
  onReadRef.current = onRead;
  useEffect(() => {
    onReadRef.current?.();
  }, [pending.id, messages.length]);

  /* ---- @mention picker ------------------------------------------------- */

  const updateMentionState = (value, caret) => {
    const before = value.slice(0, caret ?? value.length);
    const m = before.match(/(^|\s)@([^\n@]*)$/);
    setMentionQuery(m ? m[2] : null);
    setMentionIndex(0);
  };

  const mentionMatches = useMemo(() => {
    if (mentionQuery === null) return [];
    const q = mentionQuery.toLowerCase();
    return participants
      .filter(p => p.id !== currentUserId)
      .filter(p => !q
        || (p.site_nickname || '').toLowerCase().includes(q)
        || (p.username || '').toLowerCase().includes(q))
      .slice(0, 6);
  }, [mentionQuery, participants, currentUserId]);

  // Inserts the participant's *website* display name, even when the query
  // matched their Discord username.
  const insertMention = (p) => {
    const el = inputRef.current;
    const caret = el ? el.selectionStart : input.length;
    const before = input.slice(0, caret);
    const after = input.slice(caret);
    const m = before.match(/(^|\s)@([^\n@]*)$/);
    if (!m) { setMentionQuery(null); return; }
    const start = before.length - m[2].length - 1; // index of the '@'
    const display = displayNameOf(p);
    setInput(input.slice(0, start) + '@' + display + ' ' + after);
    setMentionQuery(null);
    requestAnimationFrame(() => {
      if (el) {
        el.focus();
        const pos = start + display.length + 2;
        el.setSelectionRange(pos, pos);
      }
    });
  };

  const handleInputKeyDown = (e) => {
    if (mentionMatches.length > 0) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setMentionIndex(i => (i + 1) % mentionMatches.length); return; }
      if (e.key === 'ArrowUp')   { e.preventDefault(); setMentionIndex(i => (i - 1 + mentionMatches.length) % mentionMatches.length); return; }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); insertMention(mentionMatches[mentionIndex]); return; }
      if (e.key === 'Escape') { setMentionQuery(null); return; }
    }
    // Desktop: Enter sends, Shift+Enter adds a line. Mobile: Enter adds a line;
    // sending happens via the Send button.
    if (e.key === 'Enter' && !e.shiftKey && isDesktop) {
      e.preventDefault();
      handleSend();
    }
  };

  const autoResizeInput = (el) => {
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 140) + 'px';
  };

  // Keep the textarea height in sync when input changes programmatically
  // (mention insertion, clearing after send).
  useEffect(() => { autoResizeInput(inputRef.current); }, [input]);

  // Discord-DM every @mentioned participant (fire-and-forget).
  const sendMentionPings = async (text) => {
    const lower = text.toLowerCase();
    const mentioned = participants.filter(p => {
      if (p.id === currentUserId || !p.discord_id) return false;
      return [p.site_nickname, p.username]
        .filter(Boolean)
        .some(n => lower.includes('@' + n.toLowerCase()));
    });
    if (!mentioned.length) return;
    try {
      const sess = await getCurrentSession();
      const authHdr = sess?.access_token ? { Authorization: `Bearer ${sess.access_token}` } : {};
      const senderName = displayNameOf(currentUserProfile) || 'Someone';
      const excerpt = text.length > 140 ? text.slice(0, 140) + '…' : text;
      mentioned.forEach(p => {
        fetch('/.netlify/functions/discord-dm', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...authHdr },
          body: JSON.stringify({
            discordUserId: p.discord_id,
            message: `💬 **${senderName}** mentioned you in the Review Chat for **${name}**:\n> ${excerpt}`,
          }),
        }).catch(err => console.warn('[NARP] Mention ping failed:', err));
      });
    } catch (err) {
      console.warn('[NARP] Mention ping skipped:', err);
    }
  };

  const handleJoinChat = async () => {
    if (isJoiningChat || hasJoined) return;
    setIsJoiningChat(true);
    try {
      const dn = displayNameOf(currentUserProfile) || 'A reviewer';
      await sendReviewChat(pending.id, `${JOIN_PREFIX} ${dn} joined the review chat`, false);
      const fresh = await fetchReviewChats(pending.id);
      if (fresh) setMessages(fresh);
    } catch (err) {
      alert('Could not join the chat: ' + (err.message || err));
    } finally {
      setIsJoiningChat(false);
    }
  };

  const handleSend = async (e) => {
    e?.preventDefault();
    const text = input.trim();
    if (!text || isSending) return;
    setIsSending(true);
    setMentionQuery(null);
    try {
      await sendReviewChat(pending.id, text, false);
      setInput('');
      if (inputRef.current) inputRef.current.style.height = 'auto';
      sendMentionPings(text);
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

      // Grant "Has Character" immediately — without it the player can't post
      // in the character-area forum this final step sends them to. Also strip
      // "No Character" (a no-op past their first submission). A failure here
      // must not undo the activation; the reviewer just grants manually.
      if (pending.submitter?.discord_id) {
        try {
          await applyDiscordRoles({
            discordUserId: pending.submitter.discord_id,
            add: [DISCORD_ROLES.HAS_CHARACTER],
            remove: [DISCORD_ROLES.NO_CHARACTER],
            reason: `Final step activated for "${pending.data?.name || 'OC'}"`,
          });
        } catch (roleErr) {
          console.warn('[NARP] Has Character role grant failed:', roleErr);
          alert('Final step started, but granting the "Has Character" Discord role failed — please give it to the player manually so they can post their threads. (' + (roleErr.message || roleErr) + ')');
        }
      } else {
        alert('Final step started, but the submitter has no linked Discord ID — grant the "Has Character" role manually.');
      }
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

  const inner = (
    <>
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
            <div ref={messagesListRef} className="flex-1 overflow-y-auto p-6 bg-slate-50 custom-scrollbar flex flex-col gap-3">
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
                  if (msg.message?.startsWith(JOIN_PREFIX)) {
                    return (
                      <div key={msg.id} className="flex justify-center my-1">
                        <span className="text-[11px] font-semibold text-slate-500 bg-slate-200/80 border border-slate-300/60 px-3 py-1 rounded-full flex items-center gap-1.5">
                          👋 {msg.message.replace(JOIN_PREFIX, '').trim()}
                          <span className="text-slate-400 font-normal">
                            · {new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </span>
                        </span>
                      </div>
                    );
                  }
                  if (msg.message?.startsWith('[SYSTEM_FINAL_STEP]')) {
                    return (
                      <SystemFinalStepBlock
                        key={msg.id}
                        msg={msg}
                        pending={pending}
                        currentUserId={currentUserId}
                        participants={participants}
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
                              {renderMessageBody(msg.message, isMe)}
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
                  {isStaff && hasJoined && (
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
              {isStaff && !hasJoined ? (
                /* Spectator mode: reviewers can read the chat, but must join
                   before sending messages or taking review actions. */
                <div className="flex flex-col gap-2">
                  <p className="text-xs text-slate-500 text-center font-medium">
                    You're viewing this chat as a spectator. Join to send messages and take review actions.
                  </p>
                  <ConfirmButton
                    onConfirm={handleJoinChat}
                    disabled={isJoiningChat}
                    armedLabel="Click again to join"
                    armedClassName="ring-2 ring-indigo-300 animate-pulse"
                    className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-2.5 rounded-xl text-sm flex items-center justify-center gap-1.5 disabled:opacity-60 transition-all"
                    title="Join this review chat"
                  >
                    {isJoiningChat
                      ? <><Icon n="Refresh" size={14} className="animate-spin" /> Joining…</>
                      : <>👋 Join Chat</>}
                  </ConfirmButton>
                </div>
              ) : (
                <div className="relative">
                  {mentionMatches.length > 0 && (
                    <div className="absolute bottom-full left-0 right-0 mb-2 bg-white border border-slate-200 rounded-2xl shadow-xl overflow-hidden z-10">
                      <div className="px-3 pt-2 pb-1 text-[10px] font-extrabold uppercase tracking-wider text-slate-400">
                        In this chat
                      </div>
                      {mentionMatches.map((p, i) => {
                        const display = displayNameOf(p);
                        const showDiscord = p.username && p.username !== display;
                        return (
                          <button
                            key={p.id}
                            type="button"
                            onMouseDown={e => { e.preventDefault(); insertMention(p); }}
                            onMouseEnter={() => setMentionIndex(i)}
                            className={`w-full flex items-center gap-2.5 px-3 py-2 text-left transition-colors ${
                              i === mentionIndex ? 'bg-indigo-50' : 'bg-white'
                            }`}
                          >
                            {p.avatar_url ? (
                              <img
                                src={getNetlifyImageUrl(p.avatar_url, 24)}
                                srcSet={getNetlifyImageSrcSet(p.avatar_url)}
                                alt=""
                                className="w-6 h-6 rounded-full object-cover shrink-0"
                                width={24} height={24} loading="lazy"
                              />
                            ) : (
                              <span className="w-6 h-6 rounded-full bg-slate-200 flex items-center justify-center text-[10px] font-bold text-slate-500 shrink-0">
                                {display.slice(0, 1).toUpperCase()}
                              </span>
                            )}
                            <span className="text-sm font-bold text-slate-800 truncate">{display}</span>
                            {showDiscord && (
                              <span className="text-xs text-slate-400 truncate">@{p.username}</span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  )}
                  <form onSubmit={handleSend} className="flex gap-2 items-end">
                    <textarea
                      ref={inputRef}
                      value={input}
                      rows={1}
                      onChange={e => {
                        setInput(e.target.value);
                        autoResizeInput(e.target);
                        updateMentionState(e.target.value, e.target.selectionStart);
                      }}
                      onKeyDown={handleInputKeyDown}
                      onClick={e => updateMentionState(e.target.value, e.target.selectionStart)}
                      onBlur={() => setTimeout(() => setMentionQuery(null), 150)}
                      disabled={isSending}
                      placeholder={isStaff ? 'Type a message to the player... (@ to ping)' : 'Type a message to the team... (@ to ping)'}
                      className="flex-1 border rounded-xl px-4 py-3 text-sm focus:outline-hidden focus:ring-2 transition-all text-slate-800 placeholder-slate-400 bg-white border-indigo-200 focus:ring-indigo-500 focus:border-indigo-500 disabled:opacity-60 resize-none overflow-y-auto leading-relaxed"
                      style={{ maxHeight: 140 }}
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
                  {isDesktop && (
                    <p className="text-[10px] text-slate-400 mt-1.5 px-1 select-none">
                      Enter to send · Shift+Enter for a new line · @ to ping someone in this chat
                    </p>
                  )}
                </div>
              )}
            </div>
          </>
        )}
    </>
  );

  // Inline variant fills its parent (the split-view panel) — no backdrop, no
  // fixed positioning. The parent supplies borders, rounding, and height.
  if (variant === 'inline') {
    return (
      <div className="w-full h-full bg-white flex flex-col overflow-hidden">
        {inner}
      </div>
    );
  }

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-40 bg-black/60 animate-in fade-in" onClick={onClose} />

      {/* Drawer */}
      <div
        className="fixed inset-y-0 right-0 z-50 w-full md:w-[500px] bg-white flex flex-col shadow-2xl animate-in slide-in-from-right duration-200"
        onClick={e => e.stopPropagation()}
      >
        {inner}
      </div>
    </>
  );
}
