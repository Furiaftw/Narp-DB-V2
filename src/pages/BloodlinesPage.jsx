import { useState, useMemo } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
  PieChart, Pie, Legend,
} from 'recharts';
import { Icon } from '../components/ui/Icon';
import { getSlotStatus } from '../utils/helpers';
import { BL_CATS } from '../constants/catalog';

/* ============================================================================
   BLOODLINES VIEW  (route: /bloodlines)
   The bloodline roster cards plus the breakdown charts above them.
   ============================================================================ */

export function BloodlineRosterCard({ bl, isAdmin, onEdit }) {
  const { remaining, total, parsed } = getSlotStatus(bl.slots);
  const hasSlots = total > 0;
  const effectiveMax = hasSlots ? total : (bl.max_slots || 0);
  const filledCount = hasSlots ? (total - remaining) : 0;
  const isUnlimitedBl = Number(bl.max_slots) === -1 || (bl.name || '').trim().toLowerCase() === 'clanless';

  let badgeClass = null, badgeLabel = null;
  if (isUnlimitedBl) {
    badgeClass = 'bg-emerald-100 text-emerald-800 border-emerald-200';
    badgeLabel = 'Open · Unlimited';
  } else if (effectiveMax > 0) {
    if (hasSlots && remaining === 0) {
      badgeClass = 'bg-red-100 text-red-800 border-red-200';
      badgeLabel = 'Full';
    } else if (hasSlots && remaining <= 2) {
      badgeClass = 'bg-amber-100 text-amber-800 border-amber-200';
      badgeLabel = 'Ask a Reviewer';
    } else {
      badgeClass = 'bg-emerald-100 text-emerald-800 border-emerald-200';
      badgeLabel = `Open · ${effectiveMax - filledCount} left`;
    }
  }

  const filledSlots = parsed.filter(s => s?.username);

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm flex flex-col overflow-hidden">
      <div className="p-4 flex-1">
        <div className="flex items-start justify-between gap-2 mb-3">
          <h3 className="font-bold text-slate-900 text-sm leading-tight">{bl.name}</h3>
          {isAdmin && (
            <button onClick={onEdit} className="shrink-0 text-slate-400 hover:text-indigo-600 transition-colors p-0.5">
              <Icon n="Edit" size={14} />
            </button>
          )}
        </div>

        <div className="flex flex-wrap gap-1.5 mb-3">
          {bl.link && (
            <a href={bl.link} target="_blank" rel="noopener noreferrer"
               className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest px-2.5 py-1 bg-indigo-50 text-indigo-700 border border-indigo-200 rounded-lg hover:bg-indigo-100 transition-colors">
              <Icon n="ExtLink" size={10} /> Doc
            </a>
          )}
          {bl.proprietary_ability_link && (
            <a href={bl.proprietary_ability_link} target="_blank" rel="noopener noreferrer"
               className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest px-2.5 py-1 bg-purple-50 text-purple-700 border border-purple-200 rounded-lg hover:bg-purple-100 transition-colors">
              <Icon n="ExtLink" size={10} /> Exclusive Ability
            </a>
          )}
        </div>

        {badgeLabel && (
          <div className="mb-3">
            <span className={`inline-flex items-center text-[10px] font-extrabold uppercase tracking-widest px-2.5 py-1 rounded-full border ${badgeClass}`}>
              {badgeLabel}
            </span>
          </div>
        )}

        {filledSlots.length > 0 && (
          <div className="space-y-1">
            {filledSlots.map((slot, i) => (
              <div key={i} className="text-xs text-slate-600 flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-slate-400 shrink-0" />
                {slot.discord_link ? (
                  <a href={slot.discord_link} target="_blank" rel="noopener noreferrer" className="text-indigo-700 hover:underline font-medium truncate">
                    {slot.username}
                  </a>
                ) : (
                  <span className="font-medium truncate">{slot.username}</span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="px-4 py-2 border-t border-slate-100 bg-slate-50">
        <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">{bl.category}</span>
      </div>
    </div>
  );
}

/* ---- Bloodline stat charts (same visual language as JutsuStatsModal) ------ */
export const BL_ORIGIN_COLORS = { Canon: '#10b981', Custom: '#f59e0b' };
export const BL_SUBCAT_COLORS = { Dojutsu: '#a855f7', 'Kekkei Genkai': '#6366f1', Hiden: '#f43f5e', Specialization: '#06b6d4', Other: '#94a3b8' };
export const BL_GENERIC_PALETTE = ['#6366f1', '#06b6d4', '#8b5cf6', '#34d399', '#f59e0b', '#ec4899', '#38bdf8', '#a855f7', '#f87171', '#22c55e'];

export const BL_TT = {
  contentStyle: { background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: 8, fontSize: 12 },
  labelStyle: { color: '#334155', fontWeight: 700 },
  itemStyle: { color: '#475569' },
};

export function BLChartCard({ title, subtitle, children }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
      <p className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-0.5">{title}</p>
      {subtitle && <p className="text-[10px] text-slate-400 mb-3">{subtitle}</p>}
      {!subtitle && <div className="mb-3" />}
      {children}
    </div>
  );
}

export function BLBarSection({ title, subtitle, data, colorFor }) {
  return (
    <BLChartCard title={title} subtitle={subtitle}>
      <ResponsiveContainer width="100%" height={200}>
        <BarChart data={data} barCategoryGap="25%">
          <XAxis dataKey="name" tick={{ fill: '#475569', fontSize: 10, fontWeight: 700 }} axisLine={false} tickLine={false} interval={0} angle={-20} textAnchor="end" height={50} />
          <YAxis tick={{ fill: '#94a3b8', fontSize: 10 }} axisLine={false} tickLine={false} allowDecimals={false} />
          <Tooltip {...BL_TT} />
          <Bar dataKey="value" radius={[4, 4, 0, 0]}>
            {data.map((d, i) => <Cell key={i} fill={colorFor(d.name, i)} fillOpacity={0.85} />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </BLChartCard>
  );
}

export function BLPieSection({ title, subtitle, data, colorFor }) {
  return (
    <BLChartCard title={title} subtitle={subtitle}>
      <ResponsiveContainer width="100%" height={200}>
        <PieChart>
          <Pie data={data} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={70} innerRadius={36} paddingAngle={3} strokeWidth={0}>
            {data.map((d, i) => <Cell key={i} fill={colorFor(d.name, i)} fillOpacity={0.85} />)}
          </Pie>
          <Tooltip {...BL_TT} />
          <Legend iconType="circle" iconSize={8} formatter={v => <span style={{ color: '#475569', fontSize: 10, fontWeight: 700 }}>{v}</span>} />
        </PieChart>
      </ResponsiveContainer>
    </BLChartCard>
  );
}

/* ============================================================================
   COMPONENT: BloodlinesRosterTab
   ============================================================================ */
export function BloodlinesRosterTab({ bloodlines, isAdmin, onEdit, bF, setBF }) {
  const ORDER = ['Dojutsu', 'KKG', 'Hiden', 'Specialization', 'Other'];
  const SUBCAT_LABELS = { Dojutsu: 'Dojutsu', KKG: 'Kekkei Genkai', Hiden: 'Hiden', Specialization: 'Specialization', Other: 'Other' };

  const [filtersOpen, setFiltersOpen] = useState(false);
  const [statsOpen, setStatsOpen] = useState(false);

  const toggleCat = (v) => setBF(p => ({ ...p, cat: p.cat.includes(v) ? p.cat.filter(x => x !== v) : [...p.cat, v] }));
  const toggleSub = (v) => setBF(p => ({ ...p, sub: p.sub.includes(v) ? p.sub.filter(x => x !== v) : [...p.sub, v] }));
  const activeCount = (bF?.cat?.length || 0) + (bF?.sub?.length || 0) + (bF?.q ? 1 : 0);

  // Whole-database statistics (not affected by the filters)
  const blStats = useMemo(() => {
    const all = bloodlines || [];
    const bySub = ORDER.reduce((acc, s) => ({ ...acc, [s]: 0 }), {});
    all.forEach(b => { bySub[ORDER.includes(b.subcategory) ? b.subcategory : 'Other'] += 1; });
    const canon = all.filter(b => b.category === 'Canon').length;
    const custom = all.filter(b => b.category === 'Custom').length;
    return {
      total:  all.length,
      canon,
      custom,
      bySub,
      originData: [{ name: 'Canon', value: canon }, { name: 'Custom', value: custom }],
      subcatData: ORDER.map(s => ({ name: SUBCAT_LABELS[s], value: bySub[s] })),
    };
  }, [bloodlines]);

  const filtB = useMemo(() => {
    let list = bloodlines || [];
    if (bF?.q) {
      const q = bF.q.toLowerCase();
      list = list.filter(b => b.name?.toLowerCase().includes(q) || (b.custom_tags || []).some(t => t.toLowerCase().includes(q)));
    }
    if (bF?.cat?.length) list = list.filter(b => bF.cat.includes(b.category));
    if (bF?.sub?.length) list = list.filter(b => bF.sub.includes(b.subcategory));
    if (bF?.srt === 'za') return [...list].sort((a, b) => b.name.localeCompare(a.name));
    if (bF?.srt === 'newest') return [...list].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    return [...list].sort((a, b) => a.name.localeCompare(b.name));
  }, [bloodlines, bF]);

  const grouped = ORDER.reduce((acc, sub) => {
    acc[sub] = filtB.filter(b => b.subcategory === sub);
    return acc;
  }, {});

  const uncategorized = filtB.filter(b => !ORDER.includes(b.subcategory));
  if (uncategorized.length) grouped['Other'] = [...(grouped['Other'] || []), ...uncategorized];

  if (!bloodlines || bloodlines.length === 0) {
    return (
      <div className="max-w-6xl mx-auto text-center py-16">
        <Icon n="Alert" size={40} className="text-slate-300 mx-auto mb-3" />
        <p className="text-slate-500 font-semibold">No bloodlines in the database yet.</p>
      </div>
    );
  }

  const STAT_TILES = [
    { label: 'Total',                     value: blStats.total,                 accent: 'text-slate-800' },
    { label: 'Canon',                     value: blStats.canon,                 accent: 'text-indigo-600' },
    { label: 'Custom',                    value: blStats.custom,                accent: 'text-purple-600' },
    ...ORDER.map(s => ({ label: SUBCAT_LABELS[s], value: blStats.bySub[s], accent: 'text-slate-800' })),
  ];

  return (
    <div className="max-w-6xl mx-auto space-y-8">
      {/* Bloodline statistics */}
      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm">
        <button onClick={() => setStatsOpen(o => !o)}
                className="w-full flex items-center justify-between p-4 text-left">
          <span className="flex items-center gap-2 text-xs font-bold text-slate-500 uppercase tracking-widest">
            <Icon n="Info" size={14} className="text-indigo-400" /> Bloodline Statistics
          </span>
          <Icon n={statsOpen ? 'Up' : 'Down'} size={16} className="text-slate-400" />
        </button>
        {statsOpen && (
          <div className="px-4 pb-4 space-y-4">
            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3">
              {STAT_TILES.map(tile => (
                <div key={tile.label} className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-center">
                  <p className={`text-xl font-black leading-tight ${tile.accent}`}>{tile.value}</p>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mt-0.5">{tile.label}</p>
                </div>
              ))}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <BLPieSection
                title="Canon vs. Custom"
                subtitle="Share of the bloodline database"
                data={blStats.originData}
                colorFor={(name) => BL_ORIGIN_COLORS[name] || BL_GENERIC_PALETTE[0]}
              />
              <BLBarSection
                title="By Subcategory"
                subtitle="Bloodlines per classification"
                data={blStats.subcatData}
                colorFor={(name, i) => BL_SUBCAT_COLORS[name] || BL_GENERIC_PALETTE[i % BL_GENERIC_PALETTE.length]}
              />
            </div>
          </div>
        )}
      </div>

      {/* Filter row (foldable) */}
      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm">
        <button onClick={() => setFiltersOpen(o => !o)}
                className="w-full flex items-center justify-between p-4 text-left">
          <span className="flex items-center gap-2 text-xs font-bold text-slate-500 uppercase tracking-widest">
            <Icon n="Filter" size={14} className="text-indigo-400" /> Filters
            {activeCount > 0 && (
              <span className="px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-700 text-[10px] font-black tracking-normal normal-case">
                {activeCount} active
              </span>
            )}
          </span>
          <Icon n={filtersOpen ? 'Up' : 'Down'} size={16} className="text-slate-400" />
        </button>
        {filtersOpen && (
        <div className="px-4 pb-4 space-y-4">
        <div className="flex flex-wrap gap-3 items-center">
          {/* Search */}
          <div className="relative flex-1 min-w-[160px]">
            <Icon n="Search" size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
            <input
              type="text"
              value={bF?.q || ''}
              onChange={e => setBF(p => ({ ...p, q: e.target.value }))}
              placeholder="Search bloodlines..."
              className="w-full pl-8 pr-3 py-2 text-sm border border-slate-200 rounded-xl bg-white text-slate-800 focus:outline-none focus:border-indigo-400"
            />
          </div>
          {/* Sort */}
          <select
            value={bF?.srt || 'az'}
            onChange={e => setBF(p => ({ ...p, srt: e.target.value }))}
            className="text-sm border border-slate-200 rounded-xl px-3 py-2 bg-white text-slate-700 focus:outline-none focus:border-indigo-400"
          >
            <option value="az">Name (A-Z)</option>
            <option value="za">Name (Z-A)</option>
            <option value="newest">Newest First</option>
          </select>
          {/* Clear */}
          {activeCount > 0 && (
            <button
              onClick={() => setBF({ q: '', cat: [], sub: [], srt: bF?.srt || 'az' })}
              className="text-xs font-bold text-indigo-600 hover:text-indigo-800 px-3 py-2 rounded-xl hover:bg-indigo-50 transition-colors border border-indigo-200"
            >
              Clear ({activeCount})
            </button>
          )}
        </div>
        {/* Category chips */}
        <div className="flex flex-wrap gap-2">
          <span className="text-xs font-bold text-slate-400 uppercase tracking-widest self-center mr-1">Type:</span>
          {BL_CATS.map(c => (
            <button key={c} onClick={() => toggleCat(c)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all border ${
                bF?.cat?.includes(c) ? 'bg-indigo-100 border-indigo-300 text-indigo-800 shadow-sm' : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
              }`}>
              {c}
            </button>
          ))}
        </div>
        {/* Subcategory chips */}
        <div className="flex flex-wrap gap-2">
          <span className="text-xs font-bold text-slate-400 uppercase tracking-widest self-center mr-1">Category:</span>
          {ORDER.map(s => (
            <button key={s} onClick={() => toggleSub(s)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all border ${
                bF?.sub?.includes(s) ? 'bg-indigo-100 border-indigo-300 text-indigo-800 shadow-sm' : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
              }`}>
              {SUBCAT_LABELS[s]}
            </button>
          ))}
        </div>
        </div>
        )}
      </div>

      {filtB.length === 0 ? (
        <div className="text-center py-12">
          <Icon n="Search" size={36} className="text-slate-300 mx-auto mb-3" />
          <p className="text-slate-500 font-semibold">No bloodlines match your filters.</p>
          <button onClick={() => setBF({ q: '', cat: [], sub: [], srt: bF?.srt || 'az' })} className="mt-3 text-sm text-indigo-600 hover:underline">Clear filters</button>
        </div>
      ) : (
        ORDER.map(sub => {
          const items = grouped[sub];
          if (!items || items.length === 0) return null;
          return (
            <div key={sub}>
              <div className="flex items-center gap-3 mb-4">
                <h2 className="text-xs font-bold text-slate-400 uppercase tracking-widest">{SUBCAT_LABELS[sub]}</h2>
                <div className="flex-1 h-px bg-slate-200" />
                <span className="text-xs font-bold text-slate-400">{items.length}</span>
              </div>
              <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {items.map(bl => (
                  <BloodlineRosterCard key={bl._id} bl={bl} isAdmin={isAdmin} onEdit={() => onEdit(bl)} />
                ))}
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}

export default BloodlinesRosterTab;
