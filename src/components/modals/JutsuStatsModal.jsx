import { useMemo } from 'react';
import { BarChart2, X } from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
  PieChart, Pie, Legend,
} from 'recharts';

const NATURES     = ['Fire', 'Water', 'Lightning', 'Earth', 'Wind', 'Yang', 'Yin', 'Sound'];
const RANKS        = ['E', 'D', 'C', 'B', 'A', 'S'];
const JUTSU_TYPES  = ['1 Post', 'Continuous', 'Multi-Post', 'Battlemode'];
const ORIGINS      = ['Canon', 'Custom'];
const BM_TIERS     = ['Primary', 'Secondary', 'Tertiary'];

const NATURE_COLORS = {
  Fire: '#f97316', Water: '#3b82f6', Lightning: '#eab308', Earth: '#ef4444',
  Wind: '#22c55e', Yang: '#f59e0b', Yin: '#a855f7', Sound: '#ec4899',
};
const RANK_COLORS = { E: '#94a3b8', D: '#38bdf8', C: '#34d399', B: '#fbbf24', A: '#fb923c', S: '#f87171' };
const TYPE_COLORS = { '1 Post': '#6366f1', 'Continuous': '#06b6d4', 'Multi-Post': '#8b5cf6', 'Battlemode': '#f43f5e' };
const ORIGIN_COLORS = { Canon: '#10b981', Custom: '#f59e0b' };
const BM_TIER_COLORS = { Primary: '#f43f5e', Secondary: '#fb923c', Tertiary: '#94a3b8' };
const GENERIC_PALETTE = ['#6366f1', '#06b6d4', '#8b5cf6', '#34d399', '#f59e0b', '#ec4899', '#38bdf8', '#a855f7', '#f87171', '#22c55e'];

const toArray = (v) => Array.isArray(v)
  ? v
  : (typeof v === 'string' && v.trim() ? v.split(',').map(s => s.trim()).filter(Boolean) : []);

const TT = {
  contentStyle: { background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: 8, fontSize: 12 },
  labelStyle: { color: '#334155', fontWeight: 700 },
  itemStyle: { color: '#475569' },
};

// Tallies how many jutsus include each value of a multi-value field (a jutsu
// with 3 ranks counts once toward each of those 3 buckets — bucket counts do
// not sum to the total jutsu count).
function tallyMultiValue(jutsus, field, categories) {
  const counts = Object.fromEntries(categories.map(c => [c, 0]));
  jutsus.forEach(j => {
    toArray(j[field]).forEach(v => {
      if (counts[v] === undefined) counts[v] = 0;
      counts[v] += 1;
    });
  });
  return counts;
}

function ChartCard({ title, subtitle, children }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
      <p className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-0.5">{title}</p>
      {subtitle && <p className="text-[10px] text-slate-400 mb-3">{subtitle}</p>}
      {!subtitle && <div className="mb-3" />}
      {children}
    </div>
  );
}

function StatTile({ label, value, sub }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-center">
      <p className="text-xl font-black leading-tight text-slate-800">{value}</p>
      <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mt-0.5">{label}</p>
      {sub && <p className="text-[9px] text-slate-400 mt-0.5">{sub}</p>}
    </div>
  );
}

