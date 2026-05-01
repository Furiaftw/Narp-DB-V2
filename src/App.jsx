import { useState, useEffect, useMemo, useCallback } from 'react';

// ============================================================
// CONFIG — V2 prototype, static (no database), jutsu-only focus
// ============================================================
const CACHE_KEY = 'narp_db_cache_v8';
const APP_VERSION = 'v6.2 (prototype)';
const ROLE_KEY = 'narp_preview_role_v1';

const MOCK_ADMIN = { uid: 'preview-admin', email: 'admin@preview.local', role: 'admin', status: 'approved', nickname: 'Preview Admin' };
const MOCK_USER = { uid: 'preview-user', email: 'user@preview.local', role: 'user', status: 'approved', nickname: 'Preview User' };

function loadPreviewRole() {
  try {
    const r = localStorage.getItem(ROLE_KEY);
    if (r === 'admin' || r === 'user') return r;
  } catch {}
  return 'user';
}
function savePreviewRole(r) { try { localStorage.setItem(ROLE_KEY, r); } catch {} }
function userForRole(r) { return r === 'admin' ? MOCK_ADMIN : MOCK_USER; }

const RANK_COST_MAP = { E: '1 CU', D: '2 CU', C: '4 CU', B: '6 CU', A: '8 CU', S: '10 CU' };
const RANK_COST_NUM = { E: 1, D: 2, C: 4, B: 6, A: 8, S: 10 };

// Display CU for a jutsu, optionally summing multi-rank values
const displayJutsuCost = (j, sumMultiRank = true) => {
  const ranks = (Array.isArray(j.rank) ? j.rank : String(j.rank || '').split(',').map(r => r.trim()).filter(Boolean));
  if (j.cost) {
    const autoSingle = ranks.length === 1 && RANK_COST_MAP[ranks[0]] ? RANK_COST_MAP[ranks[0]] : null;
    const autoJoin = ranks.length > 1 ? ranks.map(r => RANK_COST_MAP[r]).filter(Boolean).join(' / ') : null;
    const isAuto = j.cost === autoSingle || j.cost === autoJoin;
    if (!isAuto) return j.cost;
  }
  if (ranks.length === 0) return j.cost || '-';
  if (ranks.length === 1) return RANK_COST_MAP[ranks[0]] || j.cost || '-';
  if (sumMultiRank) {
    const total = ranks.reduce((s, r) => s + (RANK_COST_NUM[r] || 0), 0);
    return total ? `${total} CU` : (j.cost || '-');
  }
  return ranks.map(r => RANK_COST_MAP[r]).filter(Boolean).join(' / ') || j.cost || '-';
};

// Settings (tweaks) — persisted in localStorage
const TWEAKS_KEY = 'narp_tweaks_v1';
const DEFAULT_TWEAKS = {
  showSpec: true,
  showType: true,
  showCU: true,
  showBloodline: true,
  showOrigin: true,
  sumMultiRankCU: true,
  mobilePreview: false,
};
function loadTweaks() {
  try {
    const raw = localStorage.getItem(TWEAKS_KEY);
    if (raw) return { ...DEFAULT_TWEAKS, ...JSON.parse(raw) };
  } catch {}
  return { ...DEFAULT_TWEAKS };
}
function saveTweaks(t) { try { localStorage.setItem(TWEAKS_KEY, JSON.stringify(t)); } catch {} }

// Personal tags — localStorage per jutsu id
const PERSONAL_TAGS_KEY = 'narp_personal_tags_v1';
function loadPersonalTags() {
  try { return JSON.parse(localStorage.getItem(PERSONAL_TAGS_KEY) || '{}'); } catch { return {}; }
}
function savePersonalTags(map) { try { localStorage.setItem(PERSONAL_TAGS_KEY, JSON.stringify(map)); } catch {} }

const SPECIALIZATION_OPTIONS = ['Bukijutsu', 'Fuinjutsu', 'Genjutsu', 'Medical Ninjutsu', 'Ninjutsu', 'Nintaijutsu', 'Taijutsu', 'Kinjutsu'];

const MANAGE_TABLES = {
  jutsus: { label: 'Jutsus', fields: [
    { key: 'name', label: 'Jutsu Name', required: true },
    { key: 'nature', label: 'Nature Type', type: 'multi-select', options: ['Fire', 'Water', 'Earth', 'Wind', 'Lightning', 'Yin', 'Yang', 'Sound', 'N/A'] },
    { key: 'rank', label: 'Rank', type: 'multi-select', options: ['E', 'D', 'C', 'B', 'A', 'S'] },
    { key: 'cost', label: 'Cost', hidden: true },
    { key: 'types', label: 'Jutsu Types', type: 'multi-select', options: ['1 Post', 'Continuous', 'Multi-Post'] },
    { key: 'origin', label: 'Origin', type: 'select', options: ['', 'Canon', 'Custom'] },
    { key: 'conditions', label: 'Conditions', type: 'multi-select', options: ['Must Learn IC', 'Limited'], optional: true },
    { key: 'specialization', label: 'Specialization', type: 'multi-select-editable', options: SPECIALIZATION_OPTIONS },
    { key: 'doc_link', label: 'Doc Link' },
    { key: 'bloodline', label: 'Bloodline', type: 'bloodline-select', optional: true },
    { key: 'slots', label: 'Slots', type: 'slots', hidden_unless_includes: { field: 'conditions', value: 'Limited' } },
  ]},
  bloodlines: { label: 'Bloodlines', fields: [
    { key: 'category', label: 'Category', type: 'select', options: ['', 'Canon', 'Custom'], required: true },
    { key: 'subcategory', label: 'Type', type: 'select', options: ['', 'KKG', 'Clan'], required: true },
    { key: 'name', label: 'Name', required: true },
    { key: 'doc_link', label: 'Google Doc Link' },
  ]},
};

