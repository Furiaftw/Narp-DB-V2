import { useState, useRef, useEffect } from 'react';
import { Icon } from '../ui/Icon';
import ProfileAvatar from '../ui/ProfileAvatar';
import { updateMySiteNickname } from '../../lib/supabase';
import {
  isNotifEnabled, setNotifEnabled, requestNotifPermission, getNotifPermission,
  subscribeToPush, unsubscribeFromPush,
} from '../../lib/notifications';

/* ============================================================================
   COMPONENT: UserMenu
   The header account menu: sign in/out, site nickname, push-notification
   toggle, and (for the owner) the view-as-role switcher.
   ============================================================================ */

/* ============================================================================
   COMPONENT: UserMenu
   ============================================================================ */
export function UserMenu({ profile, onSignIn, onDevSignIn, onSignOut, supabaseReady, devRole, onToggleDevRole, onProfileUpdate, viewAsRole, onSetViewAsRole }) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef(null);
  const [notifEnabled, setNotifEnabledState] = useState(() => isNotifEnabled());
  const [notifPermission, setNotifPermissionState] = useState(() => getNotifPermission());
  const [notifDeniedMsg, setNotifDeniedMsg] = useState(false);
  const [nicknameInput, setNicknameInput] = useState('');
  const [nicknameEditing, setNicknameEditing] = useState(false);
  const [nicknameSaving, setNicknameSaving] = useState(false);
  const [nicknameMsg, setNicknameMsg] = useState('');

  const activeProfile = supabaseReady ? profile : {
    id: 'dev-user-id',
    username: 'Dev Administrator',
    email: 'dev@example.com',
    avatar_url: null,
    role: devRole,
  };

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

  const experimentalMode = import.meta.env.VITE_EXPERIMENTAL_MODE === 'true';
  const [devLoading, setDevLoading] = useState(false);

  const handleDevSignIn = async () => {
    setDevLoading(true);
    try {
      await onDevSignIn();
    } catch (e) {
      alert('Dev login failed: ' + e.message);
    } finally {
      setDevLoading(false);
    }
  };

  if (supabaseReady && !activeProfile) {
    return (
      <div className="flex items-center gap-2 shrink-0">
        <button onClick={onSignIn}
                type="button"
                className="text-xs px-3 py-1.5 font-bold rounded-lg bg-[#5865F2] text-white hover:bg-[#4752c4] flex items-center gap-2">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z"/></svg>
          Sign in with Discord
        </button>
        {experimentalMode && (
          <button onClick={handleDevSignIn}
                  type="button"
                  disabled={devLoading}
                  className="text-xs px-3 py-1.5 font-bold rounded-lg bg-amber-500 text-white hover:bg-amber-600 flex items-center gap-1.5 disabled:opacity-60">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4zm0 4l5 2.18V11c0 3.5-2.33 6.79-5 7.93-2.67-1.14-5-4.43-5-7.93V7.18L12 5z"/></svg>
            {devLoading ? 'Loading…' : 'Dev Access'}
          </button>
        )}
      </div>
    );
  }

  const roleColors = {
    owner: 'bg-amber-500 text-amber-50 border-amber-600',
    admin: 'bg-indigo-500 text-indigo-50 border-indigo-600',
    reviewer: 'bg-emerald-500 text-emerald-50 border-emerald-600',
    staff: 'bg-emerald-500 text-emerald-50 border-emerald-600',
    grader: 'bg-teal-500 text-teal-50 border-teal-600',
    oc_staff: 'bg-teal-500 text-teal-50 border-teal-600',
    user:  'bg-slate-600 text-slate-50 border-slate-700',
  };

  return (
    <div className="relative shrink-0" ref={menuRef}>
      <button onClick={() => setOpen(!open)}
              type="button"
              className="flex items-center gap-2 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-lg p-1 pr-2.5 transition-colors">
        <ProfileAvatar profile={activeProfile} className="w-6 h-6 rounded-md" />
        <span className={`text-[10px] font-bold uppercase px-1.5 py-0.5 rounded border ${roleColors[activeProfile.role] || roleColors.user}`}>
          {['staff', 'reviewer'].includes(activeProfile.role) ? 'Reviewer' : ['oc_staff', 'grader'].includes(activeProfile.role) ? 'Grader' : activeProfile.role === 'owner' ? 'Operator' : activeProfile.role}
        </span>
        <Icon n="Down" size={12} className="text-slate-400" />
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-64 max-w-[calc(100vw-1rem)] bg-white rounded-xl shadow-xl border border-slate-200 z-40 overflow-hidden">
          <div className="p-4 border-b border-slate-100 flex items-center gap-3">
            <ProfileAvatar profile={activeProfile} className="w-10 h-10 rounded-lg" />
            <div className="flex-1 min-w-0">
              <div className="text-sm font-bold text-slate-800 truncate">
                {activeProfile.site_nickname || activeProfile.username || 'No name'}
              </div>
              {activeProfile.site_nickname && (
                <div className="text-[10px] text-slate-400 truncate">@{activeProfile.username}</div>
              )}
            </div>
          </div>

          {/* Site Nickname — grader / reviewer / admin / owner only */}
          {supabaseReady && profile && ['grader', 'reviewer', 'admin', 'owner'].includes(profile.role) && (
            <div className="border-b border-slate-100 px-4 py-3">
              <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">Site Nickname</div>
              {!nicknameEditing ? (
                <div className="flex items-center gap-2">
                  <span className="flex-1 text-xs text-slate-700 truncate">
                    {profile.site_nickname || <span className="text-slate-400 italic">Not set</span>}
                  </span>
                  <button
                    type="button"
                    onClick={() => { setNicknameInput(profile.site_nickname || ''); setNicknameEditing(true); setNicknameMsg(''); }}
                    className="text-[10px] font-bold text-indigo-600 hover:text-indigo-800 px-2 py-1 rounded hover:bg-indigo-50 shrink-0"
                  >Edit</button>
                </div>
              ) : (
                <div className="flex flex-col gap-1.5">
                  <input
                    type="text"
                    value={nicknameInput}
                    onChange={e => setNicknameInput(e.target.value)}
                    maxLength={32}
                    placeholder="Enter nickname…"
                    autoFocus
                    className="w-full border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs focus:outline-none focus:border-indigo-400 text-slate-800"
                    onKeyDown={e => { if (e.key === 'Escape') setNicknameEditing(false); }}
                  />
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <button
                      type="button"
                      disabled={nicknameSaving}
                      onClick={async () => {
                        setNicknameSaving(true);
                        try {
                          const updated = await updateMySiteNickname(nicknameInput);
                          onProfileUpdate(updated);
                          setNicknameMsg('Saved!');
                          setNicknameEditing(false);
                        } catch (err) {
                          setNicknameMsg(err.message || 'Failed to save');
                        } finally { setNicknameSaving(false); }
                      }}
                      className="text-[10px] font-bold bg-indigo-600 text-white px-2.5 py-1 rounded hover:bg-indigo-700 disabled:opacity-60"
                    >{nicknameSaving ? 'Saving…' : 'Save'}</button>
                    <button
                      type="button"
                      onClick={() => { setNicknameEditing(false); setNicknameMsg(''); }}
                      className="text-[10px] font-bold text-slate-500 px-2 py-1 rounded hover:bg-slate-100"
                    >Cancel</button>
                    {profile.site_nickname && (
                      <button
                        type="button"
                        disabled={nicknameSaving}
                        onClick={async () => {
                          setNicknameSaving(true);
                          try {
                            const updated = await updateMySiteNickname('');
                            onProfileUpdate(updated);
                            setNicknameEditing(false);
                          } catch (err) { setNicknameMsg(err.message || 'Failed'); }
                          finally { setNicknameSaving(false); }
                        }}
                        className="text-[10px] font-bold text-rose-500 hover:text-rose-700 px-2 py-1 rounded hover:bg-rose-50 ml-auto"
                      >Clear</button>
                    )}
                  </div>
                  {nicknameMsg && <p className="text-[10px] text-indigo-600">{nicknameMsg}</p>}
                </div>
              )}
            </div>
          )}

          {profile?.role === 'owner' && (
            <div className="px-4 py-3 border-b border-slate-100 bg-amber-50">
              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest block mb-1.5">Preview as</label>
              <select
                value={viewAsRole || profile.role}
                onChange={e => onSetViewAsRole(e.target.value === profile.role ? null : e.target.value)}
                className="w-full text-xs border border-slate-300 bg-white rounded px-2 py-1 text-slate-800 focus:outline-none focus:border-amber-400"
              >
                <option value="owner">Operator (default)</option>
                <option value="admin">Admin</option>
                <option value="reviewer">Reviewer</option>
                <option value="grader">Grader</option>
                <option value="user">User</option>
              </select>
            </div>
          )}
          {!supabaseReady && (
            <div className="border-t border-slate-100 p-3 bg-slate-50">
              <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2 flex items-center gap-1.5">
                <Icon n="Key" size={10} className="text-indigo-400"/> Dev · Role
              </div>
              <div className="flex flex-wrap gap-1">
                {['user', 'grader', 'reviewer', 'admin', 'owner'].map(r => (
                  <button key={r} type="button"
                    onClick={() => onToggleDevRole(r)}
                    className={`text-xs px-2.5 py-1 rounded-lg font-bold border transition-colors ${
                      devRole === r
                        ? 'bg-indigo-600 text-white border-indigo-600'
                        : 'text-slate-600 border-slate-200 bg-white hover:bg-slate-100'
                    }`}>
                    {r === 'owner' ? 'Operator' : r}
                  </button>
                ))}
              </div>
            </div>
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

/* ============================================================================
   MODAL: CatalogManagementModal
   ============================================================================ */

export default UserMenu;
