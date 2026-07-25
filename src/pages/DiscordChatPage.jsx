import React, { useState, useEffect, useCallback, useRef } from 'react';
import { getCurrentSession } from '../lib/supabase';

const POLL_MS = 4000;

const authedFetch = async (url, opts = {}) => {
  const sess = await getCurrentSession();
  const res = await fetch(url, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      ...(sess?.access_token ? { Authorization: `Bearer ${sess.access_token}` } : {}),
      ...(opts.headers || {}),
    },
  });
  const out = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(out.error || `Request failed (${res.status})`);
  return out;
};

const fmtTime = (iso) => {
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
    });
  } catch { return ''; }
};

export default function DiscordChatPage() {
  const [channels, setChannels] = useState([]);
  const [channelsLoading, setChannelsLoading] = useState(true);
  const [channelsError, setChannelsError] = useState('');

  const [selectedId, setSelectedId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [messagesError, setMessagesError] = useState('');

  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState('');

  const scrollRef = useRef(null);
  const wasAtBottomRef = useRef(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { channels: list } = await authedFetch('/.netlify/functions/discord-channels');
        if (!cancelled) setChannels(list || []);
      } catch (e) {
        if (!cancelled) setChannelsError(e.message);
      } finally {
        if (!cancelled) setChannelsLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const loadMessages = useCallback(async (channelId, { silent = false } = {}) => {
    if (!channelId) return;
    if (!silent) setMessagesLoading(true);
    setMessagesError('');
    try {
      const { messages: list } = await authedFetch(
        `/.netlify/functions/discord-messages?channelId=${channelId}`
      );
      setMessages(prev => {
        if (!silent) return list || [];
        // Merge by id so an optimistically-appended message doesn't flicker/duplicate.
        const byId = new Map((list || []).map(m => [m.id, m]));
        for (const m of prev) if (!byId.has(m.id)) byId.set(m.id, m);
        return [...byId.values()].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
      });
    } catch (e) {
      if (!silent) setMessagesError(e.message);
    } finally {
      if (!silent) setMessagesLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!selectedId) return;
    setMessages([]);
    loadMessages(selectedId);
  }, [selectedId, loadMessages]);

  // Poll while a channel is selected and the tab is visible.
  useEffect(() => {
    if (!selectedId) return;
    let interval = null;
    const start = () => {
      if (interval) return;
      interval = setInterval(() => loadMessages(selectedId, { silent: true }), POLL_MS);
    };
    const stop = () => { if (interval) { clearInterval(interval); interval = null; } };
    const onVisibility = () => { if (document.hidden) stop(); else start(); };

    document.addEventListener('visibilitychange', onVisibility);
    if (!document.hidden) start();

    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      stop();
    };
  }, [selectedId, loadMessages]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (wasAtBottomRef.current) el.scrollTop = el.scrollHeight;
  }, [messages]);

  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    wasAtBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  };

  const handleSend = async () => {
    const content = draft.trim();
    if (!content || !selectedId || sending) return;
    setSending(true);
    setSendError('');
    try {
      const { message } = await authedFetch('/.netlify/functions/discord-send-message', {
        method: 'POST',
        body: JSON.stringify({ channelId: selectedId, content }),
      });
      setMessages(prev => [...prev, message]);
      setDraft('');
      wasAtBottomRef.current = true;
    } catch (e) {
      setSendError(e.message);
    } finally {
      setSending(false);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const grouped = [];
  {
    const seenCategory = new Set();
    for (const c of channels) {
      const key = c.category_name || '';
      if (!seenCategory.has(key)) {
        seenCategory.add(key);
        grouped.push({ category: c.category_name, items: [] });
      }
      grouped[grouped.length - 1].items.push(c);
    }
  }

  const selectedChannel = channels.find(c => c.id === selectedId);

  return (
    <div className="flex h-[calc(100vh-160px)] min-h-[400px] m-4 md:m-6 border border-gray-200 rounded-lg overflow-hidden bg-white">
      <div className="w-56 shrink-0 border-r border-gray-200 overflow-y-auto bg-gray-50">
        {channelsLoading && (
          <div className="p-3 text-sm text-gray-500">Loading channels…</div>
        )}
        {channelsError && (
          <div className="p-3 text-sm text-red-600">{channelsError}</div>
        )}
        {grouped.map((g, i) => (
          <div key={i} className="mb-2">
            {g.category && (
              <div className="px-3 pt-3 pb-1 text-xs font-semibold uppercase tracking-wide text-gray-400">
                {g.category}
              </div>
            )}
            {g.items.map(c => (
              <button
                key={c.id}
                onClick={() => setSelectedId(c.id)}
                className={`w-full text-left px-3 py-1.5 text-sm truncate flex items-center gap-1.5
                  ${selectedId === c.id ? 'bg-indigo-100 text-indigo-700 font-medium' : 'text-gray-700 hover:bg-gray-100'}`}
              >
                <span className="text-gray-400">#</span>{c.name}
              </button>
            ))}
          </div>
        ))}
      </div>

      <div className="flex-1 flex flex-col min-w-0">
        {!selectedId ? (
          <div className="flex-1 flex items-center justify-center text-gray-400 text-sm">
            Select a channel to view messages
          </div>
        ) : (
          <>
            <div className="px-4 py-2 border-b border-gray-200 font-medium text-gray-800 flex items-center gap-1.5">
              <span className="text-gray-400">#</span>{selectedChannel?.name}
            </div>

            <div ref={scrollRef} onScroll={handleScroll} className="flex-1 overflow-y-auto p-4 space-y-3">
              {messagesLoading && (
                <div className="text-sm text-gray-500">Loading messages…</div>
              )}
              {messagesError && (
                <div className="text-sm text-red-600">{messagesError}</div>
              )}
              {!messagesLoading && !messagesError && messages.length === 0 && (
                <div className="text-sm text-gray-400">No messages yet.</div>
              )}
              {messages.map(m => (
                <div key={m.id} className="flex gap-2.5">
                  {m.author.avatar ? (
                    <img src={m.author.avatar} alt="" className="w-8 h-8 rounded-full shrink-0" />
                  ) : (
                    <div className="w-8 h-8 rounded-full bg-gray-300 shrink-0" />
                  )}
                  <div className="min-w-0">
                    <div className="flex items-baseline gap-2">
                      <span className="font-medium text-sm text-gray-800">{m.author.username}</span>
                      <span className="text-xs text-gray-400">{fmtTime(m.timestamp)}</span>
                    </div>
                    <div className="text-sm text-gray-700 whitespace-pre-wrap break-words">{m.content}</div>
                  </div>
                </div>
              ))}
            </div>

            <div className="border-t border-gray-200 p-3">
              {sendError && <div className="text-sm text-red-600 mb-2">{sendError}</div>}
              <div className="flex items-end gap-2">
                <textarea
                  value={draft}
                  onChange={e => setDraft(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder={`Message #${selectedChannel?.name || ''}`}
                  rows={1}
                  className="flex-1 resize-none border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
                <button
                  onClick={handleSend}
                  disabled={sending || !draft.trim()}
                  className="px-4 py-2 rounded-md bg-indigo-600 text-white text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed hover:bg-indigo-700"
                >
                  Send
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
