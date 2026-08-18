/*
 * History — the read-only record of who did what.
 *
 * Two panels behind one page, each its own address so either can be linked
 * directly:
 *   /history/work-log   (reviewer+) — review throughput, from WorkStatsPage
 *   /history/audit-log  (admin+)    — role changes, lifted out of the old
 *                                     AuditLogModal in App.jsx
 *
 * A reviewer sees only the Work Log tab; admin+ sees both. Routing decides
 * which panel renders — this component owns the sub-nav and the access
 * notice, nothing else.
 */

import { useState, useEffect, lazy, Suspense } from 'react';
import { NavLink } from 'react-router-dom';
import { Icon } from '../components/ui/Icon';
import { fetchRoleChangeLog } from '../lib/supabase';
import { maskEmail } from '../utils/helpers';

const WorkStatsPage = lazy(() => import('./WorkStatsPage'));

/* ── Audit log (was AuditLogModal in App.jsx) ─────────────────────────────── */

export function AuditLogPanel() {
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

  // 'staff'/'oc_staff' appear in historical rows — keep rendering them.
  const arrow = (from, to) => {
    const colors = { user: 'text-slate-500', reviewer: 'text-emerald-600', staff: 'text-emerald-600', grader: 'text-teal-600', oc_staff: 'text-teal-600', admin: 'text-indigo-600', owner: 'text-amber-600' };
    const label = (r) => r === 'staff' || r === 'reviewer' ? 'Reviewer' : r === 'oc_staff' || r === 'grader' ? 'Grader' : (r || '∅');
    return (
      <span className="text-xs font-bold">
        <span className={colors[from] || ''}>{label(from)}</span>
        <span className="mx-1.5 text-slate-300">→</span>
        <span className={colors[to] || ''}>{label(to)}</span>
      </span>
    );
  };

  return (
    <div className="max-w-3xl mx-auto">
      <div className="bg-white rounded-3xl border border-slate-200 shadow-xs overflow-hidden">
        <div className="bg-slate-900 text-white p-5 flex items-center gap-2">
          <Icon n="Clock" size={20} className="text-amber-400" />
          <h3 className="font-bold text-lg font-serif">Audit Log — Role Changes</h3>
        </div>
        <div className="p-6">
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

/* ── Page shell ───────────────────────────────────────────────────────────── */

export default function HistoryPage({ view, profile, role }) {
  const isReviewer = ['reviewer', 'admin', 'owner'].includes(role);
  const isAdmin    = ['admin', 'owner'].includes(role);

  const tabs = [
    ...(isReviewer ? [{ to: '/history/work-log',  label: 'Work Log' }] : []),
    ...(isAdmin    ? [{ to: '/history/audit-log', label: 'Audit Log' }] : []),
  ];

  const allowed = view === 'audit-log' ? isAdmin : isReviewer;
  // WorkStatsPage paints its own dark, full-bleed layout; the audit log is an
  // ordinary light panel and needs the page padding the app shell would
  // otherwise give it.
  const selfLayout = allowed && view !== 'audit-log';

  return (
    <div className={selfLayout ? '' : 'pb-20'}>
      {tabs.length > 1 && (
        <div className="bg-white border-b border-slate-200">
          <div className="max-w-4xl mx-auto px-4 md:px-6 py-2.5 flex gap-1.5">
            {tabs.map(t => (
              <NavLink key={t.to} to={t.to}
                className={({ isActive }) => `text-xs font-bold uppercase tracking-wider px-3.5 py-2 rounded-xl border transition-colors ${
                  isActive ? 'bg-slate-900 text-white border-slate-900'
                           : 'bg-white text-slate-600 border-slate-200 hover:border-slate-400'
                }`}>
                {t.label}
              </NavLink>
            ))}
          </div>
        </div>
      )}

      {!allowed ? (
        <div className="p-4 md:p-6">
          <NoAccess what={view === 'audit-log' ? 'The audit log is admin-only.' : 'The work log is for reviewers and above.'} />
        </div>
      ) : view === 'audit-log' ? (
        <div className="p-4 md:p-6">
          <AuditLogPanel />
        </div>
      ) : (
        <Suspense fallback={null}>
          <WorkStatsPage userId={profile?.id} userRole={role} />
        </Suspense>
      )}
    </div>
  );
}

export function NoAccess({ what }) {
  return (
    <div className="max-w-3xl mx-auto bg-white rounded-3xl border border-slate-200 p-8 text-center">
      <Icon n="Lock" size={28} className="text-slate-300 mx-auto mb-3" />
      <p className="text-sm font-semibold text-slate-600">{what}</p>
      <p className="text-xs text-slate-400 mt-1">Ask an admin if you think you should have access.</p>
    </div>
  );
}
