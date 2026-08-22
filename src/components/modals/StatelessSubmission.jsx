import { useState } from 'react';
import { Icon } from '../ui/Icon';
import { submitPendingJutsu, getCurrentSession } from '../../lib/supabase';

/* ============================================================================
   COMPONENT: StatelessSubmissionModal
   Summon / Custom Item submissions. Both types are currently paused
   (submission_controls) because the form only ever captured a mandatory
   Google Doc link and that requirement is gone server-wide; the code is kept
   intact and ready for when proper in-app sheets ship for these.
   ============================================================================ */

export function StatelessSubmissionModal({ type, profile, onClose, isAdmin, onDirectUpload, onAfterSubmit }) {
  const [link, setLink] = useState('');
  const [name, setName] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const isCharacter = type === 'Character';
  const nameLabel = type === 'Summon' ? 'Summon Contract Name' : type === 'Custom Item' ? 'Item Name' : 'Entry Name';
  const submitDisabled = !link.trim() || (!isCharacter && !name.trim()) || submitting;

  const buildData = () => isCharacter
    ? { type: 'Character', link, name: 'OC Submission' }
    : { type, name: name.trim(), link: link.trim() };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (submitDisabled) return;

    setSubmitting(true);
    try {
      const data = buildData();
      await submitPendingJutsu('insert', null, data, 'pending_review');

      const _pingSess = await getCurrentSession();
      fetch('/.netlify/functions/reviewer-ping', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(_pingSess?.access_token ? { Authorization: `Bearer ${_pingSess.access_token}` } : {}),
        },
        body: JSON.stringify({
          triggerType: 'creation',
          itemName: data.name,
          itemType: isCharacter ? 'Character' : type,
          submitterName: profile?.username || 'Unknown',
        }),
      }).catch((pingErr) => {
        console.warn('[NARP] Reviewer ping creation alert failed:', pingErr);
      });

      if (onAfterSubmit) onAfterSubmit();
      onClose();
    } catch (err) {
      console.error('[NARP] Failed to submit log:', err);
      alert('Submission failed: ' + (err.message || err));
    } finally {
      setSubmitting(false);
    }
  };

  const handleDirectUpload = async () => {
    if (submitDisabled || !onDirectUpload) return;
    setSubmitting(true);
    try {
      await onDirectUpload(buildData());
      onClose();
    } catch (err) {
      console.error('[NARP] Direct upload failed:', err);
      alert('Direct upload failed: ' + (err.message || err));
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
          {!isCharacter && (
            <div>
              <label className="text-xs font-bold text-slate-500 uppercase tracking-widest block mb-1.5">{nameLabel} (Mandatory)</label>
              <input
                type="text"
                required
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder={type === 'Summon' ? 'e.g. Shadow Wolves' : 'e.g. Chakra Blade'}
                className="w-full text-sm border border-slate-300 bg-white rounded-xl px-3 py-2 text-slate-800 focus:outline-none focus:border-indigo-500"
              />
            </div>
          )}
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
            {isAdmin && !isCharacter && onDirectUpload && (
              <button
                type="button"
                onClick={handleDirectUpload}
                disabled={submitDisabled}
                className="px-5 py-2.5 rounded-xl text-sm font-bold transition-all shadow-md bg-amber-500 hover:bg-amber-600 text-white disabled:opacity-50 disabled:cursor-not-allowed"
                title="Log & approve immediately without pending review"
              >
                {submitting ? 'Uploading...' : 'Direct Upload'}
              </button>
            )}
            <button
              type="submit"
              disabled={submitDisabled}
              className="px-5 py-2.5 rounded-xl text-sm font-bold transition-all shadow-md bg-indigo-600 hover:bg-indigo-700 text-white disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {submitting ? 'Submitting...' : 'Submit for Review'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* ============================================================================
   MODAL: OCSubmissionModal — original character submissions.
   Rank cards show server-wide need, village cards suggest where the picked
   rank is scarcest, and the bloodline picker enforces slot capacity:
   full bloodlines are blocked, bloodlines with ≤2 open slots turn the
   submission into a "Réservation Request" that staff must grant.
   ============================================================================ */
export default StatelessSubmissionModal;
