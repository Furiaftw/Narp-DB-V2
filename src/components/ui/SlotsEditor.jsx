import { Icon } from './Icon';

/* ============================================================================
   COMPONENT: SlotsEditor
   Edits the JSON slot list a Limited jutsu / bloodline carries.
   ============================================================================ */

export function SlotsEditor({ value, onChange, defCount = 1 }) {
  const parsed = (() => { try { return JSON.parse(value || '[]'); } catch { return []; } })();
  const arr = parsed.length ? parsed : Array(defCount).fill({ username: '', discord_link: '' });

  const updateSlot = (i, field, v) => {
    const next = [...arr];
    next[i] = { ...next[i], [field]: v };
    onChange(JSON.stringify(next));
  };

  const addSlot    = () => onChange(JSON.stringify([...arr, { username: '', discord_link: '' }]));
  const removeSlot = (i) => onChange(JSON.stringify(arr.filter((_, idx) => idx !== i)));

  return (
    <div className="space-y-2">
      <div className="flex justify-between items-center mb-1">
        <span className="text-xs font-semibold text-slate-500">
          {arr.filter(x => x.username).length}/{arr.length} slots filled
        </span>
        <button type="button" onClick={addSlot}
                className="text-xs bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded font-bold">
          + Add Slot
        </button>
      </div>
      {arr.map((slot, i) => (
        <div key={i} className="flex flex-col sm:flex-row gap-2 bg-slate-50 p-2 rounded-lg border border-slate-100 items-center">
          <span className="text-xs font-bold text-slate-400 w-6 text-center">#{i + 1}</span>
          <input type="text" value={slot.username || ''}     onChange={e => updateSlot(i, 'username',     e.target.value)} placeholder="Character name" className="flex-1 w-full text-xs p-1.5 border rounded" />
          <input type="text" value={slot.discord_link || ''} onChange={e => updateSlot(i, 'discord_link', e.target.value)} placeholder="Character thread link"  className="flex-1 w-full text-xs p-1.5 border rounded" />
          {arr.length > 1 && (
            <button type="button" onClick={() => removeSlot(i)} className="text-red-400 font-bold px-2 hover:text-red-600">x</button>
          )}
        </div>
      ))}
    </div>
  );
}
export default SlotsEditor;