function BarSection({ title, subtitle, data, colorFor, height = 200, layout, dataKeyName = 'name', dataKeyValue = 'value' }) {
  return (
    <ChartCard title={title} subtitle={subtitle}>
      <ResponsiveContainer width="100%" height={height}>
        <BarChart data={data} layout={layout} barCategoryGap="25%">
          {layout === 'vertical' ? (
            <>
              <XAxis type="number" tick={{ fill: '#94a3b8', fontSize: 10 }} axisLine={false} tickLine={false} allowDecimals={false} />
              <YAxis type="category" dataKey={dataKeyName} tick={{ fill: '#475569', fontSize: 10, fontWeight: 700 }} axisLine={false} tickLine={false} width={100} />
            </>
          ) : (
            <>
              <XAxis dataKey={dataKeyName} tick={{ fill: '#475569', fontSize: 10, fontWeight: 700 }} axisLine={false} tickLine={false} interval={0} angle={-20} textAnchor="end" height={50} />
              <YAxis tick={{ fill: '#94a3b8', fontSize: 10 }} axisLine={false} tickLine={false} allowDecimals={false} />
            </>
          )}
          <Tooltip {...TT} />
          <Bar dataKey={dataKeyValue} radius={layout === 'vertical' ? [0, 4, 4, 0] : [4, 4, 0, 0]}>
            {data.map((d, i) => <Cell key={i} fill={colorFor(d[dataKeyName], i)} fillOpacity={0.85} />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

function PieSection({ title, subtitle, data, colorFor }) {
  return (
    <ChartCard title={title} subtitle={subtitle}>
      <ResponsiveContainer width="100%" height={200}>
        <PieChart>
          <Pie data={data} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={70} innerRadius={36} paddingAngle={3} strokeWidth={0}>
            {data.map((d, i) => <Cell key={i} fill={colorFor(d.name, i)} fillOpacity={0.85} />)}
          </Pie>
          <Tooltip {...TT} />
          <Legend iconType="circle" iconSize={8} formatter={v => <span style={{ color: '#475569', fontSize: 10, fontWeight: 700 }}>{v}</span>} />
        </PieChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

export default function JutsuStatsModal({ db, onClose }) {
  const jutsus = db?.jutsus || [];
  const total = jutsus.length;

  const stats = useMemo(() => {
    if (total === 0) return null;

    const natureCounts = tallyMultiValue(jutsus, 'nature', NATURES);
    const rankCounts    = tallyMultiValue(jutsus, 'rank', RANKS);
    const typeCounts    = tallyMultiValue(jutsus, 'types', JUTSU_TYPES);

    const jutsuTypeTagCategories = [...new Set([...(db?.jutsuTypeTags || []), ...jutsus.flatMap(j => toArray(j.jutsu_type))])];
    const jutsuTypeTagCounts = tallyMultiValue(jutsus, 'jutsu_type', jutsuTypeTagCategories);

    const specCategories = [...new Set([...(db?.specializations || []), ...jutsus.flatMap(j => toArray(j.spec))])];
    const specCounts = tallyMultiValue(jutsus, 'spec', specCategories);

    const originCounts = tallyMultiValue(jutsus, 'origin', ORIGINS);

    const bloodlineCounts = {};
    let noBloodline = 0;
    jutsus.forEach(j => {
      const bl = (j.bloodline || '').trim();
      if (!bl) { noBloodline += 1; return; }
      bloodlineCounts[bl] = (bloodlineCounts[bl] || 0) + 1;
    });
    const topBloodlines = Object.entries(bloodlineCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([name, value]) => ({ name, value }));
    if (noBloodline > 0) topBloodlines.push({ name: 'No Bloodline', value: noBloodline });

    const flagCounts = {
      Locked:    jutsus.filter(j => j.locked).length,
      Limited:   jutsus.filter(j => j.limited).length,
      PvE:       jutsus.filter(j => j.pve).length,
      'Multi-Rank': jutsus.filter(j => j.multiRank).length,
    };

    const battlemodeJutsus = jutsus.filter(j => toArray(j.types).includes('Battlemode'));
    const bmTierCounts = Object.fromEntries(BM_TIERS.map(t => [t, 0]));
    battlemodeJutsus.forEach(j => {
      if (j.bm_tier && bmTierCounts[j.bm_tier] !== undefined) bmTierCounts[j.bm_tier] += 1;
    });

    const customTagCounts = {};
    jutsus.forEach(j => {
      toArray(j.custom_tags).forEach(tag => {
        const key = tag.trim();
        if (!key) return;
        const norm = key.toLowerCase();
        customTagCounts[norm] = customTagCounts[norm] || { label: key, count: 0 };
        customTagCounts[norm].count += 1;
      });
    });
    const topCustomTags = Object.values(customTagCounts)
      .sort((a, b) => b.count - a.count)
      .slice(0, 10)
      .map(t => ({ name: t.label, value: t.count }));

    return {
      natureData: NATURES.map(n => ({ name: n, value: natureCounts[n] })),
      rankData: RANKS.map(r => ({ name: r, value: rankCounts[r] })),
      typeData: JUTSU_TYPES.map(t => ({ name: t, value: typeCounts[t] })),
      jutsuTypeTagData: jutsuTypeTagCategories.map(t => ({ name: t, value: jutsuTypeTagCounts[t] })).sort((a, b) => b.value - a.value),
      specData: specCategories.map(s => ({ name: s, value: specCounts[s] })).sort((a, b) => b.value - a.value),
      originData: ORIGINS.map(o => ({ name: o, value: originCounts[o] })).filter(d => d.value > 0),
      topBloodlines,
      flagCounts,
      battlemodeCount: battlemodeJutsus.length,
      bmTierData: BM_TIERS.map(t => ({ name: t, value: bmTierCounts[t] })).filter(d => d.value > 0),
      topCustomTags,
    };
  }, [jutsus, db?.jutsuTypeTags, db?.specializations, total]);

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4 animate-in fade-in" onClick={onClose}>
      <div className="bg-white rounded-3xl max-w-5xl w-full overflow-hidden max-h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="bg-slate-900 text-white p-5 flex justify-between shrink-0">
          <div className="flex items-center gap-2">
            <BarChart2 size={20} className="text-indigo-400" />
            <h3 className="font-bold text-lg">Jutsu Statistics</h3>
          </div>
          <button onClick={onClose}><X size={18} /></button>
        </div>

        <div className="p-6 overflow-y-auto custom-scrollbar space-y-6">
          {total === 0 || !stats ? (
            <p className="text-sm text-slate-500 italic text-center py-12">No jutsus yet — statistics will appear once the catalog is populated.</p>
          ) : (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                <StatTile label="Total Jutsus" value={total} />
                <StatTile label="Locked" value={stats.flagCounts.Locked} sub={`${Math.round(stats.flagCounts.Locked / total * 100)}%`} />
                <StatTile label="Limited" value={stats.flagCounts.Limited} sub={`${Math.round(stats.flagCounts.Limited / total * 100)}%`} />
                <StatTile label="PvE" value={stats.flagCounts.PvE} sub={`${Math.round(stats.flagCounts.PvE / total * 100)}%`} />
                <StatTile label="Multi-Rank" value={stats.flagCounts['Multi-Rank']} sub={`${Math.round(stats.flagCounts['Multi-Rank'] / total * 100)}%`} />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <BarSection title="By Nature" data={stats.natureData} colorFor={(n) => NATURE_COLORS[n] || '#94a3b8'} />
                <BarSection
                  title="By Rank"
                  subtitle="A jutsu spanning multiple ranks counts toward each"
                  data={stats.rankData}
                  colorFor={(r) => RANK_COLORS[r] || '#94a3b8'}
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <PieSection title="By Jutsu Category" data={stats.typeData.filter(d => d.value > 0)} colorFor={(t) => TYPE_COLORS[t] || '#94a3b8'} />
                <PieSection title="By Origin" data={stats.originData} colorFor={(o) => ORIGIN_COLORS[o] || '#94a3b8'} />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <BarSection
                  title="By Jutsu Type"
                  subtitle="A jutsu with multiple tags counts toward each"
                  data={stats.jutsuTypeTagData}
                  layout="vertical"
                  height={Math.max(140, stats.jutsuTypeTagData.length * 32)}
                  colorFor={(_, i) => GENERIC_PALETTE[i % GENERIC_PALETTE.length]}
                />
                <BarSection
                  title="By Specialization"
                  subtitle="A jutsu with multiple specializations counts toward each"
                  data={stats.specData}
                  layout="vertical"
                  height={Math.max(140, stats.specData.length * 32)}
                  colorFor={(_, i) => GENERIC_PALETTE[i % GENERIC_PALETTE.length]}
                />
              </div>

              {stats.topBloodlines.length > 0 && (
                <BarSection
                  title="Bloodline-Linked Jutsus"
                  subtitle="Top bloodlines by jutsu count"
                  data={stats.topBloodlines}
                  layout="vertical"
                  height={Math.max(140, stats.topBloodlines.length * 32)}
                  colorFor={(_, i) => GENERIC_PALETTE[i % GENERIC_PALETTE.length]}
                />
              )}

              {stats.battlemodeCount > 0 && (
                <PieSection
                  title="Battlemode Tier"
                  subtitle={`Among ${stats.battlemodeCount} Battlemode jutsus`}
                  data={stats.bmTierData}
                  colorFor={(t) => BM_TIER_COLORS[t] || '#94a3b8'}
                />
              )}

              {stats.topCustomTags.length > 0 && (
                <BarSection
                  title="Top Custom Tags"
                  subtitle="Freeform staff tags — not a controlled vocabulary, so this list is illustrative, not exhaustive"
                  data={stats.topCustomTags}
                  layout="vertical"
                  height={Math.max(140, stats.topCustomTags.length * 32)}
                  colorFor={(_, i) => GENERIC_PALETTE[i % GENERIC_PALETTE.length]}
                />
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
