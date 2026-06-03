import React, { useState, useEffect, useMemo } from 'react';
import Icon from '../ui/Icon';
import { toArray, getSlotStatus, maskEmail } from '../../utils/helpers';
import {
  fetchRoleChangeLog,
  saveSpecializationsToSupabase,
  isSupabaseConfigured
} from '../../lib/supabase';

/* ============================================================================
   MODAL: SlotsViewModal
   ============================================================================ */
export function SlotsViewModal({ jutsu, onClose }) {
  const { parsed, total } = getSlotStatus(jutsu.slots);
  const filled = parsed.filter(s => s && s.username);
  const empty  = total - filled.length;

  return (
    <div className="fixed inset-0 z-[80] bg-black/60 flex items-center justify-center p-4 animate-in fade-in" onClick={onClose}>
      <div className="bg-white rounded-3xl max-w-md w-full overflow-hidden max-h-[85vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="bg-slate-900 text-white p-5 flex justify-between items-center shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <Icon n="Eye" size={18} className="text-indigo-400 shrink-0" />
            <div className="min-w-0">
              <h3 className="font-bold text-base truncate">{jutsu.name}</h3>
              <p className="text-[10px] uppercase tracking-widest text-slate-400">Slot Holders</p>
            </div>
          </div>
          <button onClick={onClose}><Icon n="X" size={18} /></button>
        </div>

        <div className="p-5 overflow-y-auto custom-scrollbar">
          {total === 0 ? (
            <div className="text-center py-8 text-slate-400 text-sm font-semibold">No slots configured.</div>
          ) : (
            <>
              <div className="text-xs font-bold text-slate-500 mb-3 flex items-center gap-2">
                <span>{filled.length} of {total} taken</span>
                {empty > 0 && <span className="text-emerald-600">· {empty} open</span>}
              </div>
              <div className="space-y-1.5">
                {parsed.map((slot, i) => {
                  const hasName = !!(slot && slot.username);
                  const hasLink = !!(slot && slot.discord_link);
                  return (
                    <div key={i} className={`flex items-center gap-3 p-3 rounded-xl border ${hasName ? 'bg-slate-50 border-slate-200' : 'bg-white border-dashed border-slate-200'}`}>
                      <span className="text-[10px] font-bold text-slate-400 w-6 text-center shrink-0">#{i + 1}</span>
                      {hasName ? (
                        hasLink ? (
                          <a href={slot.discord_link}
                             target="_blank" rel="noopener noreferrer"
                             className="text-sm font-bold text-indigo-700 hover:text-indigo-900 hover:underline truncate flex-1 flex items-center gap-1.5">
                            {slot.username}
                            <Icon n="ExtLink" size={11} className="text-indigo-400 shrink-0" />
                          </a>
                        ) : (
                          <span className="text-sm font-bold text-slate-700 truncate flex-1">{slot.username}</span>
                        )
                      ) : (
                        <span className="text-sm italic text-slate-400 flex-1">Open slot</span>
                      )}
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/* ============================================================================
   MODAL: AuditLogModal
   ============================================================================ */
export function AuditLogModal({ onClose }) {
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const list = await fetchRoleChangeLog(200);
        if (!cancelled) setEntries(list);
      } catch (e) {
        if (!cancelled) setError(e.message || 'Failed to load audit log.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const arrow = (from, to) => {
    const colors = { user: 'text-slate-500', staff: 'text-emerald-600', admin: 'text-indigo-600', owner: 'text-amber-600' };
    return (
      <span className="text-xs font-bold">
        <span className={colors[from] || ''}>{from === 'staff' ? 'Reviewer' : (from || '∅')}</span>
        <span className="mx-1.5 text-slate-300">→</span>
        <span className={colors[to] || ''}>{to === 'staff' ? 'Reviewer' : (to || '∅')}</span>
      </span>
    );
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4 animate-in fade-in" onClick={onClose}>
      <div className="bg-white rounded-3xl max-w-2xl w-full overflow-hidden max-h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="bg-slate-900 text-white p-5 flex justify-between shrink-0">
          <div className="flex items-center gap-2">
            <Icon n="Clock" size={20} className="text-amber-400" />
            <h3 className="font-bold text-lg">Audit Log — Role Changes</h3>
          </div>
          <button onClick={onClose}><Icon n="X" size={18} /></button>
        </div>

        <div className="p-6 overflow-y-auto custom-scrollbar">
          {error && <div className="mb-4 p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-sm font-semibold">{error}</div>}
          {loading ? (
            <div className="text-center py-8 text-slate-400 text-sm font-semibold">Loading...</div>
          ) : entries.length === 0 ? (
            <div className="text-center py-8 text-slate-400 text-sm font-semibold">No role changes recorded yet.</div>
          ) : (
            <div className="space-y-1.5">
              {entries.map(e => (
                <div key={e.id} className="flex items-center gap-3 p-3 bg-slate-50 border border-slate-200 rounded-xl text-xs">
                  <div className="text-slate-400 font-mono shrink-0 w-32 truncate">{new Date(e.changed_at).toLocaleString()}</div>
                  <div className="flex-1 min-w-0">
                    <div className="font-bold text-slate-800 truncate">{maskEmail(e.target_email) || '(unknown)'}</div>
                    <div className="text-slate-500 truncate">by {maskEmail(e.changed_by_email) || 'system'}</div>
                  </div>
                  <div className="shrink-0">{arrow(e.old_role, e.new_role)}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ============================================================================
   MODAL: CatalogManagementModal
   ============================================================================ */
export function CatalogManagementModal({ which, db, onClose, onEdit, onAdd, onDelete }) {
  const cfg = {
    bloodlines: {
      title:    'Manage Bloodlines',
      icon:     'Book',
      list:     db.bloodlines || [],
      empty:    'No bloodlines yet.',
      labelFor: b => [b.category, b.subcategory].filter(Boolean).join(' / ') || '—',
    },
  }[which];

  const grouped = useMemo(() => {
    const out = {};
    cfg.list.forEach(item => {
      const cat = item.category || 'Uncategorized';
      (out[cat] = out[cat] || []).push(item);
    });
    Object.values(out).forEach(arr => arr.sort((a, b) => (a.name || '').localeCompare(b.name || '')));
    return Object.entries(out).sort(([a], [b]) => a.localeCompare(b));
  }, [cfg.list]);

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4 animate-in fade-in" onClick={onClose}>
      <div className="bg-white rounded-3xl max-w-3xl w-full overflow-hidden max-h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="bg-slate-900 text-white p-5 flex justify-between items-center shrink-0">
          <div className="flex items-center gap-2">
            <Icon n={cfg.icon} size={20} className="text-indigo-400" />
            <h3 className="font-bold text-lg">{cfg.title}</h3>
            <span className="text-[10px] uppercase font-bold text-slate-400 bg-slate-800 border border-slate-700 px-2 py-0.5 rounded">{cfg.list.length}</span>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={onAdd}
                    className="text-xs px-3 py-1.5 font-bold rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white flex items-center gap-1.5">
              <Icon n="Plus" size={12}/> Add
            </button>
            <button onClick={onClose} className="text-slate-400 hover:text-white"><Icon n="X" size={18} /></button>
          </div>
        </div>

        <div className="p-6 overflow-y-auto custom-scrollbar">
          {cfg.list.length === 0 ? (
            <div className="text-center py-12 text-slate-400 text-sm font-semibold">{cfg.empty}</div>
          ) : (
            <div className="space-y-6">
              {grouped.map(([cat, items]) => (
                <div key={cat}>
                  <h4 className="text-xs font-bold uppercase tracking-widest text-slate-500 mb-2 border-b border-slate-100 pb-1">
                    {cat} <span className="text-slate-400 normal-case font-semibold">({items.length})</span>
                  </h4>
                  <div className="space-y-1.5">
                    {items.map(item => (
                      <div key={item._id} className="flex items-center gap-3 p-3 bg-slate-50 border border-slate-200 rounded-xl hover:bg-slate-100">
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-bold text-slate-800 truncate">{item.name}</div>
                          <div className="text-xs text-slate-500 truncate flex items-center gap-1.5">
                            <span>{cfg.labelFor(item)}</span>
                            {toArray(item.custom_tags).length > 0 && (
                              <>
                                <span className="text-slate-300">·</span>
                                <span className="truncate">{toArray(item.custom_tags).join(', ')}</span>
                              </>
                            )}
                            {item.link && item.link !== '#' && (
                              <>
                                <span className="text-slate-300">·</span>
                                <a href={item.link} target="_blank" rel="noopener noreferrer"
                                   onClick={e => e.stopPropagation()}
                                   className="text-indigo-600 hover:underline shrink-0">link</a>
                              </>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <button onClick={() => onEdit(item)}
                                  className="p-2 text-slate-500 hover:bg-indigo-100 hover:text-indigo-700 rounded-lg">
                            <Icon n="Edit" size={14}/>
                          </button>
                          <button onClick={() => onDelete(item)}
                                  className="p-2 text-slate-500 hover:bg-rose-100 hover:text-rose-700 rounded-lg">
                            <Icon n="Trash" size={14}/>
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ============================================================================
   MODAL: SystemToolsModal
   ============================================================================ */
export function SystemToolsModal({ db, setDb, onClose, onRefresh, refreshing, onOpenAuditLog, onManageBL, isOwner }) {
  const [msg, setMsg]         = useState('');
  const [newSpec, setNewSpec] = useState('');
  const [pendingDel, setPendingDel] = useState(null);

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

  const exportJson = () => {
    const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(db, null, 2));
    const a = document.createElement('a');
    a.href = dataStr;
    a.download = 'narp_database_backup.json';
    a.click();
    setMsg('JSON Exported Successfully');
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
            {/* Sync */}
            <div className="bg-slate-50 rounded-2xl border p-6">
              <h3 className="text-lg font-bold mb-2 flex items-center gap-2">
                <Icon n="Refresh" size={20} className="text-indigo-500" /> Synchronization
              </h3>
              <p className="text-xs text-slate-500 mb-6">Re-fetch the latest catalog and pending list from the database. Use after another admin made changes you want to see locally.</p>
              <button onClick={handleSync} disabled={refreshing}
                      className="w-full bg-indigo-600 text-white py-3 rounded-xl font-bold flex justify-center gap-2 hover:bg-indigo-700 shadow-md disabled:opacity-50">
                <Icon n="Refresh" size={16} className={refreshing ? 'animate-spin' : ''}/>
                {refreshing ? 'Syncing...' : 'Sync data'}
              </button>
            </div>

            {/* Audit Log */}
            <div className="bg-slate-50 rounded-2xl border p-6">
              <h3 className="text-lg font-bold mb-2 flex items-center gap-2">
                <Icon n="Clock" size={20} className="text-amber-500" /> Audit Log
              </h3>
              <p className="text-xs text-slate-500 mb-6">View the history of role changes — who promoted or demoted whom, and when.</p>
              <button onClick={onOpenAuditLog}
                      className="w-full bg-slate-800 text-white py-3 rounded-xl font-bold flex justify-center gap-2 hover:bg-slate-900">
                <Icon n="Eye" size={16}/> View log
              </button>
            </div>

            {/* Manage Bloodlines */}
            <div className="bg-slate-50 rounded-2xl border p-6">
              <h3 className="text-lg font-bold mb-2 flex items-center gap-2">
                <Icon n="Book" size={20} className="text-purple-500" /> Bloodlines
              </h3>
              <p className="text-xs text-slate-500 mb-6">Add, edit, and remove bloodlines. These populate the bloodline filter dropdown but no longer have a public browse tab.</p>
              <button onClick={onManageBL}
                      className="w-full bg-purple-600 text-white py-3 rounded-xl font-bold flex justify-center gap-2 hover:bg-purple-700">
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
                <button onClick={() => setMsg('CSV export is currently under construction.')}
                        className="flex-1 bg-emerald-600 text-white py-3 rounded-xl font-bold flex justify-center gap-2 hover:bg-emerald-700">
                  <Icon n="Download" size={16}/> CSV
                </button>
              </div>
            </div>

            {/* Manage Specializations */}
            <div className="bg-slate-50 rounded-2xl border p-6 md:col-span-2">
              <h3 className="text-lg font-bold mb-2 flex items-center gap-2">
                <Icon n="Tag" size={20} className="text-indigo-500" /> Manage Specializations
              </h3>
              <p className="text-xs text-slate-500 mb-4">Add or permanently remove tags from the global Specializations list used when creating new Jutsus.</p>
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
      </div>
    </div>
  );
}
