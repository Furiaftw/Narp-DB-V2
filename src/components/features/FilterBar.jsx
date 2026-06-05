import React, { useState, useEffect, useRef, memo } from 'react';
import Icon from '../ui/Icon';
import { GenericDropdown, BloodlineDropdown } from '../ui/Dropdowns';
import { getNatureColor } from '../../utils/helpers';
import { NATURES, JUTSU_TYPES, BM_TIERS, RANKS, ORIGIN } from '../../constants/catalog';

const TOGGLE_PAIRS = [
  { showKey: 'lck', hideKey: 'hLck', label: 'Locked'     },
  { showKey: 'lim', hideKey: 'hLim', label: 'Limited'    },
  { showKey: 'mul', hideKey: 'hMul', label: 'Multi-Rank' },
];
const HIDE_ONLY = [
  { hideKey: 'hMP',  label: 'Multi-Post' },
  { hideKey: 'hAsk', label: 'Ask Reviewer'  },
];

/* ============================================================================
   FILTER BAR — top search/sort/filter row (stays inside the sticky header)
   ============================================================================ */
export function FilterBar({ tab, f, setF, activeFilterCount, clearF, isAdmin, onAdd, onOpenStatelessSubmission }) {
  const [ddOpen, setDdOpen] = useState(null);
  const [addDdOpen, setAddDdOpen] = useState(false);
  const addDdRef = useRef(null);

  const toggleArr = (key, value) =>
    setF(p => ({ ...p, [key]: p[key].includes(value) ? p[key].filter(x => x !== value) : [...p[key], value] }));

  useEffect(() => {
    if (!addDdOpen) return;
    const handler = (e) => {
      if (addDdRef.current && !addDdRef.current.contains(e.target)) setAddDdOpen(false);
    };
    document.addEventListener('mousedown', handler);
    document.addEventListener('touchstart', handler);
    return () => {
      document.removeEventListener('mousedown', handler);
      document.removeEventListener('touchstart', handler);
    };
  }, [addDdOpen]);

  const sortOpts = tab === 'jutsus'
    ? [{ v: 'newest', l: 'Newest First' }, { v: 'oldest', l: 'Oldest First' }, { v: 'az', l: 'Name (A-Z)' }, { v: 'za', l: 'Name (Z-A)' }, { v: 'rank_desc', l: 'Rank (High to Low)' }, { v: 'rank_asc', l: 'Rank (Low to High)' }]
    : [{ v: 'newest', l: 'Newest First' }, { v: 'oldest', l: 'Oldest First' }, { v: 'az', l: 'Name (A-Z)' }, { v: 'za', l: 'Name (Z-A)' }];

  const ActiveChip = ({ label, onRemove }) => (
    <span className="flex items-center gap-1.5 bg-slate-800 border border-slate-700 text-slate-200 text-[10px] font-bold px-2.5 py-1 rounded-lg shrink-0 shadow-sm">
      {label}
      <button onClick={onRemove} className="hover:text-red-400 ml-0.5"><Icon n="X" size={12} /></button>
    </span>
  );

  return (
    <div className="bg-slate-900 text-white p-4 shadow-md z-30 shrink-0">
      <div className="max-w-6xl mx-auto flex flex-col gap-3">
        <div className="flex gap-2">
          <div className="relative flex-1 min-w-0">
            <Icon n="Search" size={18} className="absolute left-4 top-3 text-slate-400" />
            <input type="text" placeholder="Search..."
                   className="w-full bg-slate-800 border border-slate-700 text-white rounded-xl py-2.5 pl-12 pr-4 outline-none focus:ring-2 focus:ring-indigo-500 text-sm transition-shadow"
                   value={f.q} onChange={(e) => setF(p => ({ ...p, q: e.target.value }))} />
          </div>

          <div className="relative shrink-0">
            <button onClick={() => setDdOpen(ddOpen === 'sort' ? null : 'sort')}
                    className="px-4 py-2.5 rounded-xl text-sm font-bold flex items-center justify-center gap-2 bg-slate-800 border border-slate-700 text-slate-300 hover:bg-slate-700 transition-colors">
              <Icon n="Sort" size={16} /> <span className="hidden sm:inline">Sort</span>
            </button>
            {ddOpen === 'sort' && (
              <div className="absolute right-0 mt-2 w-48 bg-white rounded-xl shadow-xl border border-slate-200 py-1 z-50 overflow-hidden animate-in fade-in slide-in-from-top-2">
                {sortOpts.map(o => (
                  <button key={o.v} onClick={() => { setF(p => ({ ...p, sort: o.v })); setDdOpen(null); }}
                          className={`w-full text-left px-4 py-2.5 text-sm transition-colors ${f.sort === o.v ? 'bg-indigo-50 text-indigo-700 font-bold' : 'text-slate-700 hover:bg-slate-50'}`}>
                    {o.l}
                  </button>
                ))}
              </div>
            )}
          </div>

          <button onClick={() => setF(p => ({ ...p, showFilters: !p.showFilters }))}
                  className={`px-5 py-2.5 rounded-xl text-sm font-bold flex items-center justify-center gap-2 transition-colors shrink-0 ${
                    f.showFilters || activeFilterCount > 0
                      ? 'bg-indigo-600 text-white shadow-lg'
                      : 'bg-slate-800 border border-slate-700 text-slate-300 hover:bg-slate-700'
                  }`}>
            <Icon n="Filter" size={16} />
            <span className="hidden sm:inline">Filters</span>
            {activeFilterCount > 0 && (
              <span className="bg-white text-indigo-600 px-1.5 py-0.5 rounded-md text-[10px]">{activeFilterCount}</span>
            )}
          </button>

          {isAdmin && (
            <div className="relative shrink-0" ref={addDdRef}>
              <button onClick={() => setAddDdOpen(!addDdOpen)}
                      className="px-5 py-2.5 rounded-xl text-sm font-bold flex items-center justify-center gap-2 transition-all shrink-0 bg-indigo-600 text-white hover:bg-indigo-700 shadow-lg">
                <Icon n="PlusCir" size={16} /> <span className="hidden sm:inline">Add</span> <Icon n="Down" size={12} className="text-white opacity-80" />
              </button>
              {addDdOpen && (
                <div className="absolute right-0 mt-2 w-56 bg-white rounded-xl shadow-xl border border-slate-200 z-50 overflow-hidden py-1">
                  <button type="button" onClick={() => { setAddDdOpen(false); onAdd(); }}
                          className="w-full text-left px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 flex items-center gap-2">
                    <Icon n="PlusCir" size={14} className="text-indigo-500" /> Jutsu / Battlemode
                  </button>
                  <button type="button" disabled
                          className="w-full text-left px-4 py-2.5 text-sm font-semibold text-slate-400 flex items-center gap-2 border-t border-slate-100 cursor-not-allowed opacity-60">
                    <Icon n="PlusCir" size={14} className="text-emerald-400" /> OC Submission (Under Development)
                  </button>
                  <button type="button" disabled
                          className="w-full text-left px-4 py-2.5 text-sm font-semibold text-slate-400 flex items-center gap-2 border-t border-slate-100 cursor-not-allowed opacity-60">
                    <Icon n="PlusCir" size={14} className="text-amber-400" /> Summon (Under Development)
                  </button>
                  <button type="button" disabled
                          className="w-full text-left px-4 py-2.5 text-sm font-semibold text-slate-400 flex items-center gap-2 border-t border-slate-100 cursor-not-allowed opacity-60">
                    <Icon n="PlusCir" size={14} className="text-purple-400" /> Custom Item (Under Development)
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {activeFilterCount > 0 && (
          <div className="flex flex-wrap items-center gap-2 pt-1 pb-1">
            <span className="text-xs font-bold text-slate-400 mr-1 shrink-0 uppercase tracking-widest">Active:</span>
            {['nat', 'rnk', 'typ', 'spc', 'org', 'bl', 'bm'].map(k =>
              f[k].map(v => <ActiveChip key={`${k}-${v}`} label={v} onRemove={() => toggleArr(k, v)} />)
            )}
            {TOGGLE_PAIRS.map(p => f[p.showKey] && (
              <ActiveChip key={p.showKey} label={`${p.label} Only`} onRemove={() => setF(s => ({ ...s, [p.showKey]: false }))} />
            ))}
            {[...TOGGLE_PAIRS, ...HIDE_ONLY].map(p => f[p.hideKey] && (
              <ActiveChip key={p.hideKey} label={`Hide: ${p.label}`} onRemove={() => setF(s => ({ ...s, [p.hideKey]: false }))} />
            ))}
            <button onClick={clearF} className="text-xs font-semibold text-slate-400 hover:text-white underline ml-2">Clear All</button>
          </div>
        )}
      </div>
    </div>
  );
}

/* ============================================================================
   FILTER PANEL — expanded filter options (renders OUTSIDE the sticky header)
   Moving this out of the sticky container eliminates layout reflow on open and
   lets absolutely/fixed-positioned dropdowns escape the viewport freely.
   ============================================================================ */
const ChipFilter = memo(function ChipFilter({ title, values, fKey, f, onToggle }) {
  return (
    <div>
      <label className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-3 block">{title}</label>
      <div className="flex flex-wrap gap-2.5">
        {values.map(x => (
          <button key={x} onClick={() => onToggle(fKey, x)}
                  className={`px-4 py-2 rounded-xl text-sm font-semibold transition-all border ${
                    f[fKey].includes(x)
                      ? (fKey === 'nat' ? getNatureColor(x) + ' ring-1 ring-offset-1 shadow-sm' : 'bg-indigo-100 border-indigo-300 text-indigo-800 shadow-sm')
                      : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                  }`}>
            {x}
          </button>
        ))}
      </div>
    </div>
  );
});

export function FilterBarPanel({ tab, f, setF, bloodlinesDb, specOptions, clearF }) {
  const [ddOpen, setDdOpen] = useState(null);
  const toggleArr = (key, value) =>
    setF(p => ({ ...p, [key]: p[key].includes(value) ? p[key].filter(x => x !== value) : [...p[key], value] }));

  if (!f.showFilters || tab !== 'jutsus') return null;

  return (
    <div className="bg-slate-50 border-b border-slate-200 p-6 md:p-8">
      <div className="max-w-6xl mx-auto space-y-10">
        <div>
          <h3 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-5 border-b border-slate-200 pb-2">Basic Properties</h3>
          <div className="space-y-6">
            <ChipFilter title="Nature"      values={NATURES}     fKey="nat" f={f} onToggle={toggleArr} />
            <ChipFilter title="Jutsu Types" values={JUTSU_TYPES} fKey="typ" f={f} onToggle={toggleArr} />
            {f.typ.includes('Battlemode') && (
              <div className="p-3 bg-indigo-50 border border-indigo-100 rounded-xl">
                <ChipFilter title="Battlemode Tiers" values={BM_TIERS} fKey="bm" f={f} onToggle={toggleArr} />
              </div>
            )}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <ChipFilter title="Rank"   values={RANKS}  fKey="rnk" f={f} onToggle={toggleArr} />
              <ChipFilter title="Origin" values={ORIGIN} fKey="org" f={f} onToggle={toggleArr} />
            </div>
          </div>
        </div>

        <div>
          <h3 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-5 border-b border-slate-200 pb-2">Detailed Tags</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8 max-w-3xl">
            <GenericDropdown
              l="Specialization" placeholder="Any Specialization"
              opts={specOptions.map(s => ({ value: s, label: s }))}
              sel={f.spc} onChange={v => setF(p => ({ ...p, spc: v }))}
              isOpen={ddOpen === 'f_spc'} onToggle={() => setDdOpen(ddOpen === 'f_spc' ? null : 'f_spc')} />
            <BloodlineDropdown
              l="Bloodlines" placeholder="Any Bloodline"
              bloodlinesDb={bloodlinesDb}
              sel={f.bl} onChange={v => setF(p => ({ ...p, bl: v }))} isMulti
              isOpen={ddOpen === 'f_bl'} onToggle={() => setDdOpen(ddOpen === 'f_bl' ? null : 'f_bl')} />
          </div>
        </div>

        <div>
          <h3 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-5 border-b border-slate-200 pb-2">Conditions &amp; Exclusions</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <div>
              <label className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-3 block">Show Only</label>
              <div className="flex flex-wrap gap-4">
                {TOGGLE_PAIRS.map(p => (
                  <label key={p.showKey} className="flex items-center gap-2.5 text-sm font-bold text-slate-700 cursor-pointer group">
                    <div className={`w-5 h-5 rounded flex items-center justify-center border-2 transition-colors ${f[p.showKey] ? 'bg-indigo-600 border-indigo-600 text-white' : 'bg-white border-slate-300 text-transparent'}`}>
                      <Icon n="Check" size={14}/>
                    </div>
                    <input type="checkbox" checked={f[p.showKey]} className="hidden"
                           onChange={e => setF(prev => ({
                             ...prev,
                             [p.showKey]: e.target.checked,
                             ...(e.target.checked ? { [p.hideKey]: false } : {}),
                           }))} />
                    {p.label}
                  </label>
                ))}
              </div>
            </div>

            <div>
              <label className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-3 block">Hide (Exclude)</label>
              <div className="flex flex-wrap gap-4">
                {[...TOGGLE_PAIRS, ...HIDE_ONLY].map(p => (
                  <label key={p.hideKey} className="flex items-center gap-2.5 text-sm font-bold text-slate-700 cursor-pointer group">
                    <div className={`w-5 h-5 rounded flex items-center justify-center border-2 transition-colors ${f[p.hideKey] ? 'bg-rose-500 border-rose-500 text-white' : 'bg-white border-slate-300 text-transparent'}`}>
                      <Icon n="X" size={14}/>
                    </div>
                    <input type="checkbox" checked={!!f[p.hideKey]} className="hidden"
                           onChange={e => setF(prev => ({
                             ...prev,
                             [p.hideKey]: e.target.checked,
                             ...(e.target.checked && p.showKey ? { [p.showKey]: false } : {}),
                           }))} />
                    {p.label}
                  </label>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default FilterBar;
