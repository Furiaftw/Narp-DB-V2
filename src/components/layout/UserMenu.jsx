import React, { useState, useEffect, useRef } from 'react';
import Icon from '../ui/Icon';
import { ProfileAvatar } from '../ui/RankLogo';
import { updateMyWorkThreadId } from '../../lib/supabase';

export function UserMenu({ profile, onSignIn, onSignOut, supabaseReady, devRole, onToggleDevRole, onProfileUpdate }) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef(null);

  const activeProfile = supabaseReady ? profile : {
    id: 'dev-user-id',
    username: 'Dev Administrator',
    email: 'dev@example.com',
    avatar_url: null,
    role: devRole,
    work_thread_id: profile?.work_thread_id || '',
  };

  const [workThreadId, setWorkThreadId] = useState(activeProfile?.work_thread_id || '');
  const [savingWorkThread, setSavingWorkThread] = useState(false);

  useEffect(() => {
    setWorkThreadId(activeProfile?.work_thread_id || '');
  }, [activeProfile?.work_thread_id]);

  useEffect(() => {
    if (!open) return;
    const handleOutsideClick = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutsideClick);
    document.addEventListener('touchstart', handleOutsideClick);
    return () => {
      document.removeEventListener('mousedown', handleOutsideClick);
      document.removeEventListener('touchstart', handleOutsideClick);
    };
  }, [open]);

  if (supabaseReady && !activeProfile) {
    return (
      <button onClick={onSignIn}
              type="button"
              className="text-xs px-3 py-1.5 font-bold rounded-lg bg-[#5865F2] text-white hover:bg-[#4752c4] flex items-center gap-2 shrink-0">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z"/></svg>
        Sign in with Discord
      </button>
    );
  }

  const roleColors = {
    owner: 'bg-amber-500 text-amber-50 border-amber-600',
    admin: 'bg-indigo-500 text-indigo-50 border-indigo-600',
    staff: 'bg-emerald-500 text-emerald-50 border-emerald-600',
    user:  'bg-slate-600 text-slate-50 border-slate-700',
  };

  const handleSaveWorkThread = async () => {
    setSavingWorkThread(true);
    try {
      if (supabaseReady) {
        const updated = await updateMyWorkThreadId(workThreadId);
        onProfileUpdate(updated);
      } else {
        onProfileUpdate({ ...profile, work_thread_id: workThreadId });
      }
    } catch (err) {
      console.error('[NARP] Failed to update work thread ID:', err);
      alert('Failed to update work thread ID: ' + (err.message || err));
    } finally {
      setSavingWorkThread(false);
    }
  };

  return (
    <div className="relative shrink-0" ref={menuRef}>
      <button onClick={() => setOpen(!open)}
              type="button"
              className="flex items-center gap-2 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-lg p-1 pr-2.5 transition-colors">
        <ProfileAvatar profile={activeProfile} className="w-6 h-6 rounded-md" />
        <span className={`text-[10px] font-bold uppercase px-1.5 py-0.5 rounded border ${roleColors[activeProfile.role] || roleColors.user}`}>
          {activeProfile.role === 'staff' ? 'Reviewer' : activeProfile.role}
        </span>
        <Icon n="Down" size={12} className="text-slate-400" />
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-64 bg-white rounded-xl shadow-xl border border-slate-200 z-40 overflow-hidden">
          <div className="p-4 border-b border-slate-100 flex items-center gap-3">
            <ProfileAvatar profile={activeProfile} className="w-10 h-10 rounded-lg" />
            <div className="flex-1 min-w-0">
              <div className="text-sm font-bold text-slate-800 truncate">{activeProfile.username || 'No name'}</div>
            </div>
          </div>
          {['staff', 'admin', 'owner'].includes(activeProfile?.role) && (
            <div className="p-4 border-b border-slate-100 bg-slate-50">
              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest block mb-1">Work Log Thread ID</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={workThreadId}
                  onChange={(e) => setWorkThreadId(e.target.value)}
                  placeholder="Thread ID"
                  className="w-full text-xs border border-slate-300 bg-white rounded px-2 py-1 text-slate-800 focus:outline-none focus:border-indigo-500"
                />
                <button
                  type="button"
                  onClick={handleSaveWorkThread}
                  disabled={savingWorkThread}
                  className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs px-3 py-1 rounded disabled:opacity-50 transition-colors shrink-0"
                >
                  {savingWorkThread ? '...' : 'Save'}
                </button>
              </div>
            </div>
          )}
          {!supabaseReady && (
            <button onClick={onToggleDevRole}
                    type="button"
                    className="w-full text-left px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 flex items-center gap-2.5 border-t border-slate-100">
              <Icon n="Key" size={14} className="text-indigo-500"/> Toggle Dev Role (is: {devRole === 'staff' ? 'Reviewer' : devRole})
            </button>
          )}
          <button onClick={() => { setOpen(false); onSignOut(); }}
                  type="button"
                  className="w-full text-left px-4 py-2.5 text-sm font-semibold text-rose-600 hover:bg-rose-50 flex items-center gap-2.5 border-t border-slate-100">
            <Icon n="X" size={14}/> Sign out
          </button>
        </div>
      )}
    </div>
  );
}

export default UserMenu;
