import React from 'react';
import { X, ArrowRight } from 'lucide-react';
import {
  INK, INK_MUTED, HAIRLINE, inputCls, inputStyle, zebraRow,
  Text, Area, Link, Field, Section, Table, Cell, SubHead,
  SheetShell, HankoStamp,
} from './SheetKit';

/*
 * The jutsu write-up — same parchment visual language as the character
 * sheet (see ./SheetKit), covering everything the old "Doc Link" used to
 * point at: description, step-by-step mechanics, restrictions, and the
 * multi-rank stat/skill scaling tables.
 *
 * Fully controlled: the caller owns `sheet` and gets every edit back through
 * `onChange(nextSheet)`. There's no internal save/load here — AdminFormModal
 * folds the sheet into the same entity it already submits, and JutsuCard
 * renders it read-only fed straight from the jutsu row.
 */
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
    <SheetShell onClose={onClose}>
      {/* Header */}
      <div className="sticky top-0 z-10 px-5 py-4 rounded-t-md"
           style={{ borderBottom: `1px solid ${HAIRLINE}` }}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-[0.25em] mb-1 font-serif" style={{ color: INK_MUTED }}>
              術 NARP Jutsu Template
            </p>
            <h2 className="text-xl font-serif font-bold tracking-tight truncate" style={{ color: INK }}>
              {jutsuName || 'Unnamed technique'}
            </h2>
          </div>
          <button onClick={onClose} className="p-1.5 shrink-0 transition-colors hover:opacity-70" style={{ color: INK_MUTED }}>
            <X size={16} />
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="px-5 py-5">
        <HankoStamp kanji="術" />

        {/* Image */}
        <Section kanji="画" title="Jutsu Image" note="Optional.">
          {ed ? (
            <input type="url" value={sheet.image || ''} placeholder="https://…"
                   onChange={e => patch('image', e.target.value)}
                   className={inputCls} style={inputStyle} />
          ) : sheet.image ? (
            <img src={sheet.image} alt={jutsuName} loading="lazy"
                 className="w-full max-h-64 object-cover rounded-sm" style={{ border: `1px solid ${HAIRLINE}` }} />
          ) : (
            <p className="text-xs italic" style={{ color: INK_MUTED }}>No image</p>
          )}
        </Section>

        {/* Basics */}
        <Section kanji="人" title="Basics">
          <Field label="Developed by"><Text editing={ed} value={sheet.developed_by} onChange={v => patch('developed_by', v)} placeholder="Unnamed" /></Field>
          <Field label="Prerequisites" note="list them if any"><Text editing={ed} value={sheet.prerequisites} onChange={v => patch('prerequisites', v)} /></Field>
        </Section>

        {/* Description */}
        <Section kanji="説" title="Description" note="Minimum one paragraph.">
          <Area editing={ed} value={sheet.description} onChange={v => patch('description', v)} rows={7} />
        </Section>

        {/* Mechanics */}
        <Section kanji="機" title="Mechanics">
          <div className="space-y-2">
            {filledSteps.map((s, i) => {
              const realIndex = sheet.mechanics_steps.indexOf(s);
              return (
                <div key={realIndex} className="flex items-start gap-2.5">
                  <ArrowRight size={14} className="mt-1.5 shrink-0" style={{ color: INK_MUTED }} />
                  <div className="flex-1 min-w-0">
                    {ed ? (
                      <input value={s.text} placeholder={realIndex === 6 ? `${realIndex + 1}. (Max)` : `${realIndex + 1}.`}
                             onChange={e => patchStep(realIndex, e.target.value)}
                             className={inputCls} style={inputStyle} />
                    ) : (
                      <p className="text-[13px] leading-relaxed" style={{ color: INK }}>{s.text}</p>
                    )}
                  </div>
                </div>
              );
            })}
            {!ed && !filledSteps.length && (
              <p className="text-xs italic" style={{ color: INK_MUTED }}>No mechanics written yet</p>
            )}
          </div>
        </Section>

        {/* Restrictions */}
        <Section kanji="限" title="Restrictions">
          <Area editing={ed} value={sheet.restrictions} onChange={v => patch('restrictions', v)} rows={4} />
          <div className="mt-4">
            <Field label="Naruto Wiki page" note="if applicable">
              <Link editing={ed} value={sheet.wiki_link} onChange={v => patch('wiki_link', v)} />
            </Field>
          </div>
        </Section>

        {/* Multi-Rank Tab */}
        {(ed || showMultiRank) && (
          <Section kanji="階" title="Multi-Rank Tab"
                   note="For techniques usable at different ranks, or that scale off a stat or skill. Leave blank if the technique has only one rank.">
            <SubHead>Rank / stat scaling</SubHead>
            <Table headers={['Rank', 'Stat scaled', 'Details / effects', 'Casting type(s)', 'Mechanics']}>
              {statRows.map((r, i) => (
                <tr key={i} className={zebraRow}>
                  <Cell className="w-14"><span className="text-[11px] font-bold uppercase tracking-wide font-serif" style={{ color: INK }}>{r.rank}</span></Cell>
                  <Cell className="w-32"><Text editing={ed} value={r.scaled} onChange={v => patchRankRow('stat', i, 'scaled', v)} /></Cell>
                  <Cell><Text editing={ed} value={r.details} onChange={v => patchRankRow('stat', i, 'details', v)} /></Cell>
                  <Cell className="w-36"><Text editing={ed} value={r.casting_types} onChange={v => patchRankRow('stat', i, 'casting_types', v)} /></Cell>
                  <Cell className="w-36"><Text editing={ed} value={r.mechanics} onChange={v => patchRankRow('stat', i, 'mechanics', v)} /></Cell>
                </tr>
              ))}
            </Table>

            <SubHead>Rank / skill scaling</SubHead>
            <Table headers={['Rank', 'Skill scaled', 'Details / effects', 'Casting type(s)', 'Mechanics']}>
              {skillRows.map((r, i) => (
                <tr key={i} className={zebraRow}>
                  <Cell className="w-14"><span className="text-[11px] font-bold uppercase tracking-wide font-serif" style={{ color: INK }}>{r.rank}</span></Cell>
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
    </SheetShell>
  );
}
