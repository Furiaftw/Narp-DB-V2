import React, { useState } from 'react';
import Icon from '../ui/Icon';
import { submitPendingJutsu, getCurrentSession } from '../../lib/supabase';

/* ============================================================================
   MODAL: StatelessSubmissionModal
   ============================================================================ */
export function StatelessSubmissionModal({ type, profile, onClose }) {
  const [link, setLink] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const isCharacter = type === 'Character';
  const submitDisabled = !link.trim() || submitting;

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (submitDisabled) return;

    setSubmitting(true);
    try {
      if (isCharacter) {
        // Character submissions are sent to the database queue as pending items
        await submitPendingJutsu('insert', null, { type: 'Character', link: link, name: 'OC Submission' }, 'pending_review');

        // Trigger a reviewer ping for creation
        const sess1 = await getCurrentSession();
        const authHdr1 = sess1?.access_token ? { Authorization: `Bearer ${sess1.access_token}` } : {};
        await fetch('/.netlify/functions/reviewer-ping', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...authHdr1 },
          body: JSON.stringify({
            triggerType: 'creation',
            itemName: 'OC Submission',
            itemType: 'Character',
            submitterName: profile?.username || 'Unknown',
          }),
        }).catch((pingErr) => {
          console.warn('[NARP] Reviewer ping creation alert failed:', pingErr);
        });
      } else {
        // Summon and Custom Item go through the pending review queue (no DB write on approval)
        await submitPendingJutsu('insert', null, {
          type,
          name: `${type} Submission`,
          link: link.trim(),
        }, 'pending_review');

        const sess2 = await getCurrentSession();
        const authHdr2 = sess2?.access_token ? { Authorization: `Bearer ${sess2.access_token}` } : {};
        await fetch('/.netlify/functions/reviewer-ping', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...authHdr2 },
          body: JSON.stringify({
            triggerType: 'creation',
            itemName: `${type} Submission`,
            itemType: type,
            submitterName: profile?.username || 'Unknown',
          }),
        }).catch((pingErr) => {
          console.warn('[NARP] Reviewer ping creation alert failed:', pingErr);
        });
      }

      onClose();
    } catch (err) {
      console.error('[NARP] Failed to submit log:', err);
      alert('Submission failed: ' + (err.message || err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[80] bg-black/60 flex items-center justify-center p-4 animate-in fade-in" onClick={onClose}>
      <div className="bg-white rounded-3xl max-w-lg w-full overflow-hidden max-h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="bg-slate-900 text-white p-5 flex justify-between items-center shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <Icon n="PlusCir" size={18} className="text-indigo-400 shrink-0" />
            <h2 className="font-serif font-bold text-base truncate">Submit {type}</h2>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white transition-colors">
            <Icon n="X" size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-5 space-y-4">
          <div>
            <label className="text-xs font-bold text-slate-500 uppercase tracking-widest block mb-1.5">Document Link (Mandatory)</label>
            <input
              type="url"
              required
              value={link}
              onChange={e => setLink(e.target.value)}
              placeholder="https://docs.google.com/..."
              className="w-full text-sm border border-slate-300 bg-white rounded-xl px-3 py-2 text-slate-800 focus:outline-none focus:border-indigo-500"
            />
          </div>

          <div className="flex justify-end gap-3 pt-2 border-t border-slate-100 shrink-0">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm font-bold text-slate-600 hover:bg-slate-50 rounded-xl transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitDisabled}
              className="px-5 py-2.5 rounded-xl text-sm font-bold transition-all shadow-md bg-indigo-600 hover:bg-indigo-700 text-white disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {submitting ? (
                <span className="flex items-center gap-1.5">
                  <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="animate-spin"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
                  Submitting...
                </span>
              ) : 'Submit'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default StatelessSubmissionModal;
