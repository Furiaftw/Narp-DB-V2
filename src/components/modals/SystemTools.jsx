import { useState, useEffect } from 'react';
import { NavLink } from 'react-router-dom';
import { Icon } from '../ui/Icon';
import ProfileAvatar from '../ui/ProfileAvatar';
import { formatBytes } from '../../utils/helpers';
import {
  isSupabaseConfigured,
  fetchStorageStats,
  setSpecializations as saveSpecializationsToSupabase,
  setJutsuTypeTags as saveJutsuTypeTagsToSupabase,
  updateSubmissionControl,
} from '../../lib/supabase';

/* ============================================================================
   MODAL: SystemToolsModal
   Owner/admin control panel: submission gates, the Discord notification mute,
   webhook thread IDs, catalog management and the storage calculator.
   ============================================================================ */

export const SUBMISSION_GATE_TYPES = [
  { key: 'jutsu_paused',       label: 'Jutsu / Battlemode', color: 'slate'   },
  { key: 'character_paused',   label: 'OC Submission',      color: 'emerald' },
  { key: 'custom_item_paused', label: 'Custom Item',        color: 'red'     },
  { key: 'summon_paused',      label: 'Summon',             color: 'amber'   },
];
export const SUBMISSION_GATE_LABELS = Object.fromEntries(SUBMISSION_GATE_TYPES.map(({ key, label }) => [key, label]));