// ============================================================
// ICONS
// ============================================================
const Icon = ({ path, size = 24, className = "" }) => (
  <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>{path}</svg>
);
const Search = (p) => <Icon {...p} path={<><circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" /></>} />;
const ExternalLink = (p) => <Icon {...p} path={<><path d="M15 3h6v6" /><path d="M10 14 21 3" /><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /></>} />;
const Copy = (p) => <Icon {...p} path={<><rect width="14" height="14" x="8" y="8" rx="2" ry="2" /><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" /></>} />;
const Check = (p) => <Icon {...p} path={<path d="M20 6 9 17l-5-5" />} />;
const FilterIcon = (p) => <Icon {...p} path={<polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />} />;
const ChevronDown = (p) => <Icon {...p} path={<path d="m6 9 6 6 6-6" />} />;
const ChevronUp = (p) => <Icon {...p} path={<path d="m18 15-6-6-6 6" />} />;
const TagIcon = (p) => <Icon {...p} path={<><path d="M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42l-8.704-8.704z" /><circle cx="7.5" cy="7.5" r=".5" fill="currentColor" /></>} />;
const BookOpen = (p) => <Icon {...p} path={<><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" /><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" /></>} />;
const AlertCircle = (p) => <Icon {...p} path={<><circle cx="12" cy="12" r="10" /><line x1="12" x2="12" y1="8" y2="12" /><line x1="12" x2="12.01" y1="16" y2="16" /></>} />;
const Shield = (p) => <Icon {...p} path={<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10" />} />;
const Key = (p) => <Icon {...p} path={<><circle cx="7.5" cy="15.5" r="5.5" /><path d="m21 2-9.6 9.6" /><path d="m15.5 7.5 3 3L22 7l-3-3" /></>} />;
const CheckCircle = (p) => <Icon {...p} path={<><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" /></>} />;
const RefreshCw = (p) => <Icon {...p} path={<><polyline points="23 4 23 10 17 10" /><polyline points="1 20 1 14 7 14" /><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" /></>} />;
const Database = (p) => <Icon {...p} path={<><ellipse cx="12" cy="5" rx="9" ry="3" /><path d="M3 5V19A9 3 0 0 0 21 19V5" /><path d="M3 12A9 3 0 0 0 21 12" /></>} />;
const PlusCircle = (p) => <Icon {...p} path={<><circle cx="12" cy="12" r="10" /><line x1="12" x2="12" y1="8" y2="16" /><line x1="8" x2="16" y1="12" y2="12" /></>} />;
const Edit2 = (p) => <Icon {...p} path={<><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" /></>} />;
const Trash2 = (p) => <Icon {...p} path={<><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /><line x1="10" x2="10" y1="11" y2="17" /><line x1="14" x2="14" y1="11" y2="17" /></>} />;
const Save = (p) => <Icon {...p} path={<><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" /><polyline points="17 21 17 13 7 13 7 21" /><polyline points="7 3 7 8 15 8" /></>} />;
const Settings = (p) => <Icon {...p} path={<><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" /></>} />;
const Info = (p) => <Icon {...p} path={<><circle cx="12" cy="12" r="10" /><line x1="12" x2="12" y1="16" y2="12" /><line x1="12" x2="12.01" y1="8" y2="8" /></>} />;
const Smartphone = (p) => <Icon {...p} path={<><rect width="14" height="20" x="5" y="2" rx="2" ry="2" /><line x1="12" x2="12.01" y1="18" y2="18" /></>} />;
const Plus = (p) => <Icon {...p} path={<><line x1="12" x2="12" y1="5" y2="19" /><line x1="5" x2="19" y1="12" y2="12" /></>} />;
const X = (p) => <Icon {...p} path={<><line x1="18" x2="6" y1="6" y2="18" /><line x1="6" x2="18" y1="6" y2="18" /></>} />;

// ============================================================
// CHECKBOX DROPDOWN COMPONENT
// ============================================================
function CheckboxDropdown({ label, options, selected, onChange, placeholder, allowAdd, onAddOption, onRemoveOption }) {
  const [open, setOpen] = useState(false);
  const [addInput, setAddInput] = useState('');
  const selectedArr = typeof selected === 'string' ? selected.split(',').map(s => s.trim()).filter(Boolean) : (Array.isArray(selected) ? selected : []);

  const toggle = (opt) => {
    const newArr = selectedArr.includes(opt) ? selectedArr.filter(s => s !== opt) : [...selectedArr, opt];
    onChange(newArr.join(', '));
  };

  const handleAdd = () => {
    const val = addInput.trim();
    if (val && !options.includes(val)) {
      if (onAddOption) onAddOption(val);
      const newArr = [...selectedArr, val];
      onChange(newArr.join(', '));
      setAddInput('');
    }
  };

  return (
    <div className="relative">
      <button type="button" onClick={() => setOpen(!open)} className="w-full text-sm bg-slate-50 border border-slate-200 rounded-lg p-2.5 text-left flex items-center justify-between focus:ring-2 focus:ring-indigo-500 outline-none min-h-[42px]">
        <span className={selectedArr.length > 0 ? 'text-slate-800' : 'text-slate-400'}>
          {selectedArr.length > 0 ? selectedArr.join(', ') : placeholder || `Select ${label}...`}
        </span>
        <ChevronDown size={14} className={`text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="absolute z-50 mt-1 w-full bg-white border border-slate-200 rounded-lg shadow-lg max-h-60 overflow-y-auto">
          {options.map(opt => (
            <label key={opt} className="flex items-center gap-2 px-3 py-2 hover:bg-slate-50 cursor-pointer text-sm">
              <input type="checkbox" checked={selectedArr.includes(opt)} onChange={() => toggle(opt)} className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 w-4 h-4" />
              <span>{opt}</span>
              {allowAdd && onRemoveOption && !SPECIALIZATION_OPTIONS.includes(opt) && (
                <button type="button" onClick={(e) => { e.preventDefault(); e.stopPropagation(); onRemoveOption(opt); }} className="ml-auto text-red-400 hover:text-red-600 text-xs">remove</button>
              )}
            </label>
          ))}
          {allowAdd && (
            <div className="border-t border-slate-100 p-2 flex gap-2">
              <input type="text" value={addInput} onChange={e => setAddInput(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleAdd(); }}} placeholder="Add new..." className="flex-1 text-sm border border-slate-200 rounded px-2 py-1 outline-none focus:ring-1 focus:ring-indigo-500" />
              <button type="button" onClick={handleAdd} className="text-xs bg-indigo-100 text-indigo-700 px-2 py-1 rounded font-bold hover:bg-indigo-200">Add</button>
            </div>
          )}
          <div className="border-t border-slate-100 p-1">
            <button type="button" onClick={() => setOpen(false)} className="w-full text-xs text-slate-500 hover:text-slate-700 py-1 font-semibold">Close</button>
          </div>
        </div>
      )}
    </div>
  );
}

// Slots editor component for limited items
function SlotsEditor({ value, onChange }) {
  const slots = (() => {
    try { return JSON.parse(value || '[]'); } catch { return []; }
  })();

  const slotsArr = slots.length > 0 ? [...slots] : [{ discord_id: '', username: '' }];
  const filledCount = slotsArr.filter(s => s.discord_id && s.username).length;
  const totalSlots = slotsArr.length;
  const remainingSlots = totalSlots - filledCount;

  const updateSlot = (idx, field, val) => {
    const updated = [...slotsArr];
    updated[idx] = { ...updated[idx], [field]: val };
    onChange(JSON.stringify(updated));
  };

  const setSlotCount = (count) => {
    const num = Math.max(1, parseInt(count) || 1);
    const updated = [...slotsArr];
    while (updated.length < num) updated.push({ discord_id: '', username: '' });
    while (updated.length > num) updated.pop();
    onChange(JSON.stringify(updated));
  };

  const addSlot = () => {
    const updated = [...slotsArr, { discord_id: '', username: '' }];
    onChange(JSON.stringify(updated));
  };

  const removeSlot = (idx) => {
    if (slotsArr.length <= 1) return;
    const updated = slotsArr.filter((_, i) => i !== idx);
    onChange(JSON.stringify(updated));
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between mb-1 gap-3">
        <span className="text-xs font-semibold text-slate-500">{filledCount}/{totalSlots} slots filled — {remainingSlots} remaining</span>
        <div className="flex items-center gap-2">
          <label className="text-xs font-semibold text-slate-500">Total Slots:</label>
          <input type="number" min="1" value={totalSlots} onChange={e => setSlotCount(e.target.value)} className="w-16 text-xs bg-slate-50 border border-slate-200 rounded px-2 py-1 outline-none focus:ring-1 focus:ring-indigo-500 text-center" />
          <button type="button" onClick={addSlot} className="text-xs bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded font-bold hover:bg-indigo-200">+ Add Slot</button>
        </div>
      </div>
      {slotsArr.map((slot, idx) => (
        <div key={idx} className="flex gap-2 items-center">
          <span className="text-xs text-slate-400 w-6 shrink-0">#{idx + 1}</span>
          <input type="text" value={slot.discord_id || ''} onChange={e => updateSlot(idx, 'discord_id', e.target.value)} placeholder="Discord ID" className="flex-1 text-xs bg-slate-50 border border-slate-200 rounded px-2 py-1.5 outline-none focus:ring-1 focus:ring-indigo-500" />
          <input type="text" value={slot.username || ''} onChange={e => updateSlot(idx, 'username', e.target.value)} placeholder="Username" className="flex-1 text-xs bg-slate-50 border border-slate-200 rounded px-2 py-1.5 outline-none focus:ring-1 focus:ring-indigo-500" />
          {slotsArr.length > 1 && (
            <button type="button" onClick={() => removeSlot(idx)} className="text-red-400 hover:text-red-600 text-xs p-1">x</button>
          )}
        </div>
      ))}
    </div>
  );
}

// Bloodline select dropdown — reads from in-memory bloodlinesDb prop
function BloodlineSelect({ value, onChange, bloodlinesDb }) {
  const [open, setOpen] = useState(false);
  const [filterCat, setFilterCat] = useState('All');
  const [filterSub, setFilterSub] = useState('All');

  const bloodlines = useMemo(() => {
    const out = [];
    Object.entries(bloodlinesDb || {}).forEach(([cat, names]) => {
      (names || []).forEach((name, i) => {
        const lower = String(cat).toLowerCase();
        const subcategory = lower.includes('kkg') ? 'KKG' : 'Clan';
        const category = lower.includes('canon') ? 'Canon' : 'Custom';
        out.push({ id: `${cat}-${i}`, name, category, subcategory });
      });
    });
    return out;
  }, [bloodlinesDb]);

  const filtered = bloodlines.filter(b => {
    if (filterCat !== 'All' && b.category !== filterCat) return false;
    if (filterSub !== 'All' && b.subcategory !== filterSub) return false;
    return true;
  });

  return (
    <div className="relative">
      <button type="button" onClick={() => setOpen(!open)} className="w-full text-sm bg-slate-50 border border-slate-200 rounded-lg p-2.5 text-left flex items-center justify-between focus:ring-2 focus:ring-indigo-500 outline-none min-h-[42px]">
        <span className={value ? 'text-slate-800' : 'text-slate-400'}>{value || 'Select Bloodline...'}</span>
        <ChevronDown size={14} className={`text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="absolute z-50 mt-1 w-full bg-white border border-slate-200 rounded-lg shadow-lg max-h-72 overflow-hidden flex flex-col">
          <div className="p-2 border-b border-slate-100 flex gap-1 flex-wrap">
            {['All', 'Canon', 'Custom'].map(c => (
              <button key={c} type="button" onClick={() => setFilterCat(c)} className={`text-xs px-2 py-0.5 rounded font-bold ${filterCat === c ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>{c}</button>
            ))}
            <span className="text-slate-300 mx-1">|</span>
            {['All', 'KKG', 'Clan'].map(s => (
              <button key={s} type="button" onClick={() => setFilterSub(s)} className={`text-xs px-2 py-0.5 rounded font-bold ${filterSub === s ? 'bg-purple-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>{s}</button>
            ))}
          </div>
          <div className="overflow-y-auto max-h-48">
            {filtered.length === 0 ? (
              <div className="p-3 text-xs text-slate-400 text-center">No bloodlines found</div>
            ) : (
              filtered.map(b => (
                <button key={b.id} type="button" onClick={() => { onChange(b.name); setOpen(false); }}
                  className={`w-full text-left px-3 py-2 text-sm hover:bg-slate-50 flex items-center justify-between ${value === b.name ? 'bg-indigo-50 text-indigo-700' : 'text-slate-700'}`}>
                  <span>{b.name}</span>
                  <span className="text-[10px] text-slate-400">{b.category} {b.subcategory || ''}</span>
                </button>
              ))
            )}
          </div>
          <div className="border-t border-slate-100 p-1 flex gap-1">
            <button type="button" onClick={() => { onChange(''); setOpen(false); }} className="flex-1 text-xs text-slate-400 hover:text-slate-600 py-1 font-semibold">Clear</button>
            <button type="button" onClick={() => setOpen(false)} className="flex-1 text-xs text-slate-500 hover:text-slate-700 py-1 font-semibold">Close</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================
// STATIC CONSTANTS
// ============================================================
const NATURES = ["Fire", "Water", "Lightning", "Earth", "Wind", "Yang", "Yin", "Sound"];
const JUTSU_TYPES = ["1 Post", "Continuous", "Multi-Post"];
const RANKS = ["E", "D", "C", "B", "A", "S"];
const ORIGIN = ["Canon", "Custom"];

const getNatureColor = (nature) => {
  const colors = {
    "Fire": "bg-orange-100 text-orange-800 border-orange-200",
    "Water": "bg-blue-100 text-blue-800 border-blue-200",
    "Lightning": "bg-yellow-200 text-yellow-900 border-yellow-300",
    "Earth": "bg-red-900 text-red-100 border-red-800",
    "Wind": "bg-green-100 text-green-800 border-green-200",
    "Yang": "bg-amber-100 text-amber-900 border-amber-300",
    "Yin": "bg-purple-100 text-purple-900 border-purple-300",
    "Sound": "bg-pink-100 text-pink-800 border-pink-200",
  };
  return colors[nature] || "bg-slate-200 text-slate-800 border-slate-300";
};

// ============================================================
// HELPERS
// ============================================================
function toArray(val) {
  if (Array.isArray(val)) return val;
  if (typeof val === 'string' && val.trim() !== '') return val.split(',').map(s => s.trim()).filter(Boolean);
  return [];
}

function deriveClanCategory(bloodlineName, bloodlineDb) {
  if (!bloodlineName || bloodlineName === '') return 'None';
  for (const [cat, names] of Object.entries(bloodlineDb)) {
    if (names.includes(bloodlineName)) return cat;
  }
  return 'None';
}

// Load data from localStorage cache only (no API call)
function loadCachedData() {
  try { localStorage.removeItem('narp_jutsu_cache'); } catch(e) {}
  for (let i = 2; i <= 7; i++) {
    try { localStorage.removeItem(`narp_db_cache_v${i}`); } catch(e) {}
  }

  try {
    const cached = localStorage.getItem(CACHE_KEY);
    if (cached) {
      const parsed = JSON.parse(cached);
      return parsed;
    }
  } catch (e) { }
  return null;
}

// V2 prototype: static seed data so the UI works without a database.
const STATIC_SEED = {
  bloodlines: {
    'Canon KKG': ['Sharingan', 'Byakugan', 'Mokuton'],
    'Canon Clan': ['Uchiha', 'Hyuga', 'Uzumaki', 'Senju', 'Aburame'],
    'Custom KKG': ['Crystal Release', 'Storm Release'],
    'Custom Clan': ['Hozuki', 'Yamanaka'],
  },
  jutsus: [
    { _id: 'jutsu-0', name: 'Fireball Jutsu', nature: 'Fire', rank: ['C'], cost: '', types: ['1 Post'], origin: 'Canon', spec: ['Ninjutsu'], link: '', clanCat: 'Canon Clan', clanName: 'Uchiha', limited: false, mustLearnIC: false, multiRank: false, slots: '' },
    { _id: 'jutsu-1', name: 'Chidori', nature: 'Lightning', rank: ['B', 'A'], cost: '', types: ['1 Post'], origin: 'Canon', spec: ['Ninjutsu'], link: '', clanCat: 'None', clanName: 'None', limited: false, mustLearnIC: true, multiRank: true, slots: '' },
    { _id: 'jutsu-2', name: 'Rasengan', nature: 'Wind', rank: ['A'], cost: '', types: ['1 Post'], origin: 'Canon', spec: ['Ninjutsu'], link: '', clanCat: 'Canon Clan', clanName: 'Uzumaki', limited: false, mustLearnIC: false, multiRank: false, slots: '' },
    { _id: 'jutsu-3', name: 'Gentle Fist Strike', nature: '', rank: ['D', 'C', 'B'], cost: '', types: ['1 Post'], origin: 'Canon', spec: ['Taijutsu'], link: '', clanCat: 'Canon KKG', clanName: 'Byakugan', limited: false, mustLearnIC: true, multiRank: true, slots: '' },
    { _id: 'jutsu-4', name: 'Crystal Wall', nature: '', rank: ['B'], cost: '', types: ['Continuous'], origin: 'Custom', spec: ['Ninjutsu'], link: '', clanCat: 'Custom KKG', clanName: 'Crystal Release', limited: true, mustLearnIC: false, multiRank: false, slots: JSON.stringify([{ discord_id: '', username: '' }, { discord_id: '', username: '' }]) },
    { _id: 'jutsu-5', name: 'Shadow Doppelgänger', nature: '', rank: ['B'], cost: '', types: ['Continuous'], origin: 'Canon', spec: ['Ninjutsu'], link: '', clanCat: 'None', clanName: 'None', limited: false, mustLearnIC: false, multiRank: false, slots: '' },
  ],
};

// Normalize cached jutsu shape (older caches may have stored arrays)
function normalizeCachedJutsus(arr, bloodlinesDb) {
  return (arr || []).map((j, idx) => ({
    _id: j._id || `jutsu-${idx}`,
    name: j.name || '',
    nature: j.nature || '',
    rank: Array.isArray(j.rank) ? j.rank : String(j.rank || '').split(',').map(r => r.trim()).filter(Boolean),
    cost: j.cost || '',
    types: Array.isArray(j.types) ? j.types : String(j.types || '').split(',').map(t => t.trim()).filter(Boolean),
    origin: j.origin || '',
    spec: Array.isArray(j.spec) ? j.spec : String(j.spec || '').split(',').map(s => s.trim()).filter(Boolean),
    link: j.link || '',
    clanCat: j.clanCat || deriveClanCategory(j.clanName, bloodlinesDb || {}),
    clanName: j.clanName || 'None',
    limited: !!j.limited,
    mustLearnIC: !!j.mustLearnIC,
    multiRank: !!j.multiRank,
    slots: j.slots || '',
  }));
}

function loadStaticData() {
  const cached = loadCachedData();
  if (cached && cached.jutsus && cached.jutsus.length > 0) {
    return {
      jutsus: normalizeCachedJutsus(cached.jutsus, cached.bloodlines),
      bloodlines: cached.bloodlines || {},
    };
  }
  const seed = {
    jutsus: STATIC_SEED.jutsus,
    bloodlines: STATIC_SEED.bloodlines,
  };
  try { localStorage.setItem(CACHE_KEY, JSON.stringify({ ...seed, ts: Date.now() })); } catch {}
  return seed;
}

// ============================================================
// MAIN APP
// ============================================================
function App() {
  const [jutsus, setJutsus] = useState([]);
  const [bloodlines, setBloodlines] = useState({});
  const [dataLoading, setDataLoading] = useState(true);
  const [dataError, setDataError] = useState(null);

  const [previewRole, setPreviewRole] = useState(loadPreviewRole);
  const currentUser = useMemo(() => userForRole(previewRole), [previewRole]);
  const togglePreviewRole = useCallback(() => {
    setPreviewRole(prev => {
      const next = prev === 'admin' ? 'user' : 'admin';
      savePreviewRole(next);
      return next;
    });
  }, []);

  const [view, setView] = useState('browser');

  const [searchTerm, setSearchTerm] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const [copiedId, setCopiedId] = useState(null);
  const [fNature, setFNature] = useState('Any');
  const [fOrigin, setFOrigin] = useState('Any');
  const [fSpec, setFSpec] = useState('Any');
  const [fType, setFType] = useState('Any');
  const [fRank, setFRank] = useState('Any');
  const [fClanCat, setFClanCat] = useState('Any');
  const [fClanName, setFClanName] = useState('Any');
  const [fLimited, setFLimited] = useState(false);
  const [fMultiRank, setFMultiRank] = useState(false);

  // Manage Data panel state
  const [manageTable, setManageTable] = useState('jutsus');
  const [manageRows, setManageRows] = useState([]);
  const [manageLoading] = useState(false);
  const [manageError, setManageError] = useState(null);
  const [manageSuccess, setManageSuccess] = useState(null);
  const [editingRow, setEditingRow] = useState(null);
  const [formData, setFormData] = useState({});
  const [customCost, setCustomCost] = useState(false);
  const [manageSearch, setManageSearch] = useState('');
  const [customSpecs, setCustomSpecs] = useState([]);

  // Tweaks (display settings)
  const [tweaks, setTweaks] = useState(loadTweaks);
  const [tweaksOpen, setTweaksOpen] = useState(false);
  const [creditsOpen, setCreditsOpen] = useState(false);
  const updateTweak = useCallback((key, value) => {
    setTweaks(prev => {
      const next = { ...prev, [key]: value };
      saveTweaks(next);
      return next;
    });
  }, []);

  // Personal tags (per-jutsu, localStorage)
  const [personalTags, setPersonalTags] = useState(loadPersonalTags);
  const setPersonalTagsForJutsu = useCallback((jid, list) => {
    setPersonalTags(prev => {
      const next = { ...prev };
      if (!list || list.length === 0) delete next[jid]; else next[jid] = list;
      savePersonalTags(next);
      return next;
    });
  }, []);

  const CLAN_CATEGORIES = useMemo(() => Object.keys(bloodlines), [bloodlines]);
  const SPECIALIZATIONS = useMemo(() => {
    const specs = new Set(jutsus.flatMap(j => toArray(j.spec)));
    return [...specs].sort();
  }, [jutsus]);

  useEffect(() => {
    try {
      const data = loadStaticData();
      setJutsus(data.jutsus);
      setBloodlines(data.bloodlines);
    } catch (err) {
      setDataError(err.message);
    }
    setDataLoading(false);
  }, []);

  const jutsuToRow = useCallback((j) => ({
    id: j._id,
    name: j.name,
    nature: j.nature || '',
    rank: Array.isArray(j.rank) ? j.rank.join(', ') : (j.rank || ''),
    cost: j.cost || '',
    types: Array.isArray(j.types) ? j.types.join(', ') : (j.types || ''),
    origin: j.origin || '',
    conditions: [j.limited ? 'Limited' : '', j.mustLearnIC ? 'Must Learn IC' : ''].filter(Boolean).join(', '),
    specialization: Array.isArray(j.spec) ? j.spec.join(', ') : (j.spec || ''),
    doc_link: j.link || '',
    bloodline: j.clanName && j.clanName !== 'None' ? j.clanName : '',
    slots: j.slots || '',
  }), []);

  const bloodlineRows = useMemo(() => {
    const out = [];
    let i = 0;
    Object.entries(bloodlines).forEach(([cat, names]) => {
      const lower = String(cat).toLowerCase();
      const subcategory = lower.includes('kkg') ? 'KKG' : 'Clan';
      const category = lower.includes('canon') ? 'Canon' : 'Custom';
      (names || []).forEach((name) => {
        out.push({ id: `bl-${i++}`, category, subcategory, name, doc_link: '' });
      });
    });
    return out;
  }, [bloodlines]);

  const manageRowsForTable = useCallback((table) => {
    if (table === 'jutsus') return jutsus.map(jutsuToRow);
    if (table === 'bloodlines') return bloodlineRows;
    return [];
  }, [jutsus, bloodlineRows, jutsuToRow]);

  useEffect(() => {
    if (view === 'manage_data' && currentUser.role === 'admin') {
      setManageRows(manageRowsForTable(manageTable));
    }
  }, [view, manageTable, manageRowsForTable, currentUser.role]);

  const handleCopyLink = (link, id) => {
    navigator.clipboard.writeText(link).then(() => {
      setCopiedId(id); setTimeout(() => setCopiedId(null), 2000);
    }).catch(() => {
      const ta = document.createElement("textarea"); ta.value = link;
      document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); setCopiedId(id); setTimeout(() => setCopiedId(null), 2000); } catch (e) { }
      document.body.removeChild(ta);
    });
  };

  const handleForceRefresh = () => {
    setDataLoading(true);
    setDataError(null);
    try { localStorage.removeItem(CACHE_KEY); } catch {}
    const data = loadStaticData();
    setJutsus(data.jutsus);
    setBloodlines(data.bloodlines);
    setDataLoading(false);
  };

  const handleManageTableChange = (table) => {
    setManageTable(table);
    setEditingRow(null);
    setFormData({});
    setManageSearch('');
    setManageSuccess(null);
    setManageError(null);
    setManageRows(manageRowsForTable(table));
  };

  const handleStartAdd = () => {
    const empty = {};
    MANAGE_TABLES[manageTable].fields.forEach(f => {
      if (f.type === 'slots') {
        empty[f.key] = JSON.stringify([
          { discord_id: '', username: '' },
        ]);
      } else {
        empty[f.key] = '';
      }
    });
    setFormData(empty);
    setEditingRow({});
    setCustomCost(false);
    setManageSuccess(null);
    setManageError(null);
  };

  const handleStartEdit = (row) => {
    const data = {};
    MANAGE_TABLES[manageTable].fields.forEach(f => { data[f.key] = row[f.key] || ''; });
    setFormData(data);
    setEditingRow(row);
    if (manageTable === 'jutsus') {
      const ranks = (data.rank || '').split(',').map(r => r.trim()).filter(Boolean);
      if (ranks.length === 1 && RANK_COST_MAP[ranks[0]]) {
        setCustomCost(data.cost !== '' && data.cost !== RANK_COST_MAP[ranks[0]]);
      } else if (ranks.length > 1) {
        const autoCost = ranks.map(r => RANK_COST_MAP[r]).filter(Boolean).join(' / ');
        setCustomCost(data.cost !== '' && data.cost !== autoCost);
      } else {
        setCustomCost(data.cost !== '' && !data.rank);
      }
    } else {
      setCustomCost(false);
    }
    setManageSuccess(null);
    setManageError(null);
  };

  const handleCancelEdit = () => {
    setEditingRow(null);
    setFormData({});
    setCustomCost(false);
  };

  const upsertJutsu = (payload, existingId) => {
    const ranks = (payload.rank || '').split(',').map(r => r.trim()).filter(Boolean);
    const conditions = (payload.conditions || '').split(',').map(c => c.trim()).filter(Boolean);
    const specs = (payload.specialization || '').split(',').map(s => s.trim()).filter(Boolean);
    const types = (payload.types || '').split(',').map(t => t.trim()).filter(Boolean);
    const newJutsu = {
      _id: existingId || `jutsu-${Date.now()}`,
      name: payload.name || '',
      nature: payload.nature || '',
      rank: ranks,
      cost: payload.cost || '',
      types,
      origin: payload.origin || '',
      spec: specs,
      link: payload.doc_link || '',
      clanCat: deriveClanCategory(payload.bloodline, bloodlines),
      clanName: payload.bloodline || 'None',
      limited: conditions.includes('Limited'),
      mustLearnIC: conditions.some(c => c.toLowerCase().includes('learn ic')),
      multiRank: ranks.length > 1,
      slots: conditions.includes('Limited') ? (payload.slots || '') : '',
    };
    setJutsus(prev => existingId ? prev.map(j => j._id === existingId ? newJutsu : j) : [...prev, newJutsu]);
  };

  const upsertBloodline = (payload, existingId) => {
    const subcategory = payload.subcategory || 'Clan';
    const category = payload.category || 'Custom';
    const bucket = `${category} ${subcategory}`;
    setBloodlines(prev => {
      const next = {};
      let idx = 0;
      Object.entries(prev).forEach(([k, names]) => {
        next[k] = (names || []).filter(() => {
          const keep = !existingId || `bl-${idx}` !== existingId;
          idx += 1;
          return keep;
        });
      });
      next[bucket] = [...(next[bucket] || []), payload.name].filter(Boolean);
      return next;
    });
  };

  const handleSaveRow = () => {
    setManageError(null);
    setManageSuccess(null);
    try {
      const isNew = !editingRow.id;
      const payload = { ...formData };

      if (manageTable === 'jutsus' && !customCost) {
        const ranks = (payload.rank || '').split(',').map(r => r.trim()).filter(Boolean);
        if (ranks.length === 1 && RANK_COST_MAP[ranks[0]]) {
          payload.cost = RANK_COST_MAP[ranks[0]];
        } else if (ranks.length > 1) {
          const costs = ranks.map(r => RANK_COST_MAP[r]).filter(Boolean);
          payload.cost = costs.length > 0 ? costs.join(' / ') : '';
        }
      }

      if (manageTable === 'jutsus') upsertJutsu(payload, isNew ? null : editingRow.id);
      else if (manageTable === 'bloodlines') upsertBloodline(payload, isNew ? null : editingRow.id);

      setManageSuccess((isNew ? 'Item added' : 'Item updated') + ' (prototype — local only).');
      setEditingRow(null);
      setFormData({});
      setTimeout(() => setManageRows(manageRowsForTable(manageTable)), 0);
    } catch (err) {
      setManageError(err.message);
    }
  };

  const handleDeleteRow = (id) => {
    if (!confirm('Are you sure you want to delete this item? (Prototype: local only)')) return;
    if (manageTable === 'jutsus') setJutsus(prev => prev.filter(j => j._id !== id));
    else if (manageTable === 'bloodlines') {
      setBloodlines(prev => {
        const next = {};
        let idx = 0;
        Object.entries(prev).forEach(([k, names]) => {
          next[k] = (names || []).filter(() => {
            const keep = `bl-${idx}` !== id;
            idx += 1;
            return keep;
          });
        });
        return next;
      });
    }
    setManageSuccess('Item deleted (prototype — local only).');
    setTimeout(() => setManageRows(manageRowsForTable(manageTable)), 0);
  };

  const filteredJutsus = useMemo(() => {
    return jutsus.filter(j => {
      const specArr = toArray(j.spec);
      const rankArr = toArray(j.rank);
      const matchSearch = j.name.toLowerCase().includes(searchTerm.toLowerCase());
      const matchNature = fNature === 'Any' || j.nature === fNature;
      const matchOrigin = fOrigin === 'Any' || j.origin === fOrigin;
      const matchSpec = fSpec === 'Any' || specArr.includes(fSpec);
      const matchType = fType === 'Any' || j.types.includes(fType);
      const matchRank = fRank === 'Any' || rankArr.includes(fRank);
      let matchClan = true;
      if (fClanCat !== 'Any') matchClan = j.clanCat === fClanCat && (fClanName === 'Any' || j.clanName === fClanName);
      const matchLimited = fLimited ? j.limited === true : true;
      const matchMultiRank = fMultiRank ? j.multiRank === true : true;
      return matchSearch && matchNature && matchOrigin && matchSpec && matchType && matchRank && matchClan && matchLimited && matchMultiRank;
    });
  }, [jutsus, searchTerm, fNature, fOrigin, fSpec, fType, fRank, fClanCat, fClanName, fLimited, fMultiRank]);

  if (dataLoading) {
    return (
      <div className="w-full h-screen bg-slate-900 flex flex-col items-center justify-center gap-4">
        <div className="w-8 h-8 border-3 border-slate-600 border-t-indigo-500 rounded-full animate-spin"></div>
        <p className="text-slate-400 text-sm font-semibold">Loading NARP Database...</p>
        {dataError && <p className="text-red-400 text-xs">Error: {dataError}</p>}
      </div>
    );
  }

  const isDataEmpty = jutsus.length === 0;

  const renderEmptyState = () => (
    <div className="flex-1 flex flex-col items-center justify-center gap-4 bg-slate-100 p-8">
      <Database size={48} className="text-slate-400" />
      <p className="text-slate-700 text-lg font-semibold">No Data Available</p>
      {dataError && <p className="text-red-500 text-sm">Error: {dataError}</p>}
      <div className="text-center">
        <p className="text-slate-500 text-sm mb-3">Reload the seed dataset to populate the database.</p>
        <button onClick={handleForceRefresh} className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg text-sm font-semibold flex items-center gap-2 mx-auto transition-colors">
          <RefreshCw size={14} /> Reload Seed
        </button>
      </div>
    </div>
  );

  const renderBrowser = () => (
    <div className="flex-1 flex flex-col overflow-hidden h-full">
      <div className="bg-slate-900 text-white p-4 shadow-md z-10 shrink-0">
        <div className="relative mb-3 max-w-4xl mx-auto">
          <Search className="absolute left-3 top-3 text-slate-400" size={18} />
          <input type="text" placeholder="Search jutsu name..." className="w-full bg-slate-800 text-white rounded-xl py-2.5 pl-10 pr-4 outline-none focus:ring-2 focus:ring-indigo-500 text-sm" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} />
        </div>
        <div className="flex items-center gap-2 overflow-x-auto flex-nowrap md:flex-wrap pb-1 scrollbar-hide max-w-4xl mx-auto">
          {['Any', ...NATURES].map(n => (
            <button key={n} onClick={() => setFNature(n)} className={`px-4 py-1.5 rounded-full text-xs font-bold whitespace-nowrap border transition-colors ${fNature === n ? 'bg-indigo-500 border-indigo-400 text-white shadow-lg shadow-indigo-500/30' : 'bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-700'}`}>{n}</button>
          ))}
        </div>
        <button onClick={() => setShowFilters(!showFilters)} className="w-full max-w-4xl mx-auto mt-3 bg-slate-800 border border-slate-700 text-slate-300 py-2.5 rounded-lg text-sm font-semibold flex items-center justify-center gap-2 hover:bg-slate-700 transition-colors">
          <FilterIcon size={16} /> {showFilters ? 'Hide Advanced Filters' : 'Show Advanced Filters'}
          {showFilters ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </button>
      </div>

      {showFilters && (
        <div className="bg-white border-b border-slate-200 p-4 shadow-inner overflow-y-auto max-h-72 shrink-0">
          <div className="max-w-4xl mx-auto">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div><label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Origin</label><select value={fOrigin} onChange={e => setFOrigin(e.target.value)} className="w-full text-sm bg-slate-50 border rounded p-2.5 focus:ring-2 focus:ring-indigo-500 outline-none"><option value="Any">All Origins</option>{ORIGIN.map(o => <option key={o} value={o}>{o}</option>)}</select></div>
              <div><label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Type</label><select value={fType} onChange={e => setFType(e.target.value)} className="w-full text-sm bg-slate-50 border rounded p-2.5 focus:ring-2 focus:ring-indigo-500 outline-none"><option value="Any">All Types</option>{JUTSU_TYPES.map(t => <option key={t} value={t}>{t}</option>)}</select></div>
              <div><label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Rank</label><select value={fRank} onChange={e => setFRank(e.target.value)} className="w-full text-sm bg-slate-50 border rounded p-2.5 focus:ring-2 focus:ring-indigo-500 outline-none"><option value="Any">All Ranks</option>{RANKS.map(r => <option key={r} value={r}>{r}</option>)}</select></div>
              <div><label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Specialization</label><select value={fSpec} onChange={e => setFSpec(e.target.value)} className="w-full text-sm bg-slate-50 border rounded p-2.5 focus:ring-2 focus:ring-indigo-500 outline-none"><option value="Any">All Specs</option>{SPECIALIZATIONS.map(s => <option key={s} value={s}>{s}</option>)}</select></div>
            </div>
            <div className="border-t border-slate-100 pt-4 mt-4">
              <label className="block text-[10px] font-bold text-purple-600 uppercase mb-2 flex items-center gap-1"><TagIcon size={12} /> Bloodline Filters</label>
              <div className="flex flex-col md:flex-row gap-3">
                <select value={fClanCat} onChange={e => { setFClanCat(e.target.value); setFClanName('Any'); }} className="flex-1 text-sm bg-purple-50 border-purple-200 text-purple-900 rounded p-2.5 focus:ring-2 focus:ring-purple-500 outline-none">
                  <option value="Any">Any Bloodline</option>
                  {CLAN_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
                {fClanCat !== 'Any' && bloodlines[fClanCat] && (
                  <select value={fClanName} onChange={e => setFClanName(e.target.value)} className="flex-1 text-sm bg-white border-purple-200 text-purple-900 rounded p-2.5 focus:ring-2 focus:ring-purple-500 outline-none">
                    <option value="Any">All in {fClanCat}</option>
                    {bloodlines[fClanCat].map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                )}
              </div>
            </div>
            <div className="pt-4 mt-4 border-t border-slate-100 space-y-3">
              <div className="flex flex-wrap items-center gap-6">
                <label className="flex items-center gap-2 text-sm font-semibold text-slate-700 cursor-pointer"><input type="checkbox" checked={fLimited} onChange={e => setFLimited(e.target.checked)} className="rounded text-indigo-600 focus:ring-indigo-500 w-4 h-4" /> Limited Only</label>
                <label className="flex items-center gap-2 text-sm font-semibold text-slate-700 cursor-pointer"><input type="checkbox" checked={fMultiRank} onChange={e => setFMultiRank(e.target.checked)} className="rounded text-indigo-600 focus:ring-indigo-500 w-4 h-4" /> Multi-Rank Only</label>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-4 bg-slate-100 pb-10">
        <div className="max-w-7xl mx-auto">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <div className="text-xs font-bold text-slate-400 uppercase">{filteredJutsus.length} Results Found</div>
            </div>
            {currentUser?.role === 'admin' && (
              <button onClick={handleForceRefresh} className="text-xs text-slate-400 hover:text-slate-600 flex items-center gap-1 transition-colors"><RefreshCw size={12} /> Refresh</button>
            )}
          </div>

          {dataError && (
            <div className="bg-red-50 border border-red-200 rounded-xl p-4 mb-4 text-sm text-red-700 flex items-center gap-2">
              <AlertCircle size={16} /> Failed to load data: {dataError}
            </div>
          )}

          <div className="grid gap-4 grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {filteredJutsus.map(j => {
              const specArr = toArray(j.spec);
              const rankArr = toArray(j.rank);
              const myTags = personalTags[j._id] || [];
              return (
              <div key={j._id} className="bg-white rounded-2xl shadow-sm border border-slate-200 flex flex-col overflow-hidden hover:shadow-md transition-shadow">
                <div className="p-4 pb-0 flex-1">
                  <div className="flex justify-between items-start mb-2"><h2 className="text-xl font-bold leading-tight">{j.name}</h2></div>
                  <div className="flex flex-wrap gap-2 mb-4">
                    {j.nature && <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase border ${getNatureColor(j.nature)}`}>{j.nature}</span>}
                    {tweaks.showOrigin && j.origin && <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase border ${j.origin === 'Canon' ? 'bg-amber-50 text-amber-700 border-amber-200' : 'bg-cyan-50 text-cyan-700 border-cyan-200'}`}>{j.origin}</span>}
                    {j.limited && <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-rose-100 text-rose-800 border-rose-200 flex items-center gap-1"><AlertCircle size={10} /> Limited</span>}
                    {j.limited && j.slots && (() => {
                      try {
                        const slots = JSON.parse(j.slots);
                        const filled = slots.filter(s => s.discord_id && s.username).length;
                        const remaining = slots.length - filled;
                        return <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase flex items-center gap-1 ${remaining > 0 ? 'bg-emerald-100 text-emerald-800 border border-emerald-200' : 'bg-red-100 text-red-800 border border-red-200'}`}>{remaining > 0 ? `${remaining} slot${remaining !== 1 ? 's' : ''} open` : 'Full'}</span>;
                      } catch { return null; }
                    })()}
                  </div>
                  <div className="flex flex-wrap gap-1.5 mb-4">
                    {tweaks.showSpec && specArr.map(s => <span key={s} className="text-xs font-medium text-slate-600 bg-slate-100 px-2 py-1 rounded border border-slate-200">{s}</span>)}
                    {tweaks.showType && j.types.map(t => <span key={t} className="text-xs font-medium text-slate-600 bg-slate-100 px-2 py-1 rounded border border-slate-200">{t}</span>)}
                    {j.mustLearnIC && <span className="text-xs font-medium px-2 py-1 rounded border bg-slate-700 text-white border-slate-800">Must Learn IC</span>}
                    {tweaks.showBloodline && j.clanCat !== 'None' && j.clanName !== 'None' && j.clanName && <span className="text-xs font-bold text-purple-700 bg-purple-50 px-2 py-1 rounded border border-purple-200 flex items-center gap-1"><TagIcon size={12} /> {j.clanName} ({j.clanCat})</span>}
                    {myTags.map(t => (
                      <span key={t} className="group text-xs font-bold text-indigo-700 bg-indigo-50 px-2 py-1 rounded border border-indigo-200 flex items-center gap-1">
                        {t}
                        <button onClick={() => setPersonalTagsForJutsu(j._id, myTags.filter(x => x !== t))} className="opacity-50 group-hover:opacity-100 hover:text-red-600" title="Remove tag">×</button>
                      </span>
                    ))}
                    <button onClick={() => {
                      const t = prompt('Add a personal tag (e.g. "want", "learning"):');
                      const trimmed = t && t.trim();
                      if (!trimmed) return;
                      if (myTags.includes(trimmed)) return;
                      setPersonalTagsForJutsu(j._id, [...myTags, trimmed]);
                    }} className="text-xs font-semibold text-indigo-500 hover:text-indigo-700 hover:bg-indigo-50 border border-dashed border-indigo-200 px-2 py-1 rounded flex items-center gap-1" title="Add personal tag">
                      <Plus size={11} /> Tag
                    </button>
                  </div>
                </div>
                <div className="bg-slate-50 border-t border-slate-100 px-4 py-3 flex items-center justify-between mt-auto">
                  <div className="flex items-center gap-4">
                    <div><div className="text-[10px] font-bold text-slate-400 uppercase">Rank</div><div className="text-sm font-black text-slate-700">{rankArr.join(", ") || "-"}</div></div>
                    {tweaks.showCU && (
                      <>
                        <div className="h-6 w-px bg-slate-200"></div>
                        <div><div className="text-[10px] font-bold text-slate-400 uppercase">CU Cost</div><div className="text-sm font-black text-indigo-600">{displayJutsuCost(j, tweaks.sumMultiRankCU)}</div></div>
                      </>
                    )}
                  </div>
                  {j.multiRank && <span className="text-[10px] font-bold text-indigo-500 border border-indigo-200 bg-indigo-50 px-2 py-1 rounded-full uppercase shrink-0">Multi-Rank</span>}
                </div>
                <div className="p-4 pt-0 bg-slate-50 border-t border-slate-100 flex gap-2 pt-3">
                  {j.link && j.link !== 'Link' ? (
                    <a href={j.link} target="_blank" rel="noopener noreferrer" className="flex-1 bg-white border border-slate-200 text-indigo-700 hover:bg-indigo-50 hover:border-indigo-200 font-semibold py-2.5 px-4 rounded-xl flex items-center justify-center gap-2 text-sm transition-colors"><ExternalLink size={16} /> Doc</a>
                  ) : (
                    <span className="flex-1 bg-slate-100 border border-slate-200 text-slate-400 font-semibold py-2.5 px-4 rounded-xl flex items-center justify-center gap-2 text-sm cursor-not-allowed">No Doc</span>
                  )}
                  {j.link && j.link !== 'Link' && <button onClick={() => handleCopyLink(j.link, j._id)} className={`p-2.5 rounded-xl flex items-center justify-center min-w-[50px] transition-all border ${copiedId === j._id ? 'bg-green-500 border-green-500 text-white' : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-100'}`}>{copiedId === j._id ? <Check size={18} /> : <Copy size={18} />}</button>}
                </div>
              </div>
              );
            })}
          </div>

          {filteredJutsus.length === 0 && (
            <div className="text-center py-16">
              <AlertCircle size={40} className="text-slate-300 mx-auto mb-3" />
              <p className="text-slate-500 font-semibold">No jutsu match your filters.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );

  const renderManageData = () => {
    const tableConfig = MANAGE_TABLES[manageTable];
    const filteredManageRows = manageSearch.trim()
      ? manageRows.filter(r => Object.values(r).some(v => String(v).toLowerCase().includes(manageSearch.toLowerCase())))
      : manageRows;

    return (
      <div className="flex-1 bg-slate-50 overflow-y-auto p-4 md:p-8 pb-32">
        <div className="max-w-6xl mx-auto">
          <div className="mb-6 bg-indigo-700 text-white p-6 rounded-2xl flex items-center gap-4 shadow-lg">
            <Edit2 size={32} className="text-indigo-200" />
            <div>
              <h2 className="text-2xl font-bold">Manage Data</h2>
              <p className="text-sm text-indigo-200 mt-1">Add, edit, or delete jutsu and bloodline entries.</p>
            </div>
          </div>

          {/* Table selector */}
          <div className="flex items-center gap-2 overflow-x-auto flex-nowrap pb-1 scrollbar-hide mb-4">
            {Object.entries(MANAGE_TABLES).map(([key, cfg]) => (
              <button key={key} onClick={() => handleManageTableChange(key)} className={`px-4 py-2 rounded-lg text-sm font-bold whitespace-nowrap border transition-colors ${manageTable === key ? 'bg-indigo-600 border-indigo-500 text-white shadow-lg' : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-100'}`}>
                {cfg.label}
              </button>
            ))}
          </div>

          {manageSuccess && (
            <div className="mb-4 p-3 rounded-lg text-sm bg-emerald-50 text-emerald-800 border border-emerald-200 flex items-center gap-2">
              <CheckCircle size={16} /> {manageSuccess}
            </div>
          )}
          {manageError && (
            <div className="mb-4 p-3 rounded-lg text-sm bg-red-50 text-red-800 border border-red-200 flex items-center gap-2">
              <AlertCircle size={16} /> {manageError}
            </div>
          )}

          <div className="mb-4 p-3 rounded-lg text-xs bg-slate-100 border border-slate-200 text-slate-600 flex items-start gap-2">
            <AlertCircle size={14} className="mt-0.5 shrink-0" />
            <span>Static prototype: edits live in this browser session only and are not saved to a database.</span>
          </div>

          {editingRow !== null && (
            <div className="mb-6 bg-white rounded-2xl border border-indigo-200 shadow-md p-6">
              <h3 className="text-lg font-bold text-slate-800 mb-4 flex items-center gap-2">
                {editingRow.id ? <><Edit2 size={18} /> Edit {tableConfig.label.slice(0, -1)}</> : <><PlusCircle size={18} /> Add New {tableConfig.label.slice(0, -1)}</>}
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {tableConfig.fields.filter(f => {
                  if (f.hidden) return false;
                  if (f.hidden_unless) return formData[f.hidden_unless] === 'Yes';
                  if (f.hidden_unless_includes) {
                    const val = (formData[f.hidden_unless_includes.field] || '').split(',').map(v => v.trim());
                    return val.includes(f.hidden_unless_includes.value);
                  }
                  return true;
                }).map(field => (
                  <div key={field.key} className={field.type === 'slots' ? 'md:col-span-2' : ''}>
                    <label className="block text-xs font-bold text-slate-500 uppercase mb-1">
                      {field.label} {field.required && <span className="text-red-500">*</span>}
                      {field.optional && <span className="text-slate-400 normal-case font-normal ml-1">(optional)</span>}
                    </label>
                    {field.type === 'select' ? (
                      <select
                        value={formData[field.key] || ''}
                        onChange={(e) => setFormData({ ...formData, [field.key]: e.target.value })}
                        className="w-full text-sm bg-slate-50 border border-slate-200 rounded-lg p-2.5 focus:ring-2 focus:ring-indigo-500 outline-none"
                      >
                        {field.options.map(opt => (
                          <option key={opt} value={opt}>{opt || `— Select ${field.label} —`}</option>
                        ))}
                      </select>
                    ) : field.type === 'multi-select' ? (
                      <CheckboxDropdown
                        label={field.label}
                        options={field.options}
                        selected={formData[field.key] || ''}
                        onChange={(val) => setFormData({ ...formData, [field.key]: val })}
                      />
                    ) : field.type === 'multi-select-editable' ? (
                      <CheckboxDropdown
                        label={field.label}
                        options={[...new Set([...field.options, ...customSpecs])]}
                        selected={formData[field.key] || ''}
                        onChange={(val) => setFormData({ ...formData, [field.key]: val })}
                        allowAdd
                        onAddOption={(opt) => setCustomSpecs([...customSpecs, opt])}
                        onRemoveOption={(opt) => setCustomSpecs(customSpecs.filter(s => s !== opt))}
                      />
                    ) : field.type === 'bloodline-select' ? (
                      <BloodlineSelect
                        value={formData[field.key] || ''}
                        onChange={(val) => setFormData({ ...formData, [field.key]: val })}
                        bloodlinesDb={bloodlines}
                      />
                    ) : field.type === 'checkbox' ? (
                      <label className="flex items-center gap-2 cursor-pointer mt-1">
                        <input
                          type="checkbox"
                          checked={formData[field.key] === 'Yes'}
                          onChange={(e) => setFormData({ ...formData, [field.key]: e.target.checked ? 'Yes' : '' })}
                          className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 w-5 h-5"
                        />
                        <span className="text-sm text-slate-700">{field.label}</span>
                      </label>
                    ) : field.type === 'slots' ? (
                      <SlotsEditor
                        value={formData[field.key] || '[]'}
                        onChange={(val) => setFormData({ ...formData, [field.key]: val })}
                      />
                    ) : (
                      <input
                        type="text"
                        value={formData[field.key] || ''}
                        onChange={(e) => setFormData({ ...formData, [field.key]: e.target.value })}
                        className="w-full text-sm bg-slate-50 border border-slate-200 rounded-lg p-2.5 focus:ring-2 focus:ring-indigo-500 outline-none"
                        placeholder={field.label}
                      />
                    )}
                  </div>
                ))}
                {manageTable === 'jutsus' && (
                  <div>
                    <label className="block text-xs font-bold text-slate-500 uppercase mb-1">
                      Cost {!customCost && (() => {
                        const ranks = (formData.rank || '').split(',').map(r => r.trim()).filter(Boolean);
                        if (ranks.length === 1 && RANK_COST_MAP[ranks[0]]) return <span className="text-indigo-500 normal-case font-normal">(auto: {RANK_COST_MAP[ranks[0]]})</span>;
                        if (ranks.length > 1) return <span className="text-indigo-500 normal-case font-normal">(auto: {ranks.map(r => RANK_COST_MAP[r]).filter(Boolean).join(' / ')})</span>;
                        return null;
                      })()}
                    </label>
                    <div className="flex items-center gap-3">
                      {customCost ? (
                        <input
                          type="text"
                          value={formData.cost || ''}
                          onChange={(e) => setFormData({ ...formData, cost: e.target.value })}
                          className="flex-1 text-sm bg-slate-50 border border-slate-200 rounded-lg p-2.5 focus:ring-2 focus:ring-indigo-500 outline-none"
                          placeholder="Custom cost"
                        />
                      ) : (
                        <div className="flex-1 text-sm bg-slate-100 border border-slate-200 rounded-lg p-2.5 text-slate-500">
                          {(() => {
                            const ranks = (formData.rank || '').split(',').map(r => r.trim()).filter(Boolean);
                            if (ranks.length === 1 && RANK_COST_MAP[ranks[0]]) return RANK_COST_MAP[ranks[0]];
                            if (ranks.length > 1) return ranks.map(r => RANK_COST_MAP[r]).filter(Boolean).join(' / ');
                            return 'Select a rank';
                          })()}
                        </div>
                      )}
                      <label className="flex items-center gap-1.5 text-xs text-slate-500 whitespace-nowrap cursor-pointer select-none">
                        <input
                          type="checkbox"
                          checked={customCost}
                          onChange={(e) => {
                            setCustomCost(e.target.checked);
                            if (!e.target.checked) {
                              const ranks = (formData.rank || '').split(',').map(r => r.trim()).filter(Boolean);
                              if (ranks.length === 1 && RANK_COST_MAP[ranks[0]]) {
                                setFormData({ ...formData, cost: RANK_COST_MAP[ranks[0]] });
                              }
                            }
                          }}
                          className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                        />
                        Custom
                      </label>
                    </div>
                  </div>
                )}
              </div>
              <div className="flex gap-3 mt-5">
                <button
                  onClick={handleSaveRow}
                  disabled={manageLoading || tableConfig.fields.filter(f => f.required).some(f => !formData[f.key]?.trim())}
                  className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white px-5 py-2.5 rounded-xl text-sm font-bold flex items-center gap-2 transition-colors"
                >
                  <Save size={16} /> {editingRow.id ? 'Update' : 'Add'}
                </button>
                <button onClick={handleCancelEdit} className="bg-slate-100 hover:bg-slate-200 text-slate-600 px-5 py-2.5 rounded-xl text-sm font-bold transition-colors">Cancel</button>
              </div>
            </div>
          )}

          <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
            <div className="flex items-center gap-3">
              <div className="text-xs font-bold text-slate-400 uppercase">{filteredManageRows.length} of {manageRows.length} {tableConfig.label}</div>
              <button onClick={handleStartAdd} className="bg-indigo-600 hover:bg-indigo-700 text-white px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1 transition-colors">
                <PlusCircle size={14} /> Add New
              </button>
            </div>
            <div className="relative">
              <Search className="absolute left-3 top-2.5 text-slate-400" size={14} />
              <input
                type="text"
                placeholder={`Search ${tableConfig.label.toLowerCase()}...`}
                className="bg-white border border-slate-200 rounded-lg py-2 pl-8 pr-4 text-sm outline-none focus:ring-2 focus:ring-indigo-500 w-64"
                value={manageSearch}
                onChange={(e) => setManageSearch(e.target.value)}
              />
            </div>
          </div>

          {manageLoading && manageRows.length === 0 ? (
            <div className="text-center py-16">
              <div className="w-8 h-8 border-3 border-slate-300 border-t-indigo-500 rounded-full animate-spin mx-auto mb-3"></div>
              <p className="text-slate-400 text-sm">Loading data...</p>
            </div>
          ) : filteredManageRows.length === 0 ? (
            <div className="text-center py-16 bg-white rounded-2xl border border-slate-200">
              <Database size={40} className="text-slate-300 mx-auto mb-3" />
              <p className="text-slate-500 font-semibold">{manageRows.length === 0 ? `No ${tableConfig.label.toLowerCase()} in the database yet.` : 'No results match your search.'}</p>
            </div>
          ) : (
            <div className="grid gap-3 grid-cols-1 md:grid-cols-2 xl:grid-cols-3">
              {filteredManageRows.map((row) => {
                const visibleFields = tableConfig.fields.filter(f => !f.hidden && f.key !== 'name' && f.type !== 'slots');
                const slotsField = tableConfig.fields.find(f => f.type === 'slots');
                const hasSlots = slotsField && row[slotsField.key];
                let slotsInfo = null;
                if (hasSlots) {
                  try {
                    const slots = JSON.parse(row[slotsField.key]);
                    const filled = slots.filter(s => s.discord_id && s.username).length;
                    slotsInfo = { filled, total: slots.length, remaining: slots.length - filled };
                  } catch {}
                }
                return (
                  <div key={row.id} className="bg-white rounded-xl border border-slate-200 p-4 hover:shadow-md transition-shadow">
                    <div className="flex items-start justify-between mb-2">
                      <div>
                        <span className="text-[10px] text-slate-400 font-mono">#{row.id}</span>
                        <h4 className="text-sm font-bold text-slate-800 leading-tight">{row.name || '(untitled)'}</h4>
                      </div>
                      <div className="flex items-center gap-1 shrink-0 ml-2">
                        <button onClick={() => handleStartEdit(row)} className="p-1.5 rounded-lg text-indigo-500 hover:bg-indigo-50 transition-colors" title="Edit">
                          <Edit2 size={14} />
                        </button>
                        <button onClick={() => handleDeleteRow(row.id)} className="p-1.5 rounded-lg text-red-500 hover:bg-red-50 transition-colors" title="Delete">
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-1 mb-2">
                      {visibleFields.map(f => {
                        const val = row[f.key];
                        if (!val) return null;
                        if (f.type === 'checkbox' && val === 'Yes') {
                          return <span key={f.key} className="px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-amber-100 text-amber-800 border border-amber-200">{f.label}</span>;
                        }
                        if (f.type === 'checkbox') return null;
                        const vals = val.includes(',') ? val.split(',').map(v => v.trim()).filter(Boolean) : [val];
                        return vals.map(v => (
                          <span key={`${f.key}-${v}`} className="px-2 py-0.5 rounded text-[10px] font-bold border bg-slate-100 text-slate-700 border-slate-200" title={`${f.label}: ${v}`}>
                            {v}
                          </span>
                        ));
                      })}
                    </div>
                    {slotsInfo && (
                      <div className="text-xs text-slate-500 mt-1">
                        <span className={`font-bold ${slotsInfo.remaining > 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                          {slotsInfo.remaining > 0 ? `${slotsInfo.remaining} slot${slotsInfo.remaining !== 1 ? 's' : ''} open` : 'Full'}
                        </span>
                        <span className="text-slate-400 ml-1">({slotsInfo.filled}/{slotsInfo.total})</span>
                      </div>
                    )}
                    {row.doc_link && (
                      <a href={row.doc_link} target="_blank" rel="noopener noreferrer" className="text-xs text-indigo-600 hover:text-indigo-800 mt-1 inline-flex items-center gap-1"><ExternalLink size={10} /> Doc</a>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    );
  };

  const headerTitleLong = view === 'manage_data' ? 'Manage Data' : 'NARP Database';
  const headerTitleShort = view === 'manage_data' ? 'Manage' : 'NARP';

  return (
    <div className={`w-full h-screen bg-slate-200 flex flex-col font-sans text-slate-900 overflow-hidden ${tweaks.mobilePreview ? 'items-center justify-center bg-slate-800 p-4' : ''}`}>
      <div className={tweaks.mobilePreview ? "relative w-[414px] max-w-full h-[90vh] max-h-[820px] bg-white rounded-[2.5rem] shadow-2xl border-[10px] border-slate-900 overflow-hidden flex flex-col" : "contents"}>
      <div className="bg-slate-900 text-white p-4 sticky top-0 z-30 flex justify-between items-center shadow-lg shrink-0">
        <h1 className="text-lg font-bold tracking-widest uppercase flex items-center gap-2">
          {view === 'browser' && <BookOpen size={18} className="text-indigo-400" />}
          {view === 'manage_data' && <Edit2 size={18} className="text-indigo-400" />}
          <button onClick={() => setCreditsOpen(true)} className="hidden sm:inline hover:text-indigo-300 transition-colors" title="Credits & About">
            {headerTitleLong}
          </button>
          <button onClick={() => setCreditsOpen(true)} className="sm:hidden hover:text-indigo-300 transition-colors" title="Credits & About">
            {headerTitleShort}
          </button>
        </h1>
        <div className="flex items-center gap-2">
          <button onClick={() => setView('browser')} className={`text-xs px-3 py-1.5 font-bold rounded-lg transition-colors ${view === 'browser' ? 'bg-indigo-900 text-indigo-200' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'}`}>
            <span className="hidden sm:inline">Jutsu</span>
            <span className="sm:hidden"><BookOpen size={14} /></span>
          </button>

          {/* Tweaks (gear) */}
          <div className="relative">
            <button onClick={() => setTweaksOpen(o => !o)} className={`text-xs p-1.5 font-bold rounded-lg transition-colors ${tweaksOpen ? 'bg-indigo-900 text-indigo-200' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'}`} title="Display settings">
              <Settings size={16} />
            </button>
            {tweaksOpen && (
              <>
                <div className="fixed inset-0 z-30" onClick={() => setTweaksOpen(false)}></div>
                <div className="absolute right-0 mt-2 w-72 bg-white text-slate-700 rounded-xl shadow-2xl border border-slate-200 z-40 overflow-hidden">
                  <div className="px-4 py-3 border-b border-slate-100 flex items-center gap-2">
                    <Settings size={14} className="text-indigo-500" />
                    <span className="text-xs font-bold uppercase tracking-wider text-slate-700">Display Settings</span>
                  </div>
                  <div className="p-3 space-y-2 text-sm">
                    <div className="text-[10px] font-bold uppercase text-slate-400 tracking-wider mt-1 mb-1">Card Fields</div>
                    {[
                      ['showSpec', 'Specialization'],
                      ['showType', 'Jutsu Type'],
                      ['showCU', 'CU Cost'],
                      ['showBloodline', 'Bloodline'],
                      ['showOrigin', 'Origin (Canon/Custom)'],
                    ].map(([key, label]) => (
                      <label key={key} className="flex items-center justify-between gap-2 px-2 py-1.5 hover:bg-slate-50 rounded cursor-pointer">
                        <span>{label}</span>
                        <input type="checkbox" checked={!!tweaks[key]} onChange={e => updateTweak(key, e.target.checked)} className="rounded text-indigo-600 focus:ring-indigo-500 w-4 h-4" />
                      </label>
                    ))}
                    <div className="text-[10px] font-bold uppercase text-slate-400 tracking-wider mt-3 mb-1">CU Calculation</div>
                    <label className="flex items-center justify-between gap-2 px-2 py-1.5 hover:bg-slate-50 rounded cursor-pointer">
                      <span>Sum CU across multi-rank</span>
                      <input type="checkbox" checked={!!tweaks.sumMultiRankCU} onChange={e => updateTweak('sumMultiRankCU', e.target.checked)} className="rounded text-indigo-600 focus:ring-indigo-500 w-4 h-4" />
                    </label>
                    <p className="text-[10px] text-slate-400 px-2">e.g. D/C/B → 2 + 4 + 6 = 12 CU</p>
                    <div className="text-[10px] font-bold uppercase text-slate-400 tracking-wider mt-3 mb-1">Preview</div>
                    <label className="flex items-center justify-between gap-2 px-2 py-1.5 hover:bg-slate-50 rounded cursor-pointer">
                      <span className="flex items-center gap-1.5"><Smartphone size={14} className="text-slate-400" /> Mobile preview frame</span>
                      <input type="checkbox" checked={!!tweaks.mobilePreview} onChange={e => updateTweak('mobilePreview', e.target.checked)} className="rounded text-indigo-600 focus:ring-indigo-500 w-4 h-4" />
                    </label>
                    <button onClick={() => { setTweaks({ ...DEFAULT_TWEAKS }); saveTweaks(DEFAULT_TWEAKS); }} className="w-full mt-2 text-xs font-semibold text-slate-500 hover:text-slate-700 py-1.5 border-t border-slate-100 pt-2">Reset to defaults</button>
                  </div>
                </div>
              </>
            )}
          </div>

          {/* Admin/User preview toggle (V2 prototype) */}
          <button
            onClick={togglePreviewRole}
            className={`text-xs px-3 py-1.5 font-bold rounded-lg transition-colors flex items-center gap-1.5 border ${currentUser.role === 'admin' ? 'bg-indigo-600 border-indigo-500 text-white hover:bg-indigo-500' : 'bg-slate-800 border-slate-700 text-slate-200 hover:bg-slate-700'}`}
            title={`Currently viewing as ${currentUser.role}. Click to switch.`}
          >
            {currentUser.role === 'admin' ? <Shield size={14} /> : <Key size={14} />}
            <span className="hidden sm:inline">View: {currentUser.role === 'admin' ? 'Admin' : 'User'}</span>
            <span className="sm:hidden">{currentUser.role === 'admin' ? 'Admin' : 'User'}</span>
          </button>

          {currentUser.role === 'admin' && (
            <button onClick={() => setView('manage_data')} className={`text-xs px-3 py-1.5 font-bold rounded-lg transition-colors ${view === 'manage_data' ? 'bg-indigo-700 text-indigo-200' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'}`}>
              <span className="hidden sm:inline">Manage</span>
              <span className="sm:hidden"><Edit2 size={14} /></span>
            </button>
          )}
        </div>
      </div>

      {view === 'browser' && (isDataEmpty ? renderEmptyState() : renderBrowser())}
      {view === 'manage_data' && currentUser.role === 'admin' && renderManageData()}

      <div className="bg-slate-900 text-center py-2 text-[10px] font-bold text-slate-500 uppercase tracking-widest z-20 shrink-0 border-t border-slate-800 flex items-center justify-center gap-2">
        <button onClick={() => setCreditsOpen(true)} className="hover:text-indigo-300 transition-colors flex items-center gap-1.5">
          <Info size={11} /> Credits: Hexagon &amp; A Road Sign
        </button>
        <span className="text-slate-700">—</span>
        <span>{APP_VERSION}</span>
      </div>

      {creditsOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => setCreditsOpen(false)}>
          <div className="bg-white rounded-3xl shadow-2xl max-w-md w-full overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="bg-slate-900 text-white p-5 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Info size={20} className="text-indigo-400" />
                <h3 className="font-bold text-lg">About NARP Database</h3>
              </div>
              <button onClick={() => setCreditsOpen(false)} className="text-slate-400 hover:text-white p-1 rounded"><X size={18} /></button>
            </div>
            <div className="p-6 space-y-4 text-sm text-slate-700">
              <p>A community jutsu reference for a text-based Naruto roleplay Discord community.</p>
              <div className="border-t border-slate-100 pt-4">
                <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-2">Credits</p>
                <p className="font-semibold text-slate-800">Hexagon &amp; A Road Sign</p>
              </div>
              <div className="border-t border-slate-100 pt-4 text-xs text-slate-500">
                <p>Fan project. Not affiliated with the Naruto franchise or its rights holders. All referenced names and concepts belong to their respective owners.</p>
                <p className="mt-2 text-slate-400">{APP_VERSION}</p>
              </div>
            </div>
          </div>
        </div>
      )}
      </div>
    </div>
  );
}

export default App;
