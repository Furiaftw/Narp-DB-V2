import { useState, useEffect, useMemo } from 'react';
import { Loader2, BarChart2 } from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
} from 'recharts';
import { fetchWorkLogMonthly } from '../lib/supabase';

const ACTION_TYPES = ['Solo Approver', 'Second Reviewer', 'First Reviewer', 'Direct Upload', 'Denied'];
const ACTION_COLORS = {
  'Solo Approver':   '#34d399',
  'Second Reviewer': '#38bdf8',
  'First Reviewer':  '#facc15',
  'Direct Upload':   '#a78bfa',
  'Denied':          '#f87171',
};

const TT = {
  contentStyle: { background: '#0f172a', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 4, fontSize: 11 },
  labelStyle: { color: '#94a3b8', fontWeight: 700 },
  itemStyle: { color: '#e2e8f0' },
};

function isAdminRole(role) { return role === 'admin' || role === 'owner'; }

function monthOptions(count = 12) {
  const opts = [];
  const now = new Date();
  for (let i = 0; i < count; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
    const label = d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    opts.push({ value, label });
  }
  return opts;
}

const totalFor = (rows) => rows.reduce((s, r) => s + r.count, 0);

export default function WorkStatsPage({ userId, userRole }) {
  const admin = isAdminRole(userRole);
  const months = useMemo(() => monthOptions(12), []);
  const [monthStart, setMonthStart] = useState(months[0].value);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchWorkLogMonthly(monthStart, { all: admin, userId })
      .then(data => { if (!cancelled) setRows(data); })
      .catch(err => {
        console.warn('[NARP] fetchWorkLogMonthly failed:', err);
        if (!cancelled) setRows([]);
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [monthStart, admin, userId]);

  const myRows = useMemo(() => rows.filter(r => r.user_id === userId), [rows, userId]);
  const myTotal = totalFor(myRows);
  const myBreakdown = ACTION_TYPES.map(a => ({
    name: a,
    value: myRows.find(r => r.action_type === a)?.count || 0,
  }));

  const leaderboard = useMemo(() => {
    if (!admin) return [];
    const byUser = new Map();
    rows.forEach(r => {
      const cur = byUser.get(r.user_id) || { user_id: r.user_id, username: r.username, role: r.role, total: 0, byAction: {} };
      cur.total += r.count;
      cur.byAction[r.action_type] = (cur.byAction[r.action_type] || 0) + r.count;
      byUser.set(r.user_id, cur);
    });
    return [...byUser.values()].sort((a, b) => b.total - a.total);
  }, [rows, admin]);

  const serverTotal = totalFor(rows);

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: '#020408' }}>
      <Loader2 size={24} className="animate-spin text-slate-600" />
    </div>
  );

  return (
    <div className="min-h-screen text-slate-200 font-sans overflow-x-hidden"
         style={{ background: 'radial-gradient(ellipse at 20% 0%, rgba(15,25,20,1) 0%, #050a0f 60%, #020408 100%)' }}>
      <div className="relative max-w-4xl mx-auto px-4 md:px-8 py-8 md:py-12 space-y-6">

        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <BarChart2 size={20} className="text-sky-400" />
            <h1 className="text-lg font-black uppercase tracking-[0.15em] text-white">Work Log</h1>
          </div>
          <select
            value={monthStart}
            onChange={e => setMonthStart(e.target.value)}
            className="text-xs font-black uppercase tracking-wider bg-slate-900/70 border border-white/10 rounded-sm px-3 py-2 text-slate-300"
          >
            {months.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
          </select>
        </div>

        <div>
          <p className="text-[10px] uppercase tracking-[0.25em] font-black text-slate-500 mb-3">My Work This Month</p>
          <div className="grid grid-cols-2 md:grid-cols-6 gap-3 mb-4">
            <div className="rounded-sm p-4 col-span-2 md:col-span-1" style={{ background: 'rgba(15,23,42,0.7)', border: '1px solid rgba(255,255,255,0.05)' }}>
              <p className="text-[10px] font-black uppercase tracking-wider text-slate-500 mb-1">Total</p>
              <p className="text-2xl font-black text-white">{myTotal}</p>
            </div>
            {ACTION_TYPES.map(a => (
              <div key={a} className="rounded-sm p-4" style={{ background: 'rgba(15,23,42,0.7)', border: '1px solid rgba(255,255,255,0.05)', borderLeft: `3px solid ${ACTION_COLORS[a]}` }}>
                <p className="text-[10px] font-black uppercase tracking-wider text-slate-500 mb-1">{a}</p>
                <p className="text-xl font-black text-white">{myRows.find(r => r.action_type === a)?.count || 0}</p>
              </div>
            ))}
          </div>
          {myTotal === 0 ? (
            <p className="text-xs text-slate-600 italic px-1">No recorded work yet this month.</p>
          ) : (
            <div className="rounded-sm p-4" style={{ background: 'rgba(15,23,42,0.7)', border: '1px solid rgba(255,255,255,0.05)' }}>
              <ResponsiveContainer width="100%" height={180}>
                <BarChart data={myBreakdown} barCategoryGap="25%">
                  <XAxis dataKey="name" tick={{ fill: '#64748b', fontSize: 9, fontWeight: 700 }} axisLine={false} tickLine={false} interval={0} angle={-15} textAnchor="end" height={50} />
                  <YAxis tick={{ fill: '#475569', fontSize: 10 }} axisLine={false} tickLine={false} allowDecimals={false} />
                  <Tooltip {...TT} />
                  <Bar dataKey="value" radius={[2, 2, 0, 0]}>
                    {myBreakdown.map((d, i) => <Cell key={i} fill={ACTION_COLORS[d.name]} fillOpacity={0.85} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        {admin && (
          <div>
            <p className="text-[10px] uppercase tracking-[0.25em] font-black text-slate-500 mb-3">
              Staff &amp; Reviewer Leaderboard — {serverTotal} total actions
            </p>
            {leaderboard.length === 0 ? (
              <p className="text-xs text-slate-600 italic px-1">No recorded work yet this month.</p>
            ) : (
              <div className="space-y-2">
                {leaderboard.map((u, i) => (
                  <div key={u.user_id} className="rounded-sm p-4 flex items-center gap-4" style={{ background: 'rgba(15,23,42,0.7)', border: '1px solid rgba(255,255,255,0.05)' }}>
                    <span className="text-xs font-black text-slate-600 w-5 shrink-0">#{i + 1}</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-sm font-black text-white truncate">{u.username}</span>
                        <span className="text-[9px] font-black uppercase tracking-wider text-slate-500">{['staff', 'reviewer'].includes(u.role) ? 'Reviewer' : ['oc_staff', 'grader'].includes(u.role) ? 'Grader' : u.role}</span>
                      </div>
                      <div className="flex gap-3 flex-wrap">
                        {ACTION_TYPES.filter(a => u.byAction[a]).map(a => (
                          <span key={a} className="text-[10px] font-black" style={{ color: ACTION_COLORS[a] }}>
                            {u.byAction[a]} {a}
                          </span>
                        ))}
                      </div>
                    </div>
                    <span className="text-xl font-black text-white shrink-0">{u.total}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