export function SystemToolsModal({ db, setDb, onClose, onRefresh, refreshing, onManageBL, isOwner, isAdmin, isReviewer, webhookConfig = {}, onWebhookConfigSave, submissionControls, onToggleSubmission, currentUserId, profile, onProfileUpdate }) {
  const [msg, setMsg]         = useState('');
  const [newSpec, setNewSpec] = useState('');
  const [pendingDel, setPendingDel] = useState(null);
  const [newTtag, setNewTtag] = useState('');
  const [pendingDelTtag, setPendingDelTtag] = useState(null);
  const [togglePending, setTogglePending] = useState({});
  const [storageStats, setStorageStats] = useState(null);
  const [storageLoading, setStorageLoading] = useState(false);
  const [storageError, setStorageError] = useState('');

  const loadStorageStats = async () => {
    setStorageLoading(true);
    setStorageError('');
    try {
      setStorageStats(await fetchStorageStats());
    } catch (e) {
      setStorageError(e.message || 'Failed to calculate storage.');
    } finally {
      setStorageLoading(false);
    }
  };

  const handleToggle = async (key) => {
    if (!isOwner || !isSupabaseConfigured()) return;
    const newVal = !(submissionControls?.[key]);
    setTogglePending(p => ({ ...p, [key]: true }));
    try {
      await updateSubmissionControl(key, newVal, currentUserId);
      onToggleSubmission(key, newVal);
      const label = SUBMISSION_GATE_LABELS[key] || key;
      setMsg(`${label} submissions ${newVal ? 'paused' : 'reopened'}.`);
    } catch (e) {
      setMsg('Failed to update: ' + (e.message || 'unknown error'));
    } finally {
      setTogglePending(p => ({ ...p, [key]: false }));
    }
  };

  const addSpec = () => {
    const v = newSpec.trim();
    if (!v) return;
    if (db.specializations.includes(v)) { setMsg(`'${v}' is already in the list.`); return; }
    setDb(d => {
      const next = [...d.specializations, v];
      if (isSupabaseConfigured()) saveSpecializationsToSupabase(next).catch(e => console.warn('[NARP] save specs failed:', e));
      return { ...d, specializations: next };
    });
    setNewSpec('');
    setMsg(`Added '${v}'.`);
  };

  const confirmDelSpec = () => {
    if (!pendingDel) return;
    setDb(d => {
      const next = d.specializations.filter(x => x !== pendingDel);
      if (isSupabaseConfigured()) saveSpecializationsToSupabase(next).catch(e => console.warn('[NARP] save specs failed:', e));
      return { ...d, specializations: next };
    });
    setMsg(`Removed '${pendingDel}'.`);
    setPendingDel(null);
  };

  const addTtag = () => {
    const v = newTtag.trim();
    if (!v) return;
    if (db.jutsuTypeTags.includes(v)) { setMsg(`'${v}' is already in the list.`); return; }
    setDb(d => {
      const next = [...d.jutsuTypeTags, v];
      if (isSupabaseConfigured()) saveJutsuTypeTagsToSupabase(next).catch(e => console.warn('[NARP] save jutsu type tags failed:', e));
      return { ...d, jutsuTypeTags: next };
    });
    setNewTtag('');
    setMsg(`Added '${v}'.`);
  };

  const confirmDelTtag = () => {
    if (!pendingDelTtag) return;
    setDb(d => {
      const next = d.jutsuTypeTags.filter(x => x !== pendingDelTtag);
      if (isSupabaseConfigured()) saveJutsuTypeTagsToSupabase(next).catch(e => console.warn('[NARP] save jutsu type tags failed:', e));
      return { ...d, jutsuTypeTags: next };
    });
    setMsg(`Removed '${pendingDelTtag}'.`);
    setPendingDelTtag(null);
  };

  const exportJson = () => {
    const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(db, null, 2));
    const a = document.createElement('a');
    a.href = dataStr;
    a.download = 'sarp_database_backup.json';
    a.click();
    setMsg('JSON Exported Successfully');
  };

  // Snapshot the live DOM (what's actually rendered right now, not the
  // server-shell index.html) with every stylesheet inlined, so the file
  // renders standalone — handy for handing the current design to another AI.
  // Scripts are stripped: this is a static visual snapshot, not a working
  // copy of the app.
  const exportHtmlDesign = async () => {
    setMsg('Preparing HTML export...');
    try {
      const styleLinks = Array.from(document.querySelectorAll('link[rel="stylesheet"]'));
      const cssChunks = await Promise.all(styleLinks.map(async (link) => {
        try {
          const res = await fetch(link.href);
          if (!res.ok) return '';
          return `/* ${link.href} */\n${await res.text()}`;
        } catch {
          return '';
        }
      }));

      const clone = document.documentElement.cloneNode(true);
      clone.querySelectorAll('script').forEach(el => el.remove());
      clone.querySelectorAll('link[rel="stylesheet"]').forEach(el => el.remove());
      clone.querySelectorAll('[src], [href]').forEach(el => {
        for (const attr of ['src', 'href']) {
          const v = el.getAttribute(attr);
          if (v && v.startsWith('/') && !v.startsWith('//')) {
            el.setAttribute(attr, window.location.origin + v);
          }
        }
      });

      const head = clone.querySelector('head');
      if (head) head.insertAdjacentHTML('beforeend', `<style>\n${cssChunks.join('\n\n')}\n</style>`);

      const html = '<!doctype html>\n'
        + `<!-- Static design export of ${window.location.href} — captured ${new Date().toISOString()}. `
        + `Snapshot only, not a working app: scripts are stripped. -->\n`
        + clone.outerHTML;

      const blob = new Blob([html], { type: 'text/html' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `narp-design-export-${new Date().toISOString().slice(0, 10)}.html`;
      a.click();
      URL.revokeObjectURL(url);
      setMsg('HTML design exported.');
    } catch (e) {
      setMsg('HTML export failed: ' + (e.message || 'unknown error'));
    }
  };

  const handleSync = async () => {
    setMsg('Syncing...');
    try {
      await onRefresh();
      setMsg('Database synced.');
    } catch (e) {
      setMsg('Sync failed: ' + (e.message || 'unknown error'));
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4 animate-in fade-in" onClick={onClose}>
      <div className="bg-white rounded-3xl max-w-3xl w-full overflow-hidden max-h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="bg-slate-900 text-white p-5 flex justify-between shrink-0">
          <div className="flex items-center gap-2">
            <Icon n="Shield" size={20} className="text-indigo-400" />
            <h3 className="font-bold text-lg">System Tools</h3>
          </div>
          <button onClick={onClose}><Icon n="X" size={18} /></button>
        </div>

        <div className="p-8 overflow-y-auto">
          {msg && (
            <div className="mb-6 p-4 rounded-xl text-sm bg-indigo-50 text-indigo-800 border border-indigo-200 font-bold flex items-center justify-center">
              {msg}
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Storage Calculator */}
            {isAdmin && (
              <div className="bg-slate-50 rounded-2xl border p-6 md:col-span-2">
                <h3 className="text-lg font-bold mb-2 flex items-center gap-2">
                  <Icon n="Database" size={20} className="text-indigo-500" /> Storage Calculator
                </h3>
                <p className="text-xs text-slate-500 mb-4">How much data the Jutsu/Battlemode catalog, Bloodlines, and Roster are actually using.</p>
                <button onClick={loadStorageStats} disabled={storageLoading}
                        className="bg-indigo-600 text-white py-2.5 px-4 rounded-xl font-bold text-sm flex items-center gap-2 hover:bg-indigo-700 disabled:opacity-50">
                  <Icon n="Refresh" size={14} className={storageLoading ? 'animate-spin' : ''} /> {storageStats ? 'Refresh' : 'Calculate'}
                </button>
                {storageError && <p className="text-xs text-rose-600 mt-3 font-semibold">{storageError}</p>}
                {storageStats && (
                  <div className="mt-4 overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="text-left text-slate-400 uppercase text-[10px] font-bold border-b border-slate-200">
                          <th className="py-2 pr-4">Category</th>
                          <th className="py-2 pr-4 text-right">Rows</th>
                          <th className="py-2 pr-4 text-right">Data size</th>
                          <th className="py-2 text-right">On disk (table + indexes)</th>
                        </tr>
                      </thead>
                      <tbody>
                        {storageStats.map(row => (
                          <tr key={row.category} className="border-b border-slate-200 last:border-0">
                            <td className="py-2 pr-4 font-semibold text-slate-700">{row.category}</td>
                            <td className="py-2 pr-4 text-right tabular-nums text-slate-500">{row.row_count}</td>
                            <td className="py-2 pr-4 text-right tabular-nums text-slate-700">{row.data_bytes != null ? formatBytes(row.data_bytes) : '—'}</td>
                            <td className="py-2 text-right tabular-nums text-slate-700">{row.table_bytes != null ? formatBytes(row.table_bytes) : '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <p className="text-[10px] text-slate-400 mt-2 leading-relaxed">
                      "Data size" sums each row's own content (name, description, stats, etc.) — Jutsu and Battlemode are split out of the same table. "On disk" is the full Postgres table size, indexes included, which is why it doesn't match the data size exactly.
                    </p>
                  </div>
                )}
              </div>
            )}

            {/* Audit Log */}
            <div className="bg-slate-50 rounded-2xl border p-6">
              <h3 className="text-lg font-bold mb-2 flex items-center gap-2">
                <Icon n="Clock" size={20} className="text-amber-500" /> Audit Log
              </h3>
              <p className="text-xs text-slate-500 mb-6">View the history of role changes — who promoted or demoted whom, and when.</p>
              <NavLink to="/history/audit-log" onClick={onClose}
                       className="w-full bg-slate-800 text-white py-3 rounded-xl font-bold flex justify-center gap-2 hover:bg-slate-900">
                <Icon n="Eye" size={16}/> View log
              </NavLink>
            </div>

            {/* Manage Bloodlines */}
            <div className="bg-slate-50 rounded-2xl border p-6">
              <h3 className="text-lg font-bold mb-2 flex items-center gap-2">
                <Icon n="Book" size={20} className="text-red-600" /> Bloodlines
              </h3>
              <p className="text-xs text-slate-500 mb-6">Add, edit, and remove bloodlines. These populate the bloodline filter dropdown but no longer have a public browse tab.</p>
              <button onClick={onManageBL}
                      className="w-full bg-red-700 text-white py-3 rounded-xl font-bold flex justify-center gap-2 hover:bg-red-800">
                <Icon n="Edit" size={16}/> Manage Bloodlines ({(db.bloodlines || []).length})
              </button>
            </div>

            {/* Export */}
            <div className="bg-slate-50 rounded-2xl border p-6">
              <h3 className="text-lg font-bold mb-2 flex items-center gap-2">
                <Icon n="Download" size={20} className="text-emerald-500" /> Export
              </h3>
              <p className="text-xs text-slate-500 mb-6">Download a backup copy of all jutsu and bloodline entries for your records.</p>
              <div className="flex gap-3">
                <button onClick={exportJson}
                        className="flex-1 bg-slate-800 text-white py-3 rounded-xl font-bold flex justify-center gap-2 hover:bg-slate-900">
                  <Icon n="Download" size={16}/> JSON
                </button>
                <button onClick={() => setMsg('CSV export coming soon.')}
                        className="flex-1 bg-emerald-600 text-white py-3 rounded-xl font-bold flex justify-center gap-2 hover:bg-emerald-700">
                  <Icon n="Download" size={16}/> CSV
                </button>
              </div>
            </div>

            {/* Export Site Design (HTML) — owner only */}
            {isOwner && (
              <div className="bg-slate-50 rounded-2xl border p-6">
                <h3 className="text-lg font-bold mb-1 flex items-center gap-2">
                  <Icon n="Book" size={20} className="text-violet-500" /> Export Site Design
                  <span className="ml-auto text-[10px] font-bold uppercase tracking-wider bg-amber-100 text-amber-700 border border-amber-300 px-2 py-0.5 rounded">Operator only</span>
                </h3>
                <p className="text-xs text-slate-500 mb-6">
                  Download the current page as a self-contained HTML file — live markup with every stylesheet inlined, no scripts. Handy for handing the design to another AI.
                </p>
                <button onClick={exportHtmlDesign}
                        className="w-full bg-violet-600 text-white py-3 rounded-xl font-bold flex justify-center gap-2 hover:bg-violet-700">
                  <Icon n="Download" size={16}/> Download HTML
                </button>
              </div>
            )}

            {/* Submission Gates — owner only */}
            {isOwner && (
              <div className="bg-slate-50 rounded-2xl border p-6 md:col-span-2">
                <h3 className="text-lg font-bold mb-1 flex items-center gap-2">
                  <Icon n="Lock" size={20} className="text-rose-500" /> Submission Gates
                  <span className="ml-auto text-[10px] font-bold uppercase tracking-wider bg-amber-100 text-amber-700 border border-amber-300 px-2 py-0.5 rounded">Operator only</span>
                </h3>
                <p className="text-xs text-slate-500 mb-5">Temporarily pause or reopen submission creation per entry type. When paused, users see a notice and the form is blocked.</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                  {SUBMISSION_GATE_TYPES.map(({ key, label, color }) => {
                    const paused  = !!(submissionControls?.[key]);
                    const pending = !!togglePending[key];
                    const trackOn  = { slate: 'bg-slate-700', red: 'bg-red-700', amber: 'bg-amber-500', emerald: 'bg-emerald-600' }[color];
                    return (
                      <div key={key} className={`flex items-center justify-between p-4 rounded-xl border-2 transition-colors ${paused ? 'border-rose-200 bg-rose-50' : 'border-slate-200 bg-white'}`}>
                        <div>
                          <div className="text-sm font-bold text-slate-800">{label}</div>
                          <div className={`text-xs font-semibold mt-0.5 ${paused ? 'text-rose-600' : 'text-emerald-600'}`}>
                            {paused ? 'Paused' : 'Open'}
                          </div>
                        </div>
                        <button
                          onClick={() => handleToggle(key)}
                          disabled={pending}
                          title={paused ? 'Reopen submissions' : 'Pause submissions'}
                          className={`relative w-12 h-6 rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-offset-1 ${paused ? 'bg-rose-500 focus:ring-rose-300' : `${trackOn} focus:ring-slate-400`} disabled:opacity-50 shrink-0`}
                        >
                          <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${paused ? 'translate-x-0' : 'translate-x-6'}`} />
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Discord Notifications Mute — owner only */}
            {isOwner && (
              <div className="bg-slate-50 rounded-2xl border p-6 md:col-span-2">
                <h3 className="text-lg font-bold mb-1 flex items-center gap-2">
                  <Icon n="Alert" size={20} className="text-rose-500" /> Discord Notifications
                  <span className="ml-auto text-[10px] font-bold uppercase tracking-wider bg-amber-100 text-amber-700 border border-amber-300 px-2 py-0.5 rounded">Operator only</span>
                </h3>
                <p className="text-xs text-slate-500 mb-5">
                  Temporarily mute every outbound Discord message tied to submissions — new-submission alerts, the second-reviewer-needed ping, the reviewer nudge DM, and the approval/denial log post. Everything still works normally in the app; Discord just stays quiet.
                </p>
                {(() => {
                  const key = 'discord_notifications_paused';
                  const paused  = !!(submissionControls?.[key]);
                  const pending = !!togglePending[key];
                  return (
                    <div className={`flex items-center justify-between p-4 rounded-xl border-2 transition-colors max-w-sm ${paused ? 'border-rose-200 bg-rose-50' : 'border-slate-200 bg-white'}`}>
                      <div>
                        <div className="text-sm font-bold text-slate-800">All Discord Notifications</div>
                        <div className={`text-xs font-semibold mt-0.5 ${paused ? 'text-rose-600' : 'text-emerald-600'}`}>
                          {paused ? 'Muted' : 'Active'}
                        </div>
                      </div>
                      <button
                        onClick={() => handleToggle(key)}
                        disabled={pending}
                        title={paused ? 'Unmute Discord notifications' : 'Mute Discord notifications'}
                        className={`relative w-12 h-6 rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-offset-1 ${paused ? 'bg-rose-500 focus:ring-rose-300' : 'bg-slate-700 focus:ring-slate-400'} disabled:opacity-50 shrink-0`}
                      >
                        <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${paused ? 'translate-x-0' : 'translate-x-6'}`} />
                      </button>
                    </div>
                  );
                })()}
              </div>
            )}

            {/* Manage Specializations */}
            <div className="bg-slate-50 rounded-2xl border p-6 md:col-span-2">
              <h3 className="text-lg font-bold mb-2 flex items-center gap-2">
                <Icon n="Tag" size={20} className="text-indigo-500" /> Manage Specializations
              </h3>
              <p className="text-xs text-slate-500 mb-4">Add or permanently remove tags from the Specializations list.</p>
              <div className="flex flex-wrap gap-2 mb-4">
                {(db.specializations || []).map(s => (
                  <span key={s} className="bg-white border rounded-lg px-3 py-1.5 text-sm font-semibold flex items-center gap-2 shadow-sm">
                    {s}
                    <button onClick={() => setPendingDel(s)} className="text-red-400 hover:text-red-600">
                      <Icon n="X" size={14}/>
                    </button>
                  </span>
                ))}
              </div>
              <div className="flex gap-2">
                <input value={newSpec} onChange={e => setNewSpec(e.target.value)}
                       onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addSpec(); } }}
                       placeholder="New specialization..."
                       className="flex-1 border rounded-xl px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500" />
                <button onClick={addSpec} className="bg-indigo-600 hover:bg-indigo-700 text-white px-6 py-2 rounded-xl font-bold transition-colors">
                  Add
                </button>
              </div>
            </div>

            {/* Manage Jutsu Type Tags */}
            <div className="bg-slate-50 rounded-2xl border p-6 md:col-span-2">
              <h3 className="text-lg font-bold mb-2 flex items-center gap-2">
                <Icon n="Tag" size={20} className="text-sky-500" /> Manage Jutsu Type Tags
              </h3>
              <p className="text-xs text-slate-500 mb-4">Add or permanently remove tags from the Jutsu Type list (Offensive, Defensive, Mobility, etc.).</p>
              <div className="flex flex-wrap gap-2 mb-4">
                {(db.jutsuTypeTags || []).map(s => (
                  <span key={s} className="bg-white border rounded-lg px-3 py-1.5 text-sm font-semibold flex items-center gap-2 shadow-sm">
                    {s}
                    <button onClick={() => setPendingDelTtag(s)} className="text-red-400 hover:text-red-600">
                      <Icon n="X" size={14}/>
                    </button>
                  </span>
                ))}
              </div>
              <div className="flex gap-2">
                <input value={newTtag} onChange={e => setNewTtag(e.target.value)}
                       onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addTtag(); } }}
                       placeholder="New jutsu type tag..."
                       className="flex-1 border rounded-xl px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500" />
                <button onClick={addTtag} className="bg-sky-600 hover:bg-sky-700 text-white px-6 py-2 rounded-xl font-bold transition-colors">
                  Add
                </button>
              </div>
            </div>

            {/* Webhook Config — owner only */}
            {isOwner && (
              <div className="bg-slate-50 rounded-2xl border p-6 md:col-span-2">
                <h3 className="text-lg font-bold mb-1 flex items-center gap-2">
                  <Icon n="MessageSquare" size={20} className="text-violet-500" /> Discord Notification Config
                  <span className="ml-auto text-[10px] font-bold uppercase tracking-wider bg-amber-100 text-amber-700 border border-amber-300 px-2 py-0.5 rounded">Operator only</span>
                </h3>
                <p className="text-xs text-slate-500 mb-5">Configure where Discord notifications are sent. Webhook URLs remain in Netlify env vars (they contain auth tokens).</p>
                <div className="space-y-3">
                  {[
                    { key: 'discord_guild_id',            label: 'Guild ID',             placeholder: '12345678901234567' },
                    { key: 'discord_ping_thread_id',      label: 'Reviewer Ping Thread', placeholder: 'Thread ID (17-20 digits)' },
                    { key: 'discord_reviewer_role_id',    label: 'Reviewer Role ID',     placeholder: 'Discord role snowflake' },
                    { key: 'discord_admin_role_id',       label: 'Admin Role ID',        placeholder: 'Discord role snowflake' },
                    { key: 'discord_oc_staff_role_id',    label: 'Staff (OC) Role ID',   placeholder: 'Discord role snowflake' },
                  ].map(({ key, label, placeholder }) => (
                    <WebhookConfigRow
                      key={key}
                      label={label}
                      placeholder={placeholder}
                      initialValue={webhookConfig[key] || ''}
                      onSave={(value) => onWebhookConfigSave(key, value)}
                    />
                  ))}
                </div>
                <p className="text-[10px] text-slate-400 mt-4">Changes take effect immediately — no redeploy needed.</p>
              </div>
            )}
          </div>
        </div>

        {/* Confirm-delete sub-modal for specializations */}
        {pendingDel && (
          <div className="fixed inset-0 z-[110] bg-black/60 flex items-center justify-center p-4" onClick={() => setPendingDel(null)}>
            <div className="bg-white p-6 rounded-3xl max-w-sm w-full" onClick={e => e.stopPropagation()}>
              <h3 className="font-bold text-xl mb-2 text-slate-900">Remove specialization?</h3>
              <p className="text-sm text-slate-600 mb-6">Remove '{pendingDel}' from the global list? Existing jutsus that already use it will keep the value.</p>
              <div className="flex gap-3">
                <button onClick={() => setPendingDel(null)} className="flex-1 px-4 py-3 bg-slate-100 text-slate-700 font-bold rounded-xl hover:bg-slate-200">Cancel</button>
                <button onClick={confirmDelSpec}            className="flex-1 px-4 py-3 bg-red-600 text-white font-bold rounded-xl hover:bg-red-700 shadow-md">Remove</button>
              </div>
            </div>
          </div>
        )}

        {/* Confirm-delete sub-modal for jutsu type tags */}
        {pendingDelTtag && (
          <div className="fixed inset-0 z-[110] bg-black/60 flex items-center justify-center p-4" onClick={() => setPendingDelTtag(null)}>
            <div className="bg-white p-6 rounded-3xl max-w-sm w-full" onClick={e => e.stopPropagation()}>
              <h3 className="font-bold text-xl mb-2 text-slate-900">Remove jutsu type tag?</h3>
              <p className="text-sm text-slate-600 mb-6">Remove '{pendingDelTtag}' from the global list? Existing jutsus that already use it will keep the value.</p>
              <div className="flex gap-3">
                <button onClick={() => setPendingDelTtag(null)} className="flex-1 px-4 py-3 bg-slate-100 text-slate-700 font-bold rounded-xl hover:bg-slate-200">Cancel</button>
                <button onClick={confirmDelTtag}                className="flex-1 px-4 py-3 bg-red-600 text-white font-bold rounded-xl hover:bg-red-700 shadow-md">Remove</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ============================================================================
   COMPONENT: WebhookConfigRow
   ============================================================================ */
export function WebhookConfigRow({ label, placeholder, initialValue, onSave }) {
  const [value, setValue] = useState(initialValue);
  const [status, setStatus] = useState('idle'); // idle | saving | success | error
  const [errMsg, setErrMsg] = useState('');

  useEffect(() => { setValue(initialValue); }, [initialValue]);

  const handleSave = async () => {
    setStatus('saving');
    setErrMsg('');
    try {
      await onSave(value.trim());
      setStatus('success');
      setTimeout(() => setStatus('idle'), 2000);
    } catch (e) {
      setErrMsg(e.message || 'Save failed');
      setStatus('error');
    }
  };

  return (
    <div className="flex flex-col sm:flex-row sm:items-center gap-1.5 sm:gap-2">
      <label className="text-xs font-bold text-slate-600 sm:w-36 sm:shrink-0">{label}</label>
      <div className="flex items-center gap-2 min-w-0">
        <input
          type="text"
          value={value}
          onChange={e => { setValue(e.target.value); setStatus('idle'); }}
          placeholder={placeholder}
          className="flex-1 min-w-0 text-xs border border-slate-200 rounded-lg px-3 py-1.5 outline-none focus:ring-2 focus:ring-violet-400 font-mono"
        />
        <button
          onClick={handleSave}
          disabled={status === 'saving'}
          className="text-[11px] px-3 py-1.5 rounded-lg bg-violet-600 hover:bg-violet-700 text-white font-bold disabled:opacity-50 shrink-0"
        >
          {status === 'saving' ? '…' : 'Save'}
        </button>
        {status === 'success' && <span className="text-emerald-600 text-[10px] font-bold shrink-0">✓</span>}
        {status === 'error'   && <span className="text-red-500 text-[10px] shrink-0" title={errMsg}>✗</span>}
      </div>
    </div>
  );
}

export default SystemToolsModal;
