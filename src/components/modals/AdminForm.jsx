import { useState, useEffect, useRef, useMemo } from 'react';
import { Icon } from '../ui/Icon';
import { BloodlineDropdown, GenericDropdown } from '../ui/Dropdowns';
import SlotsEditor from '../ui/SlotsEditor';
import JutsuSheetModal from '../features/JutsuSheetModal';
import { toArray } from '../../utils/helpers';
import { MANAGE_TABLES, BM_TIER_TO_RANK, RANK_COST_MAP, RANK_COST_NUM } from '../../constants/catalog';
import { emptyJutsuSheet, normalizeJutsuSheet, jutsuSheetHasContent } from '../../constants/jutsuSheet';

/* ============================================================================
   MODAL: AdminFormModal
   Renders a jutsu/bloodline form from the MANAGE_TABLES schema, and folds the
   jutsu sheet into fd._sheet alongside the rest of the fields.
   ============================================================================ */

/* ============================================================================
   MODAL: AdminFormModal
   ============================================================================ */
export function AdminFormModal({ tab: rawTab, eRow, onClose, db, onSubmit, willGoToPending, isAdmin = false, isPendingEdit = false }) {
  const tab = MANAGE_TABLES[rawTab] ? rawTab : 'jutsus';
  const schema = MANAGE_TABLES[tab] || MANAGE_TABLES['jutsus'];
  const [fd, setFd]   = useState({});
  const [ddOpen, setDdOpen] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  // Which rank's documentation is currently open for editing; '__single__'
  // for a non-multi-rank jutsu (only one doc), null when closed.
  const [editingDocRank, setEditingDocRank] = useState(null);
  // Admins creating a NEW jutsu default to requesting a second approval;
  // they can still switch the toggle off for a direct write.
  const [askSecondApproval, setAskSecondApproval] = useState(
    () => isAdmin && tab === 'jutsus' && !isPendingEdit && !eRow?._id
  );

  // FIX: Lock the document body scroll so iOS Safari doesn't crash on unmount
  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = '';
    };
  }, []);

  // Hydrate the form whenever the row to edit changes.
  useEffect(() => {
    const next = {};
    schema.fields.forEach(field => {
      const raw = eRow[field.k];
      if (raw === undefined || raw === null || raw === '') {
        next[field.k] = field.t === 'slots'
          ? (field.defCount ? JSON.stringify(Array(field.defCount).fill({ username: '', discord_link: '' })) : '[]')
          : '';
      } else {
        next[field.k] = Array.isArray(raw) ? raw.join(', ') : raw;
      }
    });
    // Sync derived fields
    if (tab === 'jutsus') {
      const conds = [];
      if (eRow.locked)  conds.push('Locked');
      if (eRow.limited) conds.push('Limited');
      if (conds.length) next.conditions = conds.join(', ');
      next._cCost = !!(eRow._id && eRow.cost && !toArray(eRow.types).includes('Battlemode'));
      // The doc(s) are a nested object, not a schema field — carried
      // separately. Internally always keyed by rank ('__single__' when the
      // jutsu isn't multi-rank) so toggling rank selection mid-edit can't
      // scramble which doc belongs to which rank.
      next._sheet = {};
      if (eRow.multiRank) {
        const stored = (eRow.sheet && typeof eRow.sheet === 'object') ? eRow.sheet : {};
        toArray(eRow.rank).forEach(r => { next._sheet[r] = normalizeJutsuSheet(stored[r]); });
      } else {
        next._sheet.__single__ = normalizeJutsuSheet(eRow.sheet);
      }
    }
    setFd(next);
  }, [eRow, tab]);

  // Bloodlines sorted alphabetically for the picker (admin form is always A-Z).
  const sortedBloodlinesForForm = useMemo(
    () => [...(db.bloodlines || [])].sort((a, b) => a.name.localeCompare(b.name)),
    [db.bloodlines]
  );

  const handleSave = async () => {
    setSubmitting(true);
    const p = { ...fd };
    const isEdit = !!eRow._id;
    let entity = null;
    if (tab === 'jutsus') {
      const types = toArray(p.types);
      const isBm  = types.includes('Battlemode');
      let rank = [], bmTier = '';
      if (isBm) {
        p.cost = '';
        bmTier = p.bm_tier || '';
        rank   = [BM_TIER_TO_RANK[bmTier] || ''];
      } else if (!p._cCost) {
        p.cost = '';
        rank = toArray(p.rank).slice().sort((a, b) => (RANK_COST_NUM[a] || 0) - (RANK_COST_NUM[b] || 0));
      } else {
        rank = toArray(p.rank).slice().sort((a, b) => (RANK_COST_NUM[a] || 0) - (RANK_COST_NUM[b] || 0));
      }
      const conds = toArray(p.conditions);
      const isMultiRank = rank.length > 1 && !isBm;
      let sheetToSave = {};
      if (isMultiRank) {
        rank.forEach(r => {
          const s = (p._sheet || {})[r];
          if (s) sheetToSave[r] = s;
        });
      } else {
        sheetToSave = (p._sheet || {}).__single__ || {};
      }
      entity = {
        _id:         eRow._id || (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `j-${Date.now()}`),
        name:        p.name || '',
        nature:      p.nature || '',
        rank,
        cost:        p.cost || '',
        types,
        jutsu_type:  toArray(p.jutsu_type),
        origin:      p.origin || '',
        spec:        toArray(p.spec),
        custom_tags: toArray(p.custom_tags),
        // No longer editable here — the sheet replaces it — but preserve
        // whatever a legacy jutsu already had rather than wiping it on save.
        link:        eRow.link || '',
        bloodline:   p.bloodline || '',
        limited:     conds.includes('Limited'),
        locked:      conds.includes('Locked'),
        multiRank:   isMultiRank,
        slots:       conds.includes('Limited') ? (p.slots || '') : '',
        bm_tier:     bmTier,
        sheet:       sheetToSave,
        _createdAt:  eRow._createdAt || new Date().toISOString(),
      };
    } else if (tab === 'bloodlines') {
      entity = {
        _id:                      eRow._id || (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `b-${Date.now()}`),
        name:                     p.name || '',
        category:                 p.category || 'Custom',
        subcategory:              p.subcategory || 'Other',
        custom_tags:              toArray(p.custom_tags),
        link:                     p.link || '',
        proprietary_ability_link: p.proprietary_ability_link || '',
        max_slots:                p.max_slots != null && p.max_slots !== '' ? Number(p.max_slots) : 5,
        slots:                    p.slots || '',
        _createdAt:               eRow._createdAt || new Date().toISOString(),
      };
    }
    try {
      await onSubmit({
        tab,
        operation: isEdit ? 'update' : 'insert',
        targetId:  isEdit ? eRow._id : null,
        entity,
        askSecondApproval: isAdmin && askSecondApproval,
      });
      onClose();
    } catch (e) {
      alert('Save failed: ' + (e.message || 'unknown error'));
      setSubmitting(false);
    }
  };

  const visibleFields = schema.fields.filter(field =>
    !field.hidden &&
    (!field.hideUnlessInc || toArray(fd[field.hideUnlessInc.f]).includes(field.hideUnlessInc.v)) &&
    (!field.hideIfInc     || !toArray(fd[field.hideIfInc.f]).includes(field.hideIfInc.v))
  );

  // Multi-rank jutsus get one documentation doc per rank instead of one
  // shared doc — computed live off the current rank selection, not the
  // hydrated eRow, so toggling ranks in the form updates the doc list too.
  const docIsMultiRank = tab === 'jutsus' && toArray(fd.rank).length > 1 && !toArray(fd.types).includes('Battlemode');
  const docRanks = docIsMultiRank
    ? toArray(fd.rank).slice().sort((a, b) => (RANK_COST_NUM[a] || 0) - (RANK_COST_NUM[b] || 0))
    : ['__single__'];
  const docFor = (rankKey) => (fd._sheet || {})[rankKey] || emptyJutsuSheet();
  const setDocFor = (rankKey, next) => setFd({ ...fd, _sheet: { ...(fd._sheet || {}), [rankKey]: next } });

  return (
    <div className="fixed inset-0 z-[70] bg-slate-900/60 flex items-center justify-center p-4 sm:p-6 overflow-hidden">
      {/* FIX: Removed overflow-y-auto from outer wrapper and adjusted padding */}
      
      {/* FIX: Set max-h-[90vh] and flex-col to bound the card size securely */}
      <div className="bg-white rounded-3xl shadow-2xl max-w-3xl w-full max-h-[90vh] flex flex-col animate-in zoom-in-95 duration-200">
        
        {/* FIX: Moved overflow-y-auto down into this content wrapper specifically */}
        <div className="p-6 md:p-8 overflow-y-auto custom-scrollbar flex-1">
          
          <div className="flex justify-between items-center mb-8 border-b pb-4">
            <h3 className="text-xl font-bold flex items-center gap-3">
              <Icon n={eRow._id ? 'Edit' : 'PlusCir'} size={24} className="text-indigo-500" />
              {eRow._id ? 'Edit Entry' : `Add ${schema.label}`}
            </h3>
            <button onClick={onClose} className="text-slate-400 hover:bg-slate-100 p-2 rounded-full">
              <Icon n="X" size={20}/>
            </button>
          </div>

          {(willGoToPending || askSecondApproval) && (
            <div className="mb-6 p-4 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 text-sm flex items-start gap-3">
              <Icon n="Alert" size={18} className="text-amber-600 mt-0.5 shrink-0"/>
              <div>
                <p className="font-bold mb-1">This submission needs a second approval.</p>
                <p>Another Reviewer or admin will need to approve it before it goes live. You'll see it in the <strong>Pending</strong> tab until then.</p>
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            {visibleFields.map(field => (
              <div key={field.k} className={field.col === 2 || field.t === 'slots' ? 'md:col-span-2' : ''}>
                <label className="block text-xs font-bold text-slate-500 uppercase mb-2.5">{field.l}</label>
                {field.t === 'chip' ? (
                  <div className="flex flex-wrap gap-2.5">
                    {field.opts.map(o => {
                      const arr = toArray(fd[field.k]);
                      const sel = arr.includes(o);
                      return (
                        <button key={o} type="button"
                                onClick={() => setFd({
                                  ...fd,
                                  [field.k]: field.multi
                                    ? (sel ? arr.filter(x => x !== o).join(', ') : [...arr, o].join(', '))
                                    : (sel ? '' : o),
                                })}
                                className={`px-4 py-2 rounded-xl text-sm font-bold border ${sel ? 'bg-indigo-600 text-white shadow-md' : 'bg-slate-50 text-slate-600'}`}>
                          {o}
                        </button>
                      );
                    })}
                  </div>
                ) : field.t === 'spec-dd' ? (
                  <GenericDropdown
                    l="" placeholder="Select Specializations"
                    opts={(db.specializations || []).map(s => ({ value: s, label: s }))}
                    sel={toArray(fd[field.k])}
                    onChange={v => setFd({ ...fd, [field.k]: v.join(', ') })}
                    isOpen={ddOpen === field.k}
                    onToggle={() => setDdOpen(ddOpen === field.k ? null : field.k)} />
                ) : field.t === 'ttag-dd' ? (
                  <GenericDropdown
                    l="" placeholder="Select Jutsu Type(s)"
                    opts={(db.jutsuTypeTags || []).map(s => ({ value: s, label: s }))}
                    sel={toArray(fd[field.k])}
                    onChange={v => setFd({ ...fd, [field.k]: v.join(', ') })}
                    isOpen={ddOpen === field.k}
                    onToggle={() => setDdOpen(ddOpen === field.k ? null : field.k)} />
                ) : field.t === 'bl-select' ? (
                  <BloodlineDropdown
                    l="" placeholder="Select Bloodline"
                    bloodlinesDb={sortedBloodlinesForForm}
                    sel={fd[field.k] || ''}
                    onChange={v => setFd({ ...fd, [field.k]: v })}
                    isMulti={false}
                    isOpen={ddOpen === field.k}
                    onToggle={() => setDdOpen(ddOpen === field.k ? null : field.k)} />
                ) : field.t === 'slots' ? (
                  <SlotsEditor value={fd[field.k] || ''} onChange={v => setFd({ ...fd, [field.k]: v })} defCount={field.defCount || (field.defCountField ? (parseInt(fd[field.defCountField]) || 1) : 1)} />
                ) : (
                  <input type="text" value={fd[field.k] || ''}
                         onChange={(e) => setFd({ ...fd, [field.k]: e.target.value })}
                         className="w-full text-sm bg-slate-50 border rounded-xl px-4 py-3 outline-none focus:ring-2 focus:ring-indigo-500"
                         placeholder={field.l} />
                )}
              </div>
            ))}

            {/* Cost row, jutsus only and not Battlemode */}
            {tab === 'jutsus' && !toArray(fd.types).includes('Battlemode') && (
              <div className="md:col-span-2 pt-4 border-t">
                <label className="text-xs font-bold text-slate-500 uppercase block mb-2.5">
                  Cost
                  {!fd._cCost && (
                    <span className="text-indigo-500 ml-2">
                      (auto: {(() => {
                        const r = toArray(fd.rank).slice().sort((a, b) => (RANK_COST_NUM[a] || 0) - (RANK_COST_NUM[b] || 0));
                        return r.length === 1 ? RANK_COST_MAP[r[0]] : (r.length > 1 ? r.map(x => RANK_COST_MAP[x]).filter(Boolean).join(' / ') : '');
                      })()})
                    </span>
                  )}
                </label>
                <div className="flex items-center gap-4">
                  {fd._cCost ? (
                    <input value={fd.cost || ''} onChange={e => setFd({ ...fd, cost: e.target.value })}
                           className="flex-1 bg-white border rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-indigo-500 shadow-sm"
                           placeholder="Custom cost (e.g. 5 CU)" />
                  ) : (
                    <div className="flex-1 bg-slate-100 border rounded-xl px-4 py-3 text-sm text-slate-500 font-semibold shadow-sm flex items-center gap-1 flex-wrap">
                      {toArray(fd.rank).length > 0
                        ? toArray(fd.rank).slice().sort((a, b) => (RANK_COST_NUM[a] || 0) - (RANK_COST_NUM[b] || 0)).map((r, i) => (
                            <span key={i} className="px-2 py-0.5 bg-indigo-50 border border-indigo-100 text-indigo-600 rounded-md text-xs font-black">
                              {RANK_COST_MAP[r] || '-'}
                            </span>
                          ))
                        : 'Select a rank to see cost'}
                    </div>
                  )}
                  <label className="flex items-center gap-3 text-sm font-bold cursor-pointer group">
                    <div className={`w-6 h-6 rounded-md flex items-center justify-center border-2 ${fd._cCost ? 'bg-indigo-600 border-indigo-600 text-white shadow-md' : 'bg-slate-50 border-slate-300 text-transparent group-hover:border-indigo-400'}`}>
                      <Icon n="Check" size={16}/>
                    </div>
                    <input type="checkbox" checked={!!fd._cCost}
                           onChange={(e) => setFd({ ...fd, _cCost: e.target.checked, cost: '' })}
                           className="hidden" />
                    Custom Cost
                  </label>
                </div>
              </div>
            )}
          </div>

          {/* Jutsu Documentation — replaces the old Doc Link with the full in-app write-up */}
          {tab === 'jutsus' && (
            <div className="mt-8 p-4 bg-slate-50 border rounded-2xl">
              <p className="text-sm font-bold text-slate-800">Jutsu Documentation</p>
              <p className="text-xs text-slate-500 mb-3">
                {docIsMultiRank
                  ? 'This jutsu is multi-rank — each rank gets its own documentation.'
                  : 'Description, mechanics, and restrictions for this jutsu.'}
              </p>
              <div className="flex flex-wrap gap-2.5">
                {docRanks.map(rankKey => {
                  const filled = jutsuSheetHasContent(docFor(rankKey));
                  return (
                    <button key={rankKey} type="button" onClick={() => setEditingDocRank(rankKey)}
                            className="bg-white border-2 border-indigo-200 text-indigo-700 px-4 py-2 rounded-xl font-bold text-sm hover:bg-indigo-50 flex items-center gap-2">
                      <Icon n="Edit" size={14}/>
                      {docIsMultiRank ? `${filled ? 'Edit' : 'Add'} ${rankKey}-Rank Doc` : (filled ? 'Edit Documentation' : 'Add Documentation')}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Ask Second Approval Toggle (Admins/Owners only) */}
          {isAdmin && tab === 'jutsus' && !isPendingEdit && (
            <div className="mt-8 p-4 bg-slate-50 border rounded-2xl flex items-center justify-between gap-4">
              <div>
                <p className="text-sm font-bold text-slate-800">Request Second Approval</p>
                <p className="text-xs text-slate-500">Submit this change for review by another Reviewer or Admin before it goes live.</p>
              </div>
              <label className="relative inline-flex items-center cursor-pointer shrink-0">
                <input
                  type="checkbox"
                  checked={askSecondApproval}
                  onChange={(e) => setAskSecondApproval(e.target.checked)}
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-indigo-600"></div>
              </label>
            </div>
          )}

          <div className="flex justify-end gap-4 mt-10 pt-6 border-t">
            <button onClick={onClose} className="bg-white border-2 px-8 py-3 rounded-xl font-bold hover:bg-slate-50">Cancel</button>
            <button onClick={handleSave}
                    disabled={submitting || visibleFields.some(f => f.req && !(fd[f.k] || '').toString().trim())}
                    className="bg-indigo-600 text-white px-8 py-3 rounded-xl font-bold flex gap-2 disabled:opacity-50 hover:bg-indigo-700 shadow-md">
              <Icon n="Save" size={18}/> {submitting ? 'Saving...' : ((willGoToPending || askSecondApproval) ? 'Submit for Approval' : 'Save')}
            </button>
          </div>
        </div>
      </div>
      {editingDocRank && tab === 'jutsus' && (
        <JutsuSheetModal
          sheet={docFor(editingDocRank)}
          onChange={next => setDocFor(editingDocRank, next)}
          jutsuName={docIsMultiRank ? `${fd.name || ''} (${editingDocRank}-Rank)` : (fd.name || '')}
          onClose={() => setEditingDocRank(null)}
        />
      )}
    </div>
  );
}

/* ============================================================================
   MODAL: SystemToolsModal
   ============================================================================ */

export default AdminFormModal;
