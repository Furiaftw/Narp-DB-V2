import React, { useEffect, useRef, useState } from 'react';
import {
  X, BookOpen, User, FileText, ListChecks, ShieldAlert, ExternalLink,
} from 'lucide-react';
import { fetchRosterCharacterNames } from '../../lib/supabase';
import CharacterSheetModal from './CharacterSheetModal';

/*
 * The jutsu write-up — styled to match JutsuCard (white cards, slate-50
 * inset boxes, indigo accents, the same rank-pill badges) rather than the
 * parchment "document" look used by the character sheet. Sections: basics
 * (who developed it), description, step-by-step mechanics, and
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

// Every read-only text render here must be able to wrap: an unbroken run of
// characters (a pasted link with no spaces, a long word) will otherwise
// blow past its box instead of wrapping, so `break-words` is load-bearing,
// not decorative — don't drop it when touching these.
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
         className="inline-flex items-center gap-1.5 text-sm font-bold text-indigo-600 hover:text-indigo-700 transition-colors break-all">
        <ExternalLink size={13} className="shrink-0" /> Open link
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
      <div className="bg-slate-50/70 border border-slate-100 rounded-xl p-4 min-w-0">
        {children}
      </div>
    </div>
  );
}

// Opens the OC's character sheet on click. No id lookup needed — sheets are
// matched by name (same as the roster does), and CharacterSheetModal already
// falls back to fetch-by-name and renders a graceful "not created yet" state
// when the character hasn't filled one in.
function OcLink({ name }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}
              className="inline-flex items-center gap-1.5 text-sm font-bold text-indigo-600 hover:text-indigo-700 transition-colors break-words text-left">
        {name} <span className="text-slate-400 font-medium normal-case shrink-0">(OC)</span>
      </button>
      {open && (
        <CharacterSheetModal characterName={name} onClose={() => setOpen(false)} />
      )}
    </>
  );
}

function DevelopedBy({ value, onChange, editing }) {
  const v = value && typeof value === 'object' ? value : { type: 'unknown', oc_name: '', npc_name: '' };
  const [ocOptions, setOcOptions] = useState(null);
  const [ocLoading, setOcLoading] = useState(false);
  const fetchedRef = useRef(false);

  // The roster (not character_sheets) is the source of names here — most OCs
  // won't have filled in a character sheet yet, but they're still pickable;
  // CharacterSheetModal handles "no sheet yet" gracefully on open.
  useEffect(() => {
    if (!editing || v.type !== 'oc' || fetchedRef.current) return;
    fetchedRef.current = true;
    let cancelled = false;
    setOcLoading(true);
    fetchRosterCharacterNames()
      .then(names => { if (!cancelled) setOcOptions(names); })
      .catch(() => { if (!cancelled) setOcOptions([]); })
      .finally(() => { if (!cancelled) setOcLoading(false); });
    return () => { cancelled = true; };
  }, [editing, v.type]);

  if (!editing) {
    if (v.type === 'oc' && v.oc_name) return <OcLink name={v.oc_name} />;
    if (v.type === 'npc' && v.npc_name) {
      return <p className="text-sm font-semibold text-slate-700 break-words">{v.npc_name} <span className="text-slate-400 font-medium">(NPC)</span></p>;
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
                    t.key === 'oc'  ? { type: 'oc', oc_name: v.oc_name || '', npc_name: '' }
                    : t.key === 'npc' ? { type: 'npc', npc_name: v.npc_name || '', oc_name: '' }
                    : { type: 'unknown', oc_name: '', npc_name: '' }
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
        ) : (ocOptions || []).length === 0 ? (
          <p className="text-xs text-slate-400 font-medium">No approved OCs on the roster yet.</p>
        ) : (
          <select value={v.oc_name || ''}
                  onChange={e => onChange({ type: 'oc', oc_name: e.target.value, npc_name: '' })}
                  className={inputCls}>
            <option value="">Select a character…</option>
            {(ocOptions || []).map(name => <option key={name} value={name}>{name}</option>)}
          </select>
        )
      )}
      {v.type === 'npc' && (
        <input value={v.npc_name || ''} placeholder="NPC name"
               onChange={e => onChange({ type: 'npc', npc_name: e.target.value, oc_name: '' })} className={inputCls} />
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

  // Full-screen, so there's no backdrop left to click — Escape is the
  // keyboard way back out. Only while read-only: this component is fully
  // controlled, so in edit mode the caller owns the unsaved draft and
  // deciding when it's safe to leave.
  useEffect(() => {
    if (ed) return;
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [ed, onClose]);

  return (
    <div className="fixed inset-0 z-[80] bg-white flex flex-col">
      {/* Header — sticky across the full width, body scrolls under it */}
      <div className="shrink-0 border-b border-slate-200 bg-white">
        <div className="max-w-5xl mx-auto px-5 py-4 flex justify-between items-center gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-xl bg-indigo-50 border border-indigo-100 flex items-center justify-center shrink-0">
              <BookOpen size={18} className="text-indigo-600" />
            </div>
            <div className="min-w-0">
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Jutsu Documentation</p>
              <h2 className="text-xl font-extrabold text-slate-900 truncate tracking-tight">{jutsuName || 'Unnamed technique'}</h2>
            </div>
          </div>
          <button onClick={onClose} title="Close" className="text-slate-400 hover:bg-slate-100 p-2 rounded-full shrink-0 transition-colors">
            <X size={18} />
          </button>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto custom-scrollbar">
        <div className="max-w-5xl mx-auto px-5 py-6 pb-20 min-w-0">

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
                  <div key={realIndex} className="flex items-start gap-3">
                    <span className="w-6 h-6 rounded-full bg-indigo-600 text-white text-[11px] font-black flex items-center justify-center shrink-0">
                      {realIndex + 1}
                    </span>
                    <div className="flex-1 min-w-0">
                      {ed ? (
                        <input value={s.text}
                               onChange={e => patchStep(realIndex, e.target.value)} className={inputCls} />
                      ) : (
                        <p className="text-sm text-slate-700 leading-relaxed break-words">{s.text}</p>
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
