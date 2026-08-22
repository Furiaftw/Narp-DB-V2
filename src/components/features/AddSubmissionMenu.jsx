import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from '../ui/Icon';

/* ============================================================================
   COMPONENT: AddSubmissionMenu
   The green Submit menu in the header (Jutsu/Battlemode, OC, Summon, Custom
   Item). Renders only on the Database section — filing a new entry from
   Roster/Grading/History makes no sense.
   ============================================================================ */

export const ADD_MENU_WIDTH = 256;

/* Compute fixed-position style for the add-submission panel from the trigger
   button rect, clamped so it never spills past the right/left viewport edge
   (the trigger sits at the right end of a flex-wrap header row, so a
   left-anchored panel can otherwise open off-screen on narrow viewports). */
export function computeAddMenuPos(triggerEl, panelWidth) {
  if (!triggerEl) return { top: 0, left: 0, width: panelWidth };
  const rect = triggerEl.getBoundingClientRect();
  const clampedLeft = Math.min(rect.right - panelWidth, window.innerWidth - panelWidth - 8);
  const left = Math.max(8, clampedLeft);
  return { top: rect.bottom + 8, left, width: panelWidth };
}

export function AddSubmissionMenu({ canSubmit, onAdd, onOpenStatelessSubmission, submissionControls }) {
  const [addDdOpen, setAddDdOpen] = useState(false);
  const addDdRef = useRef(null);
  const triggerRef = useRef(null);
  const [panelStyle, setPanelStyle] = useState({});

  const handleToggle = useCallback(() => {
    if (!addDdOpen) setPanelStyle(computeAddMenuPos(triggerRef.current, ADD_MENU_WIDTH));
    setAddDdOpen(o => !o);
  }, [addDdOpen]);

  useEffect(() => {
    if (!addDdOpen) return;
    const handleOutsideClick = (e) => {
      if (addDdRef.current && !addDdRef.current.contains(e.target)) {
        setAddDdOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutsideClick);
    document.addEventListener('touchstart', handleOutsideClick);
    return () => {
      document.removeEventListener('mousedown', handleOutsideClick);
      document.removeEventListener('touchstart', handleOutsideClick);
    };
  }, [addDdOpen]);

  if (!canSubmit) return null;

  return (
    <div className="relative shrink-0" ref={addDdRef}>
      <button ref={triggerRef} onClick={handleToggle}
              className="px-4 py-2 rounded-lg text-sm font-bold flex items-center justify-center gap-1.5 transition-all shrink-0 bg-emerald-600 text-white hover:bg-emerald-500 shadow-lg">
        <Icon n="PlusCir" size={16} /> <span className="hidden sm:inline">Submit</span> <Icon n="Down" size={12} className="text-white opacity-80" />
      </button>
      {addDdOpen && (
        <div style={{ position: 'fixed', zIndex: 9999, ...panelStyle }}
             className="bg-white rounded-xl shadow-xl border border-slate-200 overflow-hidden py-1">
          {submissionControls?.jutsu_paused ? (
            <div className="w-full text-left px-4 py-2.5 text-sm font-semibold text-rose-500 flex items-center gap-2 cursor-default select-none">
              <Icon n="Lock" size={14} className="text-rose-400 shrink-0" />
              <span>Jutsu / Battlemode <span className="text-[10px] font-bold uppercase tracking-wide text-rose-400 ml-1">Paused</span></span>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => { setAddDdOpen(false); onAdd(); }}
              className="w-full text-left px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 flex items-center gap-2"
            >
              <Icon n="PlusCir" size={14} className="text-indigo-500" /> Jutsu / Battlemode
            </button>
          )}
          <div className="border-t border-slate-100">
            {submissionControls?.character_paused ? (
              <div className="w-full text-left px-4 py-2.5 text-sm font-semibold text-rose-500 flex items-center gap-2 cursor-default select-none opacity-70">
                <Icon n="Lock" size={14} className="text-rose-400 shrink-0" />
                <span>OC Submission <span className="text-[10px] font-bold uppercase tracking-wide text-rose-400 ml-1">Paused</span></span>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => { setAddDdOpen(false); onOpenStatelessSubmission('Character'); }}
                className="w-full text-left px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 flex items-center gap-2"
              >
                <Icon n="PlusCir" size={14} className="text-emerald-500" /> OC Submission
              </button>
            )}
          </div>
          <div className="border-t border-slate-100">
            {submissionControls?.summon_paused ? (
              <div className="w-full text-left px-4 py-2.5 text-sm font-semibold text-rose-500 flex items-center gap-2 cursor-default select-none opacity-70">
                <Icon n="Lock" size={14} className="text-rose-400 shrink-0" />
                <span>Summon <span className="text-[10px] font-bold uppercase tracking-wide text-rose-400 ml-1">Paused</span></span>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => { setAddDdOpen(false); onOpenStatelessSubmission('Summon'); }}
                className="w-full text-left px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 flex items-center gap-2"
              >
                <Icon n="PlusCir" size={14} className="text-amber-400" /> Summon
              </button>
            )}
          </div>
          <div className="border-t border-slate-100">
            {submissionControls?.custom_item_paused ? (
              <div className="w-full text-left px-4 py-2.5 text-sm font-semibold text-rose-500 flex items-center gap-2 cursor-default select-none opacity-70">
                <Icon n="Lock" size={14} className="text-rose-400 shrink-0" />
                <span>Custom Item <span className="text-[10px] font-bold uppercase tracking-wide text-rose-400 ml-1">Paused</span></span>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => { setAddDdOpen(false); onOpenStatelessSubmission('Custom Item'); }}
                className="w-full text-left px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 flex items-center gap-2"
              >
                <Icon n="PlusCir" size={14} className="text-purple-400" /> Custom Item
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/* ============================================================================
   COMPONENT: FilterBarPanel
   Rendered OUTSIDE the sticky header so it sits in normal document flow.
   This eliminates layout reflow on open (scroll delay) and lets the fixed-
   position dropdown panels escape the viewport freely.
   ============================================================================ */

export default AddSubmissionMenu;
