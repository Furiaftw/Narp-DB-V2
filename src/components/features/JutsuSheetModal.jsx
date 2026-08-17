import React, { useEffect, useRef, useState } from 'react';
import {
  X, BookOpen, Image as ImageIcon, User, FileText, ListChecks,
  ShieldAlert, ExternalLink,
} from 'lucide-react';
import { fetchCharacterSheetIndex } from '../../lib/supabase';
import CharacterSheetModal from './CharacterSheetModal';

/*
 * The jutsu write-up — styled to match JutsuCard (white cards, slate-50
 * inset boxes, indigo accents, the same rank-pill badges) rather than the
 * parchment "document" look used by the character sheet. Sections: image,
 * basics (who developed it), description, step-by-step mechanics, and
 * restrictions.
 *
 * Fully controlled: the caller owns `sheet` and gets every edit back through
 * `onChange(nextSheet)`. There's no internal save/load here — AdminFormModal
 * folds the sheet into the same entity it already submits, and JutsuCard
 * renders it read-only fed straight from the jutsu row. For multi-rank
 * jutsus, the caller is responsible for picking which rank's doc to show —
 * this component only ever renders one.
 */

const inputCls = 'w-full text-sm bg-white border border-slate-200 rounded-lg px-3 py-2 outline-none ' +
  'focus:ring-2 focus:ring-indigo-500 transition-shadow placeholder:text-slate-300';

function Text({ value, onChange, editing, placeholder = '' }) {
  if (!editing) return value
    ? <p className="text-sm font-semibold text-slate-700 break-words">{value}</p>
    : <p className="text-sm text-slate-300 italic">Not set</p>;
  return <input value={value || ''} placeholder={placeholder} onChange={e => onChange(e.target.value)} className={inputCls} />;
}

function Area({ value, onChange, editing, placeholder = '', rows = 5 }) {
  if (!editing) return value
    ? <p className="text-sm text-slate-700 leading-relaxed whitespace-pre-wrap break-words">{value}</p>
    : <p className="text-sm text-slate-300 italic">Not written yet</p>;
  return (
    <textarea value={value || ''} rows={rows} placeholder={placeholder}
              onChange={e => onChange(e.target.value)} className={inputCls + ' leading-relaxed resize-y'} />
  );
}

function LinkField({ value, onChange, editing, placeholder = 'https://…' }) {
  if (!editing) {
    if (!value) return <p className="text-sm text-slate-300 italic">Not set</p>;
    return (
      <a href={value} target="_blank" rel="noopener noreferrer"
         className="inline-flex items-center gap-1.5 text-sm font-bold text-indigo-600 hover:text-indigo-700 transition-colors">
        <ExternalLink size={13} /> Open link
      </a>
    );
  }
  return <input type="url" value={value || ''} placeholder={placeholder} onChange={e => onChange(e.target.value)} className={inputCls} />;
}

function Field({ label, note, children }) {
  return (
    <div className="mb-3.5 last:mb-0">
      <label className="block text-[9px] font-bold text-slate-400 uppercase tracking-widest mb-1">
        {label}{note && <span className="normal-case font-medium text-slate-400"> ({note})</span>}
      </label>
      {children}
    </div>
  );
}

function Section({ icon: SectionIcon, title, note, children }) {
  return (
    <div className="mb-6">
      <div className="flex items-center gap-2 mb-2.5">
        <SectionIcon size={14} className="text-indigo-500 shrink-0" />
        <h3 className="text-xs font-extrabold text-slate-700 uppercase tracking-widest">{title}</h3>
      </div>
      {note && <p className="text-xs text-slate-400 font-medium mb-2.5">{note}</p>}
      <div className="bg-slate-50/70 border border-slate-100 rounded-xl p-4">
        {children}
      </div>
    </div>
  );
}

