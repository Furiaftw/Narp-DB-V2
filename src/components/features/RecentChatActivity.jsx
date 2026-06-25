import React, { useState } from 'react';
import Icon from '../ui/Icon';

function elapsed(ts) {
  if (!ts) return '';
  const diff = Math.max(0, Date.now() - new Date(ts).getTime());
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

const OP_COLORS = {
  insert: 'bg-emerald-100 text-emerald-800 border-emerald-300',
  update: 'bg-amber-100 text-amber-800 border-amber-300',
  delete: 'bg-rose-100 text-rose-800 border-rose-300',
};

export default function RecentChatActivity({ recentChats, pendingItems, onSelectPending }) {
  const [collapsed, setCollapsed] = useState(false);

  const rows = recentChats
    .map(chat => {
      const submission = pendingItems.find(p => p.id === chat.pending_id);
      if (!submission) return null;
      return { chat, submission };
    })
    .filter(Boolean);

  if (rows.length === 0) return null;

  return (
    <div className="mb-5 bg-white rounded-2xl border border-indigo-100 shadow-sm overflow-hidden">
      <button
        onClick={() => setCollapsed(c => !c)}
        className="w-full flex items-center justify-between px-4 py-3 bg-indigo-50 hover:bg-indigo-100 transition-colors"
        type="button"
      >
        <div className="flex items-center gap-2">
          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-indigo-500">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
          <span className="text-xs font-bold text-indigo-700 uppercase tracking-widest">Recent Chat Activity</span>
          <span className="bg-indigo-200 text-indigo-800 text-[10px] font-bold px-1.5 py-0.5 rounded-full">{rows.length}</span>
        </div>
        <Icon n={collapsed ? 'Down' : 'Up'} size={14} className="text-indigo-400" />
      </button>

      {!collapsed && (
        <div className="divide-y divide-slate-50">
          {rows.map(({ chat, submission }) => {
            const op = submission.operation;
            const name = (op === 'delete' ? submission.target_name : submission.data?.name) || '(no name)';
            const submitterName = submission.submitter?.username || 'Unknown';
            const preview = (chat.message || '').slice(0, 50) + ((chat.message || '').length > 50 ? '…' : '');

            return (
              <button
                key={chat.id}
                type="button"
                onClick={() => onSelectPending(submission.id)}
                className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-indigo-50 transition-colors text-left"
              >
                <span className={`text-[10px] font-bold uppercase px-1.5 py-0.5 rounded border shrink-0 ${OP_COLORS[op] || ''}`}>
                  {op === 'insert' ? 'New' : op === 'update' ? 'Edit' : 'Delete'}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span className="text-xs font-bold text-slate-800 truncate">{name}</span>
                    <span className="text-[10px] text-slate-400 shrink-0">by {submitterName}</span>
                  </div>
                  <p className="text-[11px] text-slate-500 truncate mt-0.5">{preview}</p>
                </div>
                <span className="text-[10px] text-slate-400 shrink-0 whitespace-nowrap">{elapsed(chat.created_at)}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
