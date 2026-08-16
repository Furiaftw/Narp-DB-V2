import React from 'react';
import {
  X, BookOpen, Image as ImageIcon, User, FileText, ListChecks,
  ShieldAlert, TrendingUp, ExternalLink,
} from 'lucide-react';

/*
 * The jutsu write-up — styled to match JutsuCard (white cards, slate-50
 * inset boxes, indigo accents, the same rank-pill badges) rather than the
 * parchment "document" look used by the character sheet. Same sections as
 * before: image, basics, description, step-by-step mechanics, restrictions,
 * and the multi-rank stat/skill scaling tables.
 *
 * Fully controlled: the caller owns `sheet` and gets every edit back through
 * `onChange(nextSheet)`. There's no internal save/load here — AdminFormModal
 * folds the sheet into the same entity it already submits, and JutsuCard
 * renders it read-only fed straight from the jutsu row.
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

// Same rank-pill styling as JutsuCard's Rank block.
const RankBadge = ({ rank }) => (
  <span className="px-2 py-0.5 bg-slate-200 text-slate-700 rounded-md text-xs font-black border border-slate-300 shadow-sm shrink-0">
    {rank}
  </span>
);

function Table({ headers, children }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200">
      <table className="w-full text-sm border-collapse min-w-[36rem]">
        <thead>
          <tr className="bg-slate-50">
            {headers.map((h, i) => (
              <th key={i} className="text-left text-[10px] font-bold text-slate-400 uppercase tracking-widest px-3 py-2.5 border-b border-slate-200 whitespace-nowrap">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

const Cell = ({ children, className = '' }) => (
  <td className={`px-3 py-2 text-sm text-slate-700 border-b border-slate-100 align-middle ${className}`}>
    {children}
  </td>
);

export default function JutsuSheetModal({
  sheet,
  onChange,
  readOnly = false,
  multiRank = false,
  jutsuName = '',
  onClose,
}) {
  const ed = !readOnly;

  const patch = (key, value) => onChange({ ...sheet, [key]: value });
  const patchStep = (i, value) => onChange({
    ...sheet,
    mechanics_steps: sheet.mechanics_steps.map((s, idx) => (idx === i ? { ...s, text: value } : s)),
  });
  const patchRankRow = (kind, i, key, value) => onChange({
    ...sheet,
    multi_rank: {
      ...sheet.multi_rank,
      [kind]: sheet.multi_rank[kind].map((r, idx) => (idx === i ? { ...r, [key]: value } : r)),
    },
  });

  const filledSteps = ed ? sheet.mechanics_steps : sheet.mechanics_steps.filter(s => s.text);
  const statRows = sheet.multi_rank?.stat || [];
  const skillRows = sheet.multi_rank?.skill || [];
  const showMultiRank = multiRank
    || statRows.some(r => r.scaled || r.details)
    || skillRows.some(r => r.scaled || r.details);

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
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Jutsu Sheet</p>
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
            <Field label="Developed by"><Text editing={ed} value={sheet.developed_by} onChange={v => patch('developed_by', v)} placeholder="Unnamed" /></Field>
            <Field label="Prerequisites" note="list them if any"><Text editing={ed} value={sheet.prerequisites} onChange={v => patch('prerequisites', v)} /></Field>
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
                        <input value={s.text} placeholder={realIndex === 6 ? 'Max step' : `Step ${realIndex + 1}`}
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

          {/* Multi-Rank Tab */}
          {(ed || showMultiRank) && (
            <Section icon={TrendingUp} title="Multi-Rank Scaling"
                     note="For techniques usable at different ranks, or that scale off a stat or skill. Leave blank if the technique has only one rank.">
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">Rank / stat scaling</p>
              <div className="mb-4">
                <Table headers={['Rank', 'Stat scaled', 'Details / effects', 'Casting type(s)', 'Mechanics']}>
                  {statRows.map((r, i) => (
                    <tr key={i} className="odd:bg-white even:bg-slate-50/60">
                      <Cell className="w-14"><RankBadge rank={r.rank} /></Cell>
                      <Cell className="w-32"><Text editing={ed} value={r.scaled} onChange={v => patchRankRow('stat', i, 'scaled', v)} /></Cell>
                      <Cell><Text editing={ed} value={r.details} onChange={v => patchRankRow('stat', i, 'details', v)} /></Cell>
                      <Cell className="w-36"><Text editing={ed} value={r.casting_types} onChange={v => patchRankRow('stat', i, 'casting_types', v)} /></Cell>
                      <Cell className="w-36"><Text editing={ed} value={r.mechanics} onChange={v => patchRankRow('stat', i, 'mechanics', v)} /></Cell>
                    </tr>
                  ))}
                </Table>
              </div>

              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">Rank / skill scaling</p>
              <Table headers={['Rank', 'Skill scaled', 'Details / effects', 'Casting type(s)', 'Mechanics']}>
                {skillRows.map((r, i) => (
                  <tr key={i} className="odd:bg-white even:bg-slate-50/60">
                    <Cell className="w-14"><RankBadge rank={r.rank} /></Cell>
                    <Cell className="w-32"><Text editing={ed} value={r.scaled} onChange={v => patchRankRow('skill', i, 'scaled', v)} /></Cell>
                    <Cell><Text editing={ed} value={r.details} onChange={v => patchRankRow('skill', i, 'details', v)} /></Cell>
                    <Cell className="w-36"><Text editing={ed} value={r.casting_types} onChange={v => patchRankRow('skill', i, 'casting_types', v)} /></Cell>
                    <Cell className="w-36"><Text editing={ed} value={r.mechanics} onChange={v => patchRankRow('skill', i, 'mechanics', v)} /></Cell>
                  </tr>
                ))}
              </Table>
            </Section>
          )}

        </div>
      </div>
    </div>
  );
}
