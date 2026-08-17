import React, { useState, useEffect } from 'react';
import { X, Clock, Loader2 } from 'lucide-react';
import { fetchJutsuReviewHistory } from '../../lib/supabase';

/*
 * The review chat transcript for a jutsu, moved out of Discord (where it
 * used to ship as a .txt attachment on the approval post) and into the
 * database instead — attached to the jutsu it approved, reviewer+ only.
 * RLS on jutsu_review_history is the real gate; this modal is only ever
 * opened from a staff+-gated button on the jutsu card.
 */
export default function JutsuHistoryModal({ jutsuId, jutsuName, onClose }) {
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const rows = await fetchJutsuReviewHistory(jutsuId);
        if (!cancelled) setEntries(rows);
      } catch (e) {
        if (!cancelled) setError(e.message || 'Failed to load review history.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [jutsuId]);

  const nameOf = (p) => p?.site_nickname || p?.username || 'Unknown';

  return (
    <div className="fixed inset-0 z-[75] bg-black/60 flex items-center justify-center p-4 animate-in fade-in" onClick={onClose}>
      <div className="bg-white rounded-3xl max-w-2xl w-full overflow-hidden max-h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="bg-slate-900 text-white p-5 flex justify-between items-center shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <Clock size={20} className="text-amber-400 shrink-0" />
            <h3 className="font-bold text-lg truncate">Review History — {jutsuName}</h3>
          </div>
          <button onClick={onClose} className="shrink-0"><X size={18} /></button>
        </div>

        <div className="p-6 overflow-y-auto custom-scrollbar">
          {error && <div className="mb-4 p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-sm font-semibold">{error}</div>}
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-8 text-slate-400 text-sm font-semibold">
              <Loader2 size={16} className="animate-spin" /> Loading...
            </div>
          ) : entries.length === 0 ? (
            <div className="text-center py-8 text-slate-400 text-sm font-semibold">No review chat was recorded for this entry.</div>
          ) : (
            <div className="space-y-4">
              {entries.map(e => (
                <div key={e.id} className="rounded-xl border border-slate-200 overflow-hidden">
                  <div className="bg-slate-50 px-4 py-2.5 flex items-center justify-between gap-3 border-b border-slate-200">
                    <div className="text-xs font-bold text-slate-700">
                      {e.operation === 'update' ? 'Edit approved' : 'Approved'}
                      <span className="text-slate-400 font-semibold"> · submitted by {nameOf(e.submitted_by_profile)} · approved by {nameOf(e.reviewed_by_profile)}</span>
                    </div>
                    <div className="text-[11px] font-mono text-slate-400 shrink-0">{new Date(e.created_at).toLocaleString()}</div>
                  </div>
                  <pre className="px-4 py-3 text-xs text-slate-700 whitespace-pre-wrap font-sans leading-relaxed max-h-64 overflow-y-auto custom-scrollbar">{e.transcript}</pre>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
