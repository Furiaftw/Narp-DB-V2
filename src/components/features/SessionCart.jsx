import React, { useState } from 'react';
import Icon from '../ui/Icon';
import { copyText, formatSessionList } from '../../utils/helpers';

/* ============================================================================
   COMPONENT: SessionListCart
   ============================================================================ */
export function SessionListCart({ list, onClear, onRemove }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  if (!list.length) return null;

  const handleCopyList = () => {
    const text = formatSessionList(list);
    copyText(text, () => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col items-end gap-2 animate-in slide-in-from-bottom duration-200">
      {open && (
        <div className="bg-white rounded-3xl border border-slate-200 shadow-2xl w-80 max-h-[400px] flex flex-col overflow-hidden">
          <div className="bg-slate-900 text-white p-4 flex justify-between items-center shrink-0">
            <div className="flex items-center gap-2">
              <Icon n="Book" size={16} className="text-indigo-400" />
              <span className="font-bold text-sm">Session List ({list.length})</span>
            </div>
            <button onClick={() => setOpen(false)} className="text-slate-400 hover:text-white"><Icon n="X" size={16} /></button>
          </div>
          <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-1.5 custom-scrollbar bg-slate-50">
            {list.map(j => (
              <div key={j._id} className="flex justify-between items-center bg-white p-2.5 rounded-xl border border-slate-150 shadow-sm hover:border-slate-300">
                <div className="flex flex-col min-w-0 pr-4">
                  <span className="text-xs font-bold text-slate-800 truncate">{j.name}</span>
                </div>
                <button onClick={() => onRemove(j._id)} className="text-slate-400 hover:text-red-600 font-bold px-1.5 py-0.5 rounded text-xs transition-colors shrink-0">
                  <Icon n="Trash" size={12}/>
                </button>
              </div>
            ))}
          </div>
          <div className="p-3 border-t bg-white flex gap-2 shrink-0">
            <button onClick={onClear} className="flex-1 text-xs font-bold text-red-600 bg-red-50 hover:bg-red-100 py-2.5 rounded-xl transition-colors">Clear</button>
            <button onClick={handleCopyList} className="flex-1 text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 py-2.5 rounded-xl flex items-center justify-center gap-1.5 transition-colors shadow-md">
              <Icon n="Copy" size={12}/> {copied ? 'Copied!' : 'Copy List'}
            </button>
          </div>
        </div>
      )}

      <button onClick={() => setOpen(!open)}
              className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold p-4 rounded-full shadow-2xl flex items-center gap-2 transition-transform hover:scale-105 select-none relative">
        <Icon n="Book" size={20} />
        <span className="bg-rose-500 text-white absolute -top-1.5 -right-1 w-5 h-5 rounded-full text-[10px] flex items-center justify-center font-black border border-white shadow-sm">{list.length}</span>
      </button>
    </div>
  );
}

export default SessionListCart;
