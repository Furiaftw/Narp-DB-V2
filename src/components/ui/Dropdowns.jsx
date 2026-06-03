import React, { useState } from 'react';
import Icon from './Icon';
import { BL_CATS, BL_SUBCATS } from '../../constants/catalog';

/* ============================================================================
   COMPONENT: BloodlineDropdown
   ============================================================================ */
export function BloodlineDropdown({ l, sel, onChange, placeholder, bloodlinesDb, isOpen, onToggle, isMulti = true }) {
  const [fCat, setFCat] = useState('All');
  const [fSub, setFSub] = useState('All');
  const [str,  setStr]  = useState('');

  const filtered = (bloodlinesDb || []).filter(b =>
    (fCat === 'All' || b.category === fCat) &&
    (fSub === 'All' || b.subcategory === fSub) &&
    (!str || b.name.toLowerCase().includes(str.toLowerCase()))
  );

  const toggle = (name) => {
    if (isMulti) {
      onChange(sel.includes(name) ? sel.filter(x => x !== name) : [...sel, name]);
    } else {
      onChange(sel === name ? '' : name);
      onToggle();
    }
  };

  const selectAllVisible = () => {
    if (!isMulti) return;
    const visibleNames = filtered.map(b => b.name);
    const next = Array.from(new Set([...sel, ...visibleNames]));
    onChange(next);
  };

  const count = isMulti ? sel.length : (sel ? 1 : 0);
  const buttonLabel = !count
    ? placeholder
    : count === 1 ? (isMulti ? sel[0] : sel) : `${count} selected`;

  return (
    <div className="relative flex flex-col w-full">
      {l && <label className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-2">{l}</label>}

      <button type="button" onClick={onToggle}
              className="w-full text-sm bg-white border border-slate-200 rounded-xl p-3.5 text-left flex items-center justify-between shadow-sm hover:border-indigo-400">
        <span className={count ? (isMulti ? 'text-indigo-700' : 'text-slate-800') + ' font-bold' : 'text-slate-500'}>
          {buttonLabel}
        </span>
        <Icon n="Down" size={16} className={`text-slate-400 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {isOpen && (
        <div className="mt-2 w-full bg-white border border-slate-200 rounded-xl shadow-xl max-h-96 flex flex-col absolute z-40 top-full">
          <div className="p-3 border-b border-slate-100 bg-slate-50 flex flex-col gap-3 shrink-0">
            <div className="flex flex-wrap gap-1.5">
              {['All', ...BL_CATS].map(c => (
                <button key={c} type="button" onClick={() => setFCat(c)}
                        className={`text-xs px-2.5 py-1 rounded-md font-bold transition-colors ${fCat === c ? 'bg-indigo-600 text-white' : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-100'}`}>
                  {c}
                </button>
              ))}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {['All', ...BL_SUBCATS].map(s => (
                <button key={s} type="button" onClick={() => setFSub(s)}
                        className={`text-xs px-2.5 py-1 rounded-md font-bold transition-colors ${fSub === s ? 'bg-purple-600 text-white' : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-100'}`}>
                  {s}
                </button>
              ))}
            </div>
            <div className="relative mt-1">
              <Icon n="Search" size={14} className="absolute left-3 top-2.5 text-slate-400"/>
              <input type="text" placeholder="Search..." value={str} onChange={e => setStr(e.target.value)}
                     className="w-full bg-white border border-slate-200 rounded-lg py-2 pl-9 pr-3 text-sm outline-none focus:ring-1 focus:ring-indigo-500" />
            </div>
            {isMulti && filtered.length > 0 && (fCat !== 'All' || fSub !== 'All' || str) && (
              <button type="button" onClick={selectAllVisible}
                      className="text-[11px] font-bold text-indigo-600 bg-indigo-50 hover:bg-indigo-100 py-1.5 rounded-md">
                Select all {filtered.length} visible
              </button>
            )}
          </div>

          <div className="overflow-y-auto p-2 flex flex-col gap-1 flex-1 custom-scrollbar">
            {filtered.length === 0 ? (
              <div className="p-4 text-center text-sm text-slate-400 font-medium">No matches found</div>
            ) : filtered.map(b => {
              const isSel = isMulti ? sel.includes(b.name) : sel === b.name;
              return (
                <label key={b._id}
                       className={`flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer transition-colors ${isSel ? 'bg-indigo-50' : 'hover:bg-slate-50'}`}>
                  {isMulti && (
                    <div className={`w-5 h-5 rounded flex items-center justify-center border transition-colors ${isSel ? 'bg-indigo-600 border-indigo-600 text-white' : 'bg-white border-slate-300 text-transparent'}`}>
                      <Icon n="Check" size={14}/>
                    </div>
                  )}
                  <input type="checkbox" checked={isSel} onChange={() => toggle(b.name)} className="hidden" />
                  <div className="flex flex-col">
                    <span className={`text-sm ${isSel ? 'font-bold text-indigo-900' : 'font-medium text-slate-700'}`}>{b.name}</span>
                    <span className="text-[10px] text-slate-400 font-semibold">{b.category} • {b.subcategory}</span>
                  </div>
                </label>
              );
            })}
          </div>

          {isMulti && sel.length > 0 && (
            <div className="border-t border-slate-100 p-2 shrink-0 bg-slate-50">
              <button type="button" onClick={() => onChange([])}
                      className="w-full text-xs font-bold text-red-600 bg-red-50 hover:bg-red-100 py-2 rounded-lg transition-colors">
                Clear Selection ({sel.length})
              </button>
            </div>
          )}
          {!isMulti && sel && (
            <div className="border-t border-slate-100 p-2 shrink-0 bg-slate-50">
              <button type="button" onClick={() => { onChange(''); onToggle(); }}
                      className="w-full text-xs font-bold text-red-600 bg-red-50 hover:bg-red-100 py-2 rounded-lg transition-colors">
                Clear
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ============================================================================
   COMPONENT: GenericDropdown
   ============================================================================ */
export function GenericDropdown({ l, opts, sel, onChange, placeholder, isOpen, onToggle }) {
  const [str, setStr] = useState('');
  const arr = sel || [];
  const filtered = str ? opts.filter(o => (o.label || o).toLowerCase().includes(str.toLowerCase())) : opts;
  const toggle = (v) => onChange(arr.includes(v) ? arr.filter(x => x !== v) : [...arr, v]);

  return (
    <div className="relative flex flex-col w-full">
      {l && <label className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-2">{l}</label>}

      <button type="button" onClick={onToggle}
              className="w-full text-sm bg-white border border-slate-200 rounded-xl p-3.5 text-left flex items-center justify-between shadow-sm hover:border-indigo-400">
        <span className={arr.length ? 'text-indigo-700 font-bold' : 'text-slate-500'}>
          {!arr.length ? placeholder : arr.length === 1 ? (arr[0].label || arr[0]) : `${arr.length} selected`}
        </span>
        <Icon n="Down" size={16} className={`text-slate-400 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {isOpen && (
        <div className="mt-2 w-full bg-white border border-slate-200 rounded-xl shadow-xl max-h-72 flex flex-col absolute z-30 top-full">
          <div className="p-3 border-b border-slate-100 bg-slate-50 shrink-0 relative">
            <Icon n="Search" size={14} className="absolute left-6 top-6 text-slate-400"/>
            <input type="text" placeholder="Search..." value={str} onChange={e => setStr(e.target.value)}
                   className="w-full bg-white border border-slate-200 rounded-lg py-2 pl-9 pr-3 text-sm" />
          </div>
          <div className="overflow-y-auto p-2 flex flex-col gap-1 flex-1 custom-scrollbar">
            {filtered.map(o => {
              const value = o.value || o, label = o.label || o, isSel = arr.includes(value);
              return (
                <label key={value}
                       className={`flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer transition-colors ${isSel ? 'bg-indigo-50' : 'hover:bg-slate-50'}`}>
                  <div className={`w-5 h-5 rounded flex items-center justify-center border transition-colors ${isSel ? 'bg-indigo-600 border-indigo-600 text-white' : 'bg-white border-slate-300 text-transparent'}`}>
                    <Icon n="Check" size={14}/>
                  </div>
                  <input type="checkbox" checked={isSel} onChange={() => toggle(value)} className="hidden" />
                  <span className="text-sm font-medium text-slate-600">{label}</span>
                </label>
              );
            })}
          </div>
          {arr.length > 0 && (
            <div className="border-t border-slate-100 p-2 shrink-0 bg-slate-50">
              <button type="button" onClick={() => onChange([])}
                      className="w-full text-xs font-bold text-red-600 bg-red-50 hover:bg-red-100 py-2 rounded-lg">
                Clear Selection ({arr.length})
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
