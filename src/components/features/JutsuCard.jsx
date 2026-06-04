import React, { useState } from 'react';
import Icon from '../ui/Icon';
import { getSlotStatus, getNatureColor, toArray } from '../../utils/helpers';
import { RANK_COST_MAP, RANK_COST_NUM } from '../../constants/catalog';

/* ============================================================================
   COMPONENT: JutsuCard
   UPDATED: Clean layout, proper rounded corners, inset rank/cost box.
   ============================================================================ */
export function JutsuCard({ j, viewMode, expRow, setExpRow, pTags, setPersonalTagsForJutsu, handleCopy, cart, copiedId, isAdmin, onEdit, onDelete, onViewSlots, isActualAdmin = false }) {
  const isExpanded = viewMode === 'card' || expRow === j._id;
  const rArr  = toArray(j.rank).slice().sort((a, b) => (RANK_COST_NUM[a] || 0) - (RANK_COST_NUM[b] || 0));
  const tArr  = toArray(j.types);
  const cTags = toArray(j.custom_tags);
  const isBm  = tArr.includes('Battlemode');
  const { showAskStaff, remaining } = getSlotStatus(j.slots);
  const myTags = pTags[j._id] || [];
  const inList = cart.some(x => x._id === j._id);

  const [tagging, setTagging]   = useState(false);
  const [tagInput, setTagInput] = useState('');

  const topTags = [
    ...toArray(j.nature).filter(n => n && n !== 'N/A').map(n => ({ l: n, c: getNatureColor(n) })),
    j.origin                       && { l: j.origin, c: j.origin === 'Canon' ? 'bg-indigo-50 text-indigo-700 border-indigo-200' : 'bg-cyan-50 text-cyan-700 border-cyan-200' },
    j.locked                       && { l: 'Locked',   ic: 'Lock',  c: 'bg-amber-50 text-amber-700 border-amber-300' },
    j.limited &&  showAskStaff     && { l: 'Ask Reviewer',          c: 'bg-amber-100 text-amber-800 border-amber-300' },
    j.limited && !showAskStaff     && { l: 'Limited',  ic: 'Alert', c: 'bg-rose-100 text-rose-800 border-rose-200' },
    j.limited && j.slots           && { l: remaining > 0 ? `${remaining} open` : 'Full',
                                        c: remaining > 0 ? 'bg-emerald-100 text-emerald-800 border-emerald-200' : 'bg-red-100 text-red-800 border-red-200' },
  ].filter(Boolean);

  /* ---- Collapsed row ---- */
  if (!isExpanded) {
    const firstNat = toArray(j.nature)[0];
    return (
      <div onClick={() => setExpRow(j._id)}
           className={`bg-white rounded-xl shadow-sm border px-4 py-3 flex items-center justify-between cursor-pointer hover:bg-slate-50 transition-all ${j.locked ? 'border-amber-300' : 'border-slate-200'} relative group`}>
        <div className="flex items-center gap-4 flex-1 overflow-hidden pr-20">
          <span className={`w-3 h-3 rounded-full shrink-0 ${firstNat && firstNat !== 'N/A' ? getNatureColor(firstNat).split(' ')[0].replace('100', '400') : 'bg-slate-200'}`} />
          <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-3 flex-1 overflow-hidden">
            <h3 className="font-bold text-slate-800 text-sm truncate flex items-center gap-2">
              {j.locked && <Icon n="Lock" size={12} className="text-amber-500 shrink-0" />}{j.name}
            </h3>
            <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-400 shrink-0">
              {isBm && j.bm_tier ? (
                <span className="px-1.5 py-0.5 rounded-md bg-slate-100 border border-slate-200 text-slate-600">
                  {`${j.bm_tier} (${rArr[0] || '-'})`}
                </span>
              ) : (
                <div className="flex gap-0.5">
                  {rArr.length > 0
                    ? rArr.map((r, i) => <span key={i} className="px-1.5 py-0.5 rounded bg-slate-100 border border-slate-200 text-slate-600">{r}</span>)
                    : <span className="px-1.5 py-0.5 rounded bg-slate-100 border border-slate-200 text-slate-600">-</span>}
                </div>
              )}
              {tArr[0] && <span className="hidden sm:inline px-1.5 py-0.5 rounded-md bg-transparent">{tArr[0]}</span>}
            </div>
          </div>
        </div>
        <div className="flex items-center shrink-0 pl-4">
          {j.limited && showAskStaff
            ? <span className="text-[10px] font-bold uppercase text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded border border-amber-200 hidden sm:inline mr-3">Ask Reviewer</span>
            : (j.limited && <span className="text-[10px] font-bold uppercase text-red-500 bg-red-50 px-1.5 py-0.5 rounded hidden sm:inline mr-3">Limited</span>)}
          <Icon n="Down" size={18} className="text-slate-300"/>
        </div>
        {isAdmin && (
          <div className="absolute right-12 top-1/2 -translate-y-1/2 flex gap-1 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity bg-white p-1 rounded-lg border shadow-sm shrink-0">
            <button onClick={(e) => { e.stopPropagation(); onEdit(); }}   className="p-1 text-indigo-600 hover:bg-indigo-50 rounded"><Icon n="Edit"  size={14}/></button>
            <button onClick={(e) => { e.stopPropagation(); onDelete(); }} className="p-1 text-red-600    hover:bg-red-50    rounded"><Icon n="Trash" size={14}/></button>
          </div>
        )}
      </div>
    );
  }

  /* ---- Expanded card ---- */
  return (
    <div className={`bg-white rounded-2xl shadow-sm border ${j.locked ? 'border-amber-300 shadow-amber-500/10' : 'border-slate-200'} flex flex-col relative overflow-hidden transition-all hover:shadow-md h-full`}>
      {/* Top absolute controls */}
      {viewMode === 'row' && (
        <button onClick={(e) => { e.stopPropagation(); setExpRow(null); }}
                className="absolute top-4 right-4 text-slate-400 hover:text-slate-700 bg-slate-100 p-1.5 rounded-full z-10">
          <Icon n="Up" size={16} />
        </button>
      )}
      {isAdmin && (
        <div className={`absolute top-4 ${viewMode === 'row' ? 'right-14' : 'right-4'} flex gap-1 bg-white p-1 rounded-lg border shadow-sm z-10`}>
          <button onClick={(e) => { e.stopPropagation(); onEdit(); }}   className="p-1.5 text-indigo-600 hover:bg-indigo-50 rounded-md"><Icon n="Edit"  size={14}/></button>
          <button onClick={(e) => { e.stopPropagation(); onDelete(); }} className="p-1.5 text-red-600    hover:bg-red-50    rounded-md"><Icon n="Trash" size={14}/></button>
        </div>
      )}

      {/* Main Content Area */}
      <div className="p-5 flex-1 flex flex-col">
        {/* Title */}
        <h2 className="text-xl font-extrabold text-slate-900 leading-tight mb-3 pr-24 tracking-tight">{j.name}</h2>

        {/* Top Badges (Nature, Origin, Locked) */}
        <div className="flex flex-wrap gap-2 mb-4">
          {topTags.map((t, i) => (
            <span key={i} className={`px-2 py-1 rounded-md text-[10px] font-extrabold uppercase tracking-wide border flex items-center gap-1.5 ${t.c}`}>
              {t.ic && <Icon n={t.ic} size={11}/>} {t.l}
            </span>
          ))}
        </div>

        {/* Specs, Types, Bloodlines, Personal Tags */}
        <div className="flex flex-wrap gap-1.5 mb-5 items-center">
          {[...toArray(j.spec), ...tArr, ...cTags].map((s, i) => (
            <span key={i} className="text-xs font-semibold text-slate-600 bg-slate-50 px-2.5 py-1 rounded-md border border-slate-200">
              {s}
            </span>
          ))}
          {j.bloodline && (
            <span className="text-xs font-bold text-purple-700 bg-purple-50 px-2.5 py-1 rounded-md border border-purple-200 flex items-center gap-1.5 shadow-sm">
              <Icon n="Tag" size={12}/> {j.bloodline}
            </span>
          )}
          {myTags.map(t => (
            <span key={t} className="group text-xs font-bold text-indigo-700 bg-indigo-50 px-2.5 py-1 rounded-md border border-indigo-200 flex items-center gap-1.5 shadow-sm">
              {t}
              {isActualAdmin && (
                <button onClick={() => setPersonalTagsForJutsu(j._id, myTags.filter(x => x !== t))}
                        className="opacity-40 hover:text-red-600 hover:opacity-100 transition-opacity">×</button>
              )}
            </span>
          ))}
          
          {/* Tag Add Button */}
          {isActualAdmin && (
            tagging ? (
              <form onSubmit={(e) => {
                e.preventDefault();
                const v = tagInput.trim();
                if (v && !myTags.includes(v)) setPersonalTagsForJutsu(j._id, [...myTags, v]);
                setTagging(false); setTagInput('');
              }} className="inline-block">
                <input autoFocus value={tagInput} onChange={e => setTagInput(e.target.value)}
                       onBlur={() => { setTagging(false); setTagInput(''); }}
                       onKeyDown={e => { if (e.key === 'Escape') { setTagging(false); setTagInput(''); } }}
                       className="text-xs px-2 py-0.5 border-2 border-indigo-300 rounded-md outline-none w-24 bg-white shadow-sm"
                       placeholder="Type & Enter" />
              </form>
            ) : (
              <button onClick={(e) => { e.stopPropagation(); setTagging(true); }}
                      className="text-xs font-semibold text-indigo-500 hover:bg-indigo-50 border border-dashed border-indigo-200 px-2.5 py-1 rounded-md flex items-center gap-1 transition-colors">
                <Icon n="Plus" size={11}/> Tag
              </button>
            )
          )}
        </div>

        {/* Pushes footer to the bottom */}
        <div className="mt-auto flex flex-col gap-4">
          
          {/* INSET BOX: Rank / Cost */}
          <div className="bg-slate-50/70 border border-slate-100 rounded-xl p-3.5 flex flex-wrap items-center justify-between gap-4">
            
            <div className="flex items-center gap-5 flex-wrap">
              {/* Rank Block */}
              <div>
                <div className="text-[9px] font-bold text-slate-400 uppercase tracking-widest mb-1.5">Rank</div>
                {isBm && j.bm_tier ? (
                  <div className="text-[13px] font-black text-slate-700">{`${j.bm_tier} (${rArr[0] || '-'})`}</div>
                ) : (
                  <div className="flex items-center gap-1.5 flex-wrap">
                    {rArr.length > 0
                      ? rArr.map((r, i) => <span key={i} className="px-2 py-0.5 bg-slate-200 text-slate-700 rounded-md text-xs font-black border border-slate-300 shadow-sm">{r}</span>)
                      : <span className="text-sm font-black text-slate-700">-</span>}
                  </div>
                )}
              </div>

              {/* Separator */}
              {!isBm && <div className="hidden sm:block w-px h-8 bg-slate-200 rounded-full" />}

              {/* Cost Block */}
              {!isBm && (
                <div>
                  <span className="text-[9px] font-bold text-slate-400 uppercase tracking-widest mb-1.5 block">Cost</span>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    {j.cost ? (
                      <span className="px-2 py-0.5 bg-indigo-50 border border-indigo-100 text-indigo-600 rounded-md text-xs font-black shadow-sm">{j.cost}</span>
                    ) : rArr.length > 0 ? (
                      rArr.map((r, i) => (
                        <span key={i} className="px-2 py-0.5 bg-indigo-50 border border-indigo-100 text-indigo-600 rounded-md text-xs font-black shadow-sm">
                          {RANK_COST_MAP[r] || '-'}
                        </span>
                      ))
                    ) : <span className="text-sm font-black text-indigo-600">-</span>}
                  </div>
                </div>
              )}
            </div>

            {/* Multi-Rank Badge */}
            {j.multiRank && !isBm && (
              <span className="text-[10px] font-extrabold text-indigo-500 border border-indigo-200 bg-white px-2 py-1 rounded-full uppercase tracking-wider shadow-sm ml-auto">Multi-Rank</span>
            )}
          </div>

          {/* Action Buttons (Footer) */}
          <div className="flex gap-2">
            {j.link && j.link !== '#' ? (
              <a href={j.link} target="_blank" rel="noopener noreferrer"
                 className="flex-1 bg-white border border-slate-200 text-indigo-700 hover:text-indigo-800 hover:border-indigo-300 hover:bg-indigo-50 font-bold py-2.5 rounded-xl flex justify-center items-center gap-2 transition-colors shadow-sm">
                <Icon n="ExtLink" size={16}/> Doc
              </a>
            ) : (
              <span className="flex-1 bg-slate-50 text-slate-400 font-bold py-2.5 rounded-xl flex justify-center text-sm border border-slate-100">No Doc</span>
            )}
            
            {j.limited && (
              <button onClick={(e) => { e.stopPropagation(); onViewSlots && onViewSlots(j); }}
                      className="p-2.5 rounded-xl border bg-white border-slate-200 text-slate-600 hover:bg-indigo-50 hover:text-indigo-700 hover:border-indigo-200 flex items-center justify-center min-w-[50px] transition-colors shadow-sm"
                      title="View slot holders">
                <Icon n="Eye" size={18}/>
              </button>
            )}
            
            <button onClick={(e) => { e.stopPropagation(); handleCopy(j); }}
                    className={`p-2.5 rounded-xl border flex items-center justify-center min-w-[50px] transition-colors shadow-sm ${
                      copiedId === j._id ? 'bg-emerald-500 border-emerald-500 text-white'
                      : inList ? 'bg-indigo-50 border-indigo-200 text-indigo-700 hover:bg-indigo-100'
                      : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50 hover:border-slate-300'
                    }`}
                    title={inList ? 'In Session List' : 'Add to Session List'}>
              {copiedId === j._id ? <Icon n="Check" size={18}/> : inList ? <Icon n="CheckCir" size={18}/> : <Icon n="Copy" size={18}/>}
            </button>
          </div>
          
        </div>
      </div>
    </div>
  );
}

export default JutsuCard;
