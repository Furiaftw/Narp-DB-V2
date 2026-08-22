import { useEffect, useState } from 'react';
import { subscribeToPWAUpdate, applyPWAUpdate } from '../../pwaUpdate';
import Icon from './Icon';

export default function UpdateBanner() {
  const [needsRefresh, setNeedsRefresh] = useState(false);
  useEffect(() => subscribeToPWAUpdate(setNeedsRefresh), []);

  if (!needsRefresh) return null;

  return (
    <div className="fixed bottom-4 inset-x-0 z-[300] flex justify-center px-4 pointer-events-none">
      <div className="pointer-events-auto flex items-center gap-3 bg-slate-900 text-white rounded-2xl shadow-xl border border-slate-700 pl-4 pr-2 py-2.5">
        <Icon n="Refresh" size={15} className="text-indigo-400 shrink-0" />
        <span className="text-sm font-semibold">A new version is available.</span>
        <button
          onClick={applyPWAUpdate}
          className="bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold px-3 py-1.5 rounded-xl transition-colors shrink-0"
        >
          Refresh
        </button>
      </div>
    </div>
  );
}
