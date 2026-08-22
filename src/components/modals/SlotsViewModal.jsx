import { Icon } from '../ui/Icon';
import { getSlotStatus } from '../../utils/helpers';

/* ============================================================================
   COMPONENT: SlotsViewModal
   Read-only view of who holds the slots on a Limited jutsu.
   ============================================================================ */

export function SlotsViewModal({ jutsu, onClose }) {
  const { parsed, total } = getSlotStatus(jutsu.slots);
  const filled = parsed.filter(s => s && s.username);
  const empty  = total - filled.length;

  return (
    <div className="fixed inset-0 z-[80] bg-black/60 flex items-center justify-center p-4 animate-in fade-in" onClick={onClose}>
      <div className="bg-white rounded-3xl max-w-md w-full overflow-hidden max-h-[85vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="bg-slate-900 text-white p-5 flex justify-between items-center shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <Icon n="Eye" size={18} className="text-indigo-400 shrink-0" />
            <div className="min-w-0">
              <h3 className="font-bold text-base truncate">{jutsu.name}</h3>
              <p className="text-[10px] uppercase tracking-widest text-slate-400">Slot Holders</p>
            </div>
          </div>
          <button onClick={onClose}><Icon n="X" size={18} /></button>
        </div>

        <div className="p-5 overflow-y-auto custom-scrollbar">
          {total === 0 ? (
            <div className="text-center py-8 text-slate-400 text-sm font-semibold">No slots configured.</div>
          ) : (
            <>
              <div className="text-xs font-bold text-slate-500 mb-3 flex items-center gap-2">
                <span>{filled.length} of {total} taken</span>
                {empty > 0 && <span className="text-emerald-600">· {empty} open</span>}
              </div>
              <div className="space-y-1.5">
                {parsed.map((slot, i) => {
                  const hasName = !!(slot && slot.username);
                  const hasLink = !!(slot && slot.discord_link);
                  return (
                    <div key={i} className={`flex items-center gap-3 p-3 rounded-xl border ${hasName ? 'bg-slate-50 border-slate-200' : 'bg-white border-dashed border-slate-200'}`}>
                      <span className="text-[10px] font-bold text-slate-400 w-6 text-center shrink-0">#{i + 1}</span>
                      {hasName ? (
                        hasLink ? (
                          <a href={slot.discord_link}
                             target="_blank" rel="noopener noreferrer"
                             className="text-sm font-bold text-indigo-700 hover:text-indigo-900 hover:underline truncate flex-1 flex items-center gap-1.5">
                            {slot.username}
                            <Icon n="ExtLink" size={11} className="text-indigo-400 shrink-0" />
                          </a>
                        ) : (
                          <span className="text-sm font-bold text-slate-700 truncate flex-1">{slot.username}</span>
                        )
                      ) : (
                        <span className="text-sm italic text-slate-400 flex-1">Open slot</span>
                      )}
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/* ============================================================================
   COMPONENT: BloodlineRosterCard
   ============================================================================ */

export default SlotsViewModal;