// Opens the OC's character sheet on click — the character sheet modal handles
// its own fetching, so this just needs the id.
function OcLink({ ocId, name }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}
              className="inline-flex items-center gap-1.5 text-sm font-bold text-indigo-600 hover:text-indigo-700 transition-colors">
        {name} <span className="text-slate-400 font-medium normal-case">(OC)</span>
      </button>
      {open && (
        <CharacterSheetModal sheetId={ocId} characterName={name} onClose={() => setOpen(false)} />
      )}
    </>
  );
}

function DevelopedBy({ value, onChange, editing }) {
  const v = value && typeof value === 'object' ? value : { type: 'unknown', oc_id: '', oc_name: '', npc_name: '' };
  const [ocOptions, setOcOptions] = useState(null);
  const [ocLoading, setOcLoading] = useState(false);
  const fetchedRef = useRef(false);

  useEffect(() => {
    if (!editing || v.type !== 'oc' || fetchedRef.current) return;
    fetchedRef.current = true;
    let cancelled = false;
    setOcLoading(true);
    fetchCharacterSheetIndex()
      .then(index => {
        if (cancelled) return;
        setOcOptions(Object.values(index)
          .map(r => ({ id: r.id, name: r.character_name }))
          .sort((a, b) => a.name.localeCompare(b.name)));
      })
      .catch(() => { if (!cancelled) setOcOptions([]); })
      .finally(() => { if (!cancelled) setOcLoading(false); });
    return () => { cancelled = true; };
  }, [editing, v.type]);

  if (!editing) {
    if (v.type === 'oc' && v.oc_name) return <OcLink ocId={v.oc_id} name={v.oc_name} />;
    if (v.type === 'npc' && v.npc_name) {
      return <p className="text-sm font-semibold text-slate-700">{v.npc_name} <span className="text-slate-400 font-medium">(NPC)</span></p>;
    }
    return <p className="text-sm text-slate-300 italic">Unknown</p>;
  }

  const TYPES = [
    { key: 'unknown', label: 'Unknown' },
    { key: 'oc', label: 'OC' },
    { key: 'npc', label: 'NPC' },
  ];

  return (
    <div>
      <div className="flex gap-2 mb-2.5">
        {TYPES.map(t => (
          <button key={t.key} type="button"
                  onClick={() => onChange(
                    t.key === 'oc'  ? { type: 'oc', oc_id: v.oc_id || '', oc_name: v.oc_name || '', npc_name: '' }
                    : t.key === 'npc' ? { type: 'npc', npc_name: v.npc_name || '', oc_id: '', oc_name: '' }
                    : { type: 'unknown', oc_id: '', oc_name: '', npc_name: '' }
                  )}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-colors ${
                    v.type === t.key ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-slate-500 border-slate-200 hover:border-indigo-300'
                  }`}>
            {t.label}
          </button>
        ))}
      </div>
      {v.type === 'oc' && (
        ocLoading ? (
          <p className="text-xs text-slate-400 font-medium">Loading roster…</p>
        ) : (
          <select value={v.oc_id || ''}
                  onChange={e => {
                    const opt = (ocOptions || []).find(o => o.id === e.target.value);
                    onChange({ type: 'oc', oc_id: e.target.value, oc_name: opt?.name || '' });
                  }}
                  className={inputCls}>
            <option value="">Select a character…</option>
            {(ocOptions || []).map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
        )
      )}
      {v.type === 'npc' && (
        <input value={v.npc_name || ''} placeholder="NPC name"
               onChange={e => onChange({ type: 'npc', npc_name: e.target.value })} className={inputCls} />
      )}
    </div>
  );
}

export default function JutsuSheetModal({
  sheet,
  onChange,
  readOnly = false,
  jutsuName = '',
  onClose,
}) {
  const ed = !readOnly;

  const patch = (key, value) => onChange({ ...sheet, [key]: value });
  const patchStep = (i, value) => onChange({
    ...sheet,
    mechanics_steps: sheet.mechanics_steps.map((s, idx) => (idx === i ? { ...s, text: value } : s)),
  });

  const filledSteps = ed ? sheet.mechanics_steps : sheet.mechanics_steps.filter(s => s.text);

  return (
    <div className="fixed inset-0 z-[80] bg-slate-900/60 flex items-center justify-center p-4 sm:p-6" onClick={onClose}>
      <div className="bg-white rounded-3xl shadow-2xl max-w-3xl w-full max-h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="p-6 md:p-8 overflow-y-auto custom-scrollbar flex-1">

          {/* Header */}
          <div className="flex justify-between items-center mb-8 border-b pb-4">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-10 h-10 rounded-xl bg-indigo-50 border border-indigo-100 flex items-center justify-center shrink-0">
                <BookOpen size={18} className="text-indigo-600" />
              </div>
              <div className="min-w-0">
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Jutsu Documentation</p>
                <h2 className="text-xl font-extrabold text-slate-900 truncate tracking-tight">{jutsuName || 'Unnamed technique'}</h2>
              </div>
            </div>
            <button onClick={onClose} className="text-slate-400 hover:bg-slate-100 p-2 rounded-full shrink-0 transition-colors">
              <X size={18} />
            </button>
          </div>

          {/* Image */}
          <Section icon={ImageIcon} title="Jutsu Image" note="Optional.">
            {ed ? (
              <input type="url" value={sheet.image || ''} placeholder="https://…"
                     onChange={e => patch('image', e.target.value)} className={inputCls} />
            ) : sheet.image ? (
              <img src={sheet.image} alt={jutsuName} loading="lazy"
                   className="w-full max-h-64 object-cover rounded-lg border border-slate-200" />
            ) : (
              <p className="text-sm text-slate-300 italic">No image</p>
            )}
          </Section>

          {/* Basics */}
          <Section icon={User} title="Basics">
            <Field label="Developed by">
              <DevelopedBy editing={ed} value={sheet.developed_by} onChange={v => patch('developed_by', v)} />
            </Field>
            <div className="mt-3.5">
              <Field label="Prerequisites" note="list them if any"><Text editing={ed} value={sheet.prerequisites} onChange={v => patch('prerequisites', v)} /></Field>
            </div>
          </Section>

          {/* Description */}
          <Section icon={FileText} title="Description" note="Minimum one paragraph.">
            <Area editing={ed} value={sheet.description} onChange={v => patch('description', v)} rows={7} />
          </Section>

          {/* Mechanics */}
          <Section icon={ListChecks} title="Mechanics">
            <div className="space-y-2.5">
              {filledSteps.map((s, i) => {
                const realIndex = sheet.mechanics_steps.indexOf(s);
                return (
                  <div key={realIndex} className="flex items-center gap-3">
                    <span className="w-6 h-6 rounded-full bg-indigo-600 text-white text-[11px] font-black flex items-center justify-center shrink-0">
                      {realIndex + 1}
                    </span>
                    <div className="flex-1 min-w-0">
                      {ed ? (
                        <input value={s.text}
                               onChange={e => patchStep(realIndex, e.target.value)} className={inputCls} />
                      ) : (
                        <p className="text-sm text-slate-700 leading-relaxed">{s.text}</p>
                      )}
                    </div>
                  </div>
                );
              })}
              {!ed && !filledSteps.length && (
                <p className="text-sm text-slate-300 italic">No mechanics written yet</p>
              )}
            </div>
          </Section>

          {/* Restrictions */}
          <Section icon={ShieldAlert} title="Restrictions">
            <Area editing={ed} value={sheet.restrictions} onChange={v => patch('restrictions', v)} rows={4} />
            <div className="mt-4">
              <Field label="Naruto Wiki page" note="if applicable">
                <LinkField editing={ed} value={sheet.wiki_link} onChange={v => patch('wiki_link', v)} />
              </Field>
            </div>
          </Section>

        </div>
      </div>
    </div>
  );
}
