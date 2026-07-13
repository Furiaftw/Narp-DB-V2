import Icon from '../components/ui/Icon';

/* ============================================================================
   PAGE: SubmitPage — standalone "Submit" tab. Entry point for the four
   submission types (Jutsu/Battlemode, OC, Summon, Custom Item); each opens
   the same modal it always has (AdminFormModal / OCSubmissionModal /
   StatelessSubmissionModal via App.jsx). Purely presentational — all data
   and handlers are threaded in from App().
   ============================================================================ */

const CARDS = [
  {
    key: 'jutsu_paused',
    label: 'Jutsu / Battlemode',
    description: 'Submit a new technique or battlemode entry for review.',
    icon: 'PlusCir',
    color: 'text-indigo-500',
    ring: 'hover:border-indigo-300 hover:shadow-indigo-100',
    action: (handlers) => handlers.onAdd(),
  },
  {
    key: 'character_paused',
    label: 'OC Submission',
    description: 'Submit a new original character for review.',
    icon: 'PlusCir',
    color: 'text-emerald-500',
    ring: 'hover:border-emerald-300 hover:shadow-emerald-100',
    action: (handlers) => handlers.onOpenStatelessSubmission('Character'),
  },
  {
    key: 'summon_paused',
    label: 'Summon',
    description: 'Submit a new summon for review.',
    icon: 'PlusCir',
    color: 'text-amber-500',
    ring: 'hover:border-amber-300 hover:shadow-amber-100',
    action: (handlers) => handlers.onOpenStatelessSubmission('Summon'),
  },
  {
    key: 'custom_item_paused',
    label: 'Custom Item',
    description: 'Submit a new custom item for review.',
    icon: 'PlusCir',
    color: 'text-purple-500',
    ring: 'hover:border-purple-300 hover:shadow-purple-100',
    action: (handlers) => handlers.onOpenStatelessSubmission('Custom Item'),
  },
];

export default function SubmitPage({ submissionControls, onAdd, onOpenStatelessSubmission }) {
  const handlers = { onAdd, onOpenStatelessSubmission };

  return (
    <div className="max-w-4xl mx-auto">
      <h2 className="text-xl font-bold text-slate-900 mb-1">Submit</h2>
      <p className="text-sm text-slate-500 mb-6">Pick what you'd like to submit for review.</p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {CARDS.map((card) => {
          const paused = !!submissionControls?.[card.key];
          return paused ? (
            <div
              key={card.key}
              className="bg-white border border-slate-200 rounded-2xl p-5 flex items-start gap-3 opacity-70 cursor-default select-none"
            >
              <Icon n="Lock" size={20} className="text-rose-400 shrink-0 mt-0.5" />
              <div>
                <div className="font-bold text-slate-700 flex items-center gap-2">
                  {card.label}
                  <span className="text-[10px] font-bold uppercase tracking-wide text-rose-500 bg-rose-50 border border-rose-200 px-1.5 py-0.5 rounded">Paused</span>
                </div>
                <p className="text-xs text-slate-400 mt-1">{card.description}</p>
              </div>
            </div>
          ) : (
            <button
              key={card.key}
              type="button"
              onClick={() => card.action(handlers)}
              className={`text-left bg-white border border-slate-200 rounded-2xl p-5 flex items-start gap-3 shadow-sm transition-all hover:shadow-md ${card.ring}`}
            >
              <Icon n={card.icon} size={20} className={`${card.color} shrink-0 mt-0.5`} />
              <div>
                <div className="font-bold text-slate-900">{card.label}</div>
                <p className="text-xs text-slate-500 mt-1">{card.description}</p>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
