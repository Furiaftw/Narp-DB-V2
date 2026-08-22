import { useState } from 'react';
import { Icon } from '../ui/Icon';
import { copyText, formatSessionList } from '../../utils/helpers';

/* ============================================================================
   COMPONENT: SessionListCart
   The floating "session list" of jutsus picked out of the catalog, with the
   copy-to-clipboard block a player pastes into their RP thread.
   ============================================================================ */


/* ============================================================================
   COMPONENT: SessionListCart
   ============================================================================ */
export function SessionListCart({ list, onClear, onRemove }) {
  const [copied, setCopied]     = useState(false);
  const [expanded, setExpanded] = useState(false);

  if (list.length === 0) return null;

  const handleCopyAll = () => {
    copyText(formatSessionList(list), () => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 animate-in slide-in-from-bottom-5 fade-in duration-300 w-[95vw] max-w-xl">
      <div className="bg-slate-900 text-white rounded-2xl shadow-2xl shadow-slate-900/50 border border-slate-700 flex flex-col overflow-hidden w-full">
        {expanded && (
          <div className="p-2 max-h-48 overflow-y-auto border-b border-slate-800 bg-slate-800/50 text-sm custom-scrollbar">
            {list.map(j => (
              <div key={j._id} className="flex justify-between items-center py-2 px-3 border-b border-slate-800/50 last:border-0 group">
                <span className="truncate pr-2 font-medium text-slate-200 text-xs">{j.name}</span>
                <button onClick={() => onRemove(j._id)}
                        className="text-slate-500 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity"
                        title="Remove">
                  <Icon n="X" size={14} />
                </button>
              </div>
            ))}
          </div>
        )}
        <div className="flex items-center justify-between p-2 pl-4 flex-wrap gap-2">
          <button onClick={() => setExpanded(!expanded)}
                  className="flex items-center gap-2 text-sm font-bold text-slate-200 hover:text-white transition-colors py-1">
            <div className="relative">
              <Icon n="Book" size={16} className="text-indigo-400" />
              <span className="absolute -top-1 -right-1.5 w-3 h-3 bg-indigo-500 rounded-full text-[8px] flex items-center justify-center font-black">
                {list.length}
              </span>
            </div>
            <span className="hidden sm:inline">Session List</span>
            <Icon n={expanded ? 'Down' : 'Up'} size={14} className="text-slate-500" />
          </button>
          <div className="flex items-center gap-1.5 ml-auto">
            <button onClick={handleCopyAll}
                    className={`text-xs font-bold px-3 py-2 rounded-xl transition-colors flex items-center gap-1.5 ${copied ? 'bg-emerald-500 text-white' : 'bg-indigo-600 hover:bg-indigo-500 text-white'}`}>
              <Icon n={copied ? 'Check' : 'Copy'} size={14} />
              <span className="hidden sm:inline">{copied ? 'Copied' : 'Copy All'}</span>
            </button>
            <button onClick={onClear} className="p-2 text-slate-400 hover:text-red-400 hover:bg-slate-800 rounded-xl transition-colors" title="Clear list">
              <Icon n="Trash" size={16} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ============================================================================
   COMPONENT: FilterBar
   ============================================================================ */

export default SessionListCart;
