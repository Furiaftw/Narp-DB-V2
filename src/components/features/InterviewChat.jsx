import { useState, useEffect, useRef } from 'react';
import { supabase, fetchApplicationChats, sendApplicationChat } from '../../lib/supabase';
import { getNetlifyImageUrl, getNetlifyImageSrcSet, renderMessageWithLinks } from '../../utils/helpers';

/*
 * Chat between a join applicant and the admin interviewing them. Deliberately
 * a lean sibling of ReviewChat: same fetch/send/realtime skeleton, but pointed
 * at application_chats and stripped of all the jutsu-review machinery
 * (claims, staff-only messages, final-step blocks, nudges, mentions, edits).
 *
 * readOnly renders the transcript without the composer — used once the
 * application has left the 'interview' state.
 */
export default function InterviewChat({
  applicationId,
  currentUserId,
  readOnly = false,
  placeholder = 'Type a message…',
}) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [isSending, setIsSending] = useState(false);
  const messagesListRef = useRef(null);
  const profileCacheRef = useRef({});

  const loadMessages = () => {
    fetchApplicationChats(applicationId).then(msgs => {
      if (msgs) setMessages(msgs);
    });
  };

  useEffect(() => {
    setMessages([]);
    loadMessages();
  }, [applicationId]);

  // Realtime: INSERT adds messages as they arrive. A 30s poll backstops the
  // subscription in case application_chats isn't in the realtime publication.
  useEffect(() => {
    if (!applicationId || !supabase) return;

    const channel = supabase
      .channel(`application-chat-${applicationId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'application_chats', filter: `application_id=eq.${applicationId}` },
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
      .subscribe();

    const poll = setInterval(loadMessages, 30000);
    return () => {
      supabase.removeChannel(channel);
      clearInterval(poll);
    };
  }, [applicationId]);

  // Auto-scroll the chat's own container to the newest message (scrollTop,
  // not scrollIntoView — see the note in ReviewChat).
  useEffect(() => {
    const list = messagesListRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [messages]);

  const handleSend = async (e) => {
    e?.preventDefault();
    const text = input.trim();
    if (!text || isSending) return;
    setIsSending(true);
    try {
      await sendApplicationChat(applicationId, text);
      setInput('');
      loadMessages();
    } catch (err) {
      console.error('[NARP] Failed to send interview message:', err);
      alert('Failed to send message: ' + (err.message || 'unknown error'));
    } finally {
      setIsSending(false);
    }
  };

  return (
    <div className="flex flex-col h-full min-h-0 bg-slate-50 rounded-xl border border-slate-200 overflow-hidden">
      <div ref={messagesListRef} className="flex-1 overflow-y-auto p-4 custom-scrollbar flex flex-col gap-3 min-h-[16rem] max-h-[50vh]">
        {messages.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center text-slate-400 py-10">
            <svg viewBox="0 0 24 24" width="36" height="36" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="mb-2 text-slate-300">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
            <p className="text-sm font-semibold">No messages yet.</p>
            <p className="text-xs text-slate-400 mt-1 text-center max-w-xs">
              This is your interview chat. Say hello!
            </p>
          </div>
        ) : (
          messages.map((msg) => {
            const isMe = msg.sender_id === currentUserId;
            const senderName = msg.profiles?.site_nickname || msg.profiles?.username || 'Unknown User';
            return (
              <div key={msg.id} className={`flex flex-col gap-0.5 ${isMe ? 'items-end' : 'items-start'}`}>
                <div className={`flex flex-col max-w-[85%] rounded-2xl px-4 py-2.5 text-sm shadow-xs ${
                  isMe
                    ? 'self-end bg-indigo-600 text-white rounded-tr-none border border-indigo-500'
                    : 'self-start bg-white border border-slate-200 text-slate-800 rounded-tl-none'
                }`}>
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
                    {['admin', 'owner'].includes(msg.profiles?.role) && (
                      <span className="text-[9px] font-extrabold uppercase tracking-wider px-1.5 py-0.5 rounded-sm bg-indigo-100 text-indigo-700">
                        Admin
                      </span>
                    )}
                  </div>
                  <p className="whitespace-pre-wrap break-words leading-relaxed text-sm">
                    {renderMessageWithLinks(msg.message)}
                  </p>
                  <span className={`text-[10px] mt-1 self-end ${isMe ? 'text-indigo-200' : 'text-slate-400'}`}>
                    {new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
              </div>
            );
          })
        )}
      </div>

      {!readOnly && (
        <form onSubmit={handleSend} className="p-3 bg-white border-t border-slate-200 flex gap-2 shrink-0">
          <textarea
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
            rows={1}
            placeholder={placeholder}
            className="flex-1 border border-slate-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400 resize-none"
          />
          <button
            type="submit"
            disabled={isSending || !input.trim()}
            className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white px-4 py-2 rounded-xl text-sm font-bold transition-colors shrink-0"
          >
            {isSending ? 'Sending…' : 'Send'}
          </button>
        </form>
      )}
    </div>
  );
}
