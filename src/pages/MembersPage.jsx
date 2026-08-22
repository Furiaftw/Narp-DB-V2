import { Icon } from '../components/ui/Icon';
import { maskEmail, getNetlifyImageUrl, getNetlifyImageSrcSet } from '../utils/helpers';

/* ============================================================================
   MEMBERS PAGE  (route: /members, admin+)
   The member board: role changes, wanderer tickets, and the ban/remove
   moderation controls. Admins can only move users between
   user/grader/reviewer; only the owner manages admins.
   ============================================================================ */

export default function MembersPage({
  profilesList, profilesLoading, loadProfiles, profile, isAdmin, isOwner,
  handleRoleChange, handleGrantWandererTicket, handleRemoveMember,
  handleBanMember, handleUnbanMember,
}) {
  return (
      <div className="max-w-6xl mx-auto">
        <div className="bg-white rounded-3xl border border-slate-200 shadow-xs overflow-hidden">
          <div className="bg-slate-900 text-white p-5 flex justify-between items-center shrink-0">
            <div className="flex items-center gap-2">
              <Icon n="User" size={20} className="text-indigo-400" />
              <h3 className="font-bold text-lg font-serif">Member Board</h3>
              <span className="text-[10px] uppercase font-bold text-slate-400 bg-slate-800 border border-slate-700 px-2 py-0.5 rounded">
                {profilesList.length} Total
              </span>
            </div>
            <button
              onClick={loadProfiles}
              disabled={profilesLoading}
              className="bg-indigo-600 hover:bg-indigo-700 text-white px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 disabled:opacity-50"
            >
              <Icon n="Refresh" size={12} className={profilesLoading ? "animate-spin" : ""} />
              Refresh
            </button>
          </div>

          <div className="p-6">
            {profilesLoading && profilesList.length === 0 ? (
              <div className="text-center py-16 text-slate-400 text-sm font-semibold">Loading members...</div>
            ) : profilesList.length === 0 ? (
              <div className="text-center py-16 text-slate-400 text-sm font-semibold">No members found.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 text-xs font-bold text-slate-400 uppercase tracking-wider">
                      <th className="py-3 px-4">Member</th>
                      <th className="py-3 px-4">Discord User ID</th>
                      <th className="py-3 px-4">Joined At</th>
                      <th className="py-3 px-4">Wanderer Ticket</th>
                      <th className="py-3 px-4 text-right">Role</th>
                      <th className="py-3 px-4 text-right">Moderation</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {profilesList.map((m) => {
                      const isCurrentUser = m.id === profile?.id;
                      const canModerate = isAdmin && !isCurrentUser && m.role !== 'owner' && (isOwner || m.role !== 'admin');
                      return (
                        <tr key={m.id} className="hover:bg-slate-50/50 transition-colors">
                          <td className="py-3 px-4 flex items-center gap-3">
                            {m.avatar_url ? (
                              <img
                                src={getNetlifyImageUrl(m.avatar_url, 32)}
                                srcSet={getNetlifyImageSrcSet(m.avatar_url)}
                                alt={m.username}
                                className="w-8 h-8 rounded-full object-cover border border-slate-200"
                                width={32}
                                height={32}
                                loading="lazy"
                              />
                            ) : (
                              <div className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center border border-slate-200 text-xs font-bold text-slate-500">
                                {m.username ? m.username.slice(0, 2).toUpperCase() : '??'}
                              </div>
                            )}
                            <div>
                              <div className="font-bold text-slate-800 flex items-center gap-1.5">
                                {m.username || 'Unknown'}
                                {isCurrentUser && (
                                  <span className="text-[10px] font-extrabold uppercase bg-indigo-50 text-indigo-600 border border-indigo-200 px-1.5 py-0.5 rounded-sm">
                                    You
                                  </span>
                                )}
                              </div>
                              <div className="text-xs text-slate-400 font-mono truncate max-w-[200px]">{isOwner ? m.email : maskEmail(m.email)}</div>
                            </div>
                          </td>
                          <td className="py-3 px-4 text-slate-500 font-mono text-xs">
                            {m.discord_id || '—'}
                          </td>
                          <td className="py-3 px-4 text-slate-500 text-xs">
                            {m.created_at ? new Date(m.created_at).toLocaleDateString() : '—'}
                          </td>
                          <td className="py-3 px-4">
                            {m.wanderer_ticket ? (
                              <span className="text-[10px] font-extrabold uppercase tracking-wider px-2 py-1 rounded border bg-amber-100 text-amber-700 border-amber-200">
                                Ticket Active
                              </span>
                            ) : (
                              <button
                                type="button"
                                onClick={() => handleGrantWandererTicket(m.id, m.username)}
                                className="border border-slate-200 hover:border-slate-300 rounded-lg px-2.5 py-1.5 text-xs font-bold text-slate-700 bg-white shadow-xs transition-all"
                              >
                                Grant Ticket
                              </button>
                            )}
                          </td>
                          <td className="py-3 px-4 text-right">
                            <select
                              value={m.role === 'owner' ? 'admin' : (m.role || 'user')}
                              disabled={isCurrentUser || m.role === 'owner'}
                              onChange={(e) => handleRoleChange(m.id, e.target.value)}
                              className="border border-slate-200 hover:border-slate-300 rounded-lg px-2.5 py-1.5 text-xs font-bold text-slate-700 bg-white shadow-xs focus:outline-hidden focus:ring-2 focus:ring-indigo-500 disabled:opacity-50 disabled:bg-slate-50 disabled:cursor-not-allowed cursor-pointer transition-all"
                            >
                              <option value="user">User</option>
                              <option value="grader">Grader</option>
                              <option value="reviewer">Reviewer</option>
                              <option value="admin">Admin</option>
                            </select>
                          </td>
                          <td className="py-3 px-4 text-right">
                            {m.banned_at && (
                              <span className="inline-block mb-1 text-[10px] font-extrabold uppercase tracking-wider px-2 py-1 rounded border bg-red-100 text-red-700 border-red-200">
                                Banned
                              </span>
                            )}
                            {canModerate ? (
                              <div className="flex items-center justify-end gap-1.5">
                                {m.banned_at ? (
                                  <button
                                    type="button"
                                    onClick={() => handleUnbanMember(m.id, m.username)}
                                    className="border border-slate-200 hover:border-slate-300 rounded-lg px-2.5 py-1.5 text-xs font-bold text-slate-700 bg-white shadow-xs transition-all"
                                  >
                                    Unban
                                  </button>
                                ) : (
                                  <button
                                    type="button"
                                    onClick={() => handleBanMember(m.id, m.username)}
                                    className="border border-amber-200 hover:border-amber-300 rounded-lg px-2.5 py-1.5 text-xs font-bold text-amber-700 bg-amber-50 shadow-xs transition-all"
                                  >
                                    Ban
                                  </button>
                                )}
                                <button
                                  type="button"
                                  onClick={() => handleRemoveMember(m.id, m.username)}
                                  className="border border-red-200 hover:border-red-300 rounded-lg px-2.5 py-1.5 text-xs font-bold text-red-700 bg-red-50 shadow-xs transition-all"
                                >
                                  Remove
                                </button>
                              </div>
                            ) : (!m.banned_at && <span className="text-slate-300 text-xs">—</span>)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>
  );
}
