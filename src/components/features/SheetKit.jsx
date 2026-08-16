import React from 'react';
import { ExternalLink, ChevronDown } from 'lucide-react';

/*
 * Shared "parchment sheet" building blocks — the cream-paper, ink-black
 * serif, hanko-stamped visual language used for both CharacterSheetModal and
 * JutsuSheetModal. One copy so the two stay visually identical and a palette
 * tweak only has to happen in one place.
 */

export const PAPER   = '#f3e9d6';
export const PAPER_BG = 'radial-gradient(ellipse at top, #f8f1df 0%, #f3e9d6 55%, #ecdec0 100%)';
export const CARD    = '#faf3e3';
export const INK     = '#251e15';
export const INK_MUTED = '#8c7d61';
export const HAIRLINE = 'rgba(37,30,21,0.16)';
export const RULE    = 'rgba(37,30,21,0.85)';
export const HANKO   = '#a23a2c';
export const LINK_COLOR = '#3c5c8c';

export const inputCls = 'w-full rounded-sm px-2.5 py-1.5 text-[13px] outline-none border transition-shadow ' +
  'focus:shadow-[0_0_0_2px_rgba(37,30,21,0.22)]';
export const inputStyle = { background: CARD, borderColor: 'rgba(37,30,21,0.22)', color: INK };

// Zebra striping applied per <tr>, since arbitrary-value Tailwind covers the
// custom palette without a separate stylesheet.
export const zebraRow = 'odd:bg-[#f9f2e1] even:bg-[#efe1c3] hover:bg-[#e8d8b6] transition-colors';

export const chartCardStyle = { background: CARD, border: `1px solid ${HAIRLINE}` };
export const chartTooltipStyle = { background: PAPER, border: `1px solid ${HAIRLINE}`, borderRadius: 2, fontSize: 12, color: INK };

export const Dash = () => <span className="font-mono text-[13px]" style={{ color: INK_MUTED }}>----</span>;

export function Text({ value, onChange, editing, placeholder = '', type = 'text' }) {
  if (!editing) return value ? <span className="break-words" style={{ color: INK }}>{value}</span> : <Dash />;
  return (
    <input type={type} value={value || ''} placeholder={placeholder}
           onChange={e => onChange(e.target.value)} className={inputCls} style={inputStyle} />
  );
}

export function Choice({ value, onChange, editing, options, placeholder = 'Select' }) {
  if (!editing) return value ? <span style={{ color: INK }}>{value}</span> : <Dash />;
  return (
    <div className="relative">
      <select value={value || ''} onChange={e => onChange(e.target.value)}
              className={inputCls + ' appearance-none pr-7 cursor-pointer'} style={inputStyle}>
        <option value="">{placeholder}</option>
        {options.map(o => <option key={o} value={o}>{o}</option>)}
      </select>
      <ChevronDown size={13} className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: INK_MUTED }} />
    </div>
  );
}

export function Area({ value, onChange, editing, placeholder = '', rows = 5 }) {
  if (!editing) {
    return value
      ? <p className="text-[13px] leading-relaxed whitespace-pre-wrap break-words" style={{ color: INK }}>{value}</p>
      : <p className="text-[13px] italic" style={{ color: INK_MUTED }}>Not written yet</p>;
  }
  return (
    <textarea value={value || ''} rows={rows} placeholder={placeholder}
              onChange={e => onChange(e.target.value)}
              className={inputCls + ' leading-relaxed resize-y'} style={inputStyle} />
  );
}

export function Link({ value, onChange, editing, placeholder = 'Hyperlink' }) {
  if (!editing) {
    if (!value) return <Dash />;
    return (
      <a href={value} target="_blank" rel="noopener noreferrer"
         className="inline-flex items-center gap-1 text-[12px] font-semibold underline underline-offset-2 hover:opacity-70 transition-opacity"
         style={{ color: LINK_COLOR }}>
        Open <ExternalLink size={10} />
      </a>
    );
  }
  return (
    <input type="url" value={value || ''} placeholder={placeholder}
           onChange={e => onChange(e.target.value)} className={inputCls} style={inputStyle} />
  );
}

// Label / value pair — right-aligned bold serif label on larger screens,
// stacked on mobile, hairline divider beneath, mirroring the printed sheet.
export function Field({ label, note, children }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-[11rem_1fr] gap-x-4 gap-y-0.5 py-2 items-baseline"
         style={{ borderBottom: `1px solid ${HAIRLINE}` }}>
      <div className="sm:text-right">
        <span className="text-[11px] font-bold uppercase tracking-wide font-serif" style={{ color: INK }}>{label}</span>
        {note && <span className="block sm:inline sm:ml-1.5 text-[10px] font-normal normal-case italic" style={{ color: INK_MUTED }}>{note}</span>}
      </div>
      <div className="min-w-0 text-sm">{children}</div>
    </div>
  );
}

export function Section({ kanji, title, note, children }) {
  return (
    <section className="mb-9">
      <div className="flex items-baseline gap-2.5 mb-1.5">
        <span className="text-xl font-serif font-bold leading-none" style={{ color: INK }}>{kanji}</span>
        <h3 className="text-base sm:text-lg font-serif font-bold tracking-tight" style={{ color: INK }}>{title}</h3>
      </div>
      <div className="h-[2px] mb-3" style={{ background: RULE }} />
      {note && <p className="text-[12px] italic mb-3 leading-relaxed" style={{ color: INK_MUTED }}>{note}</p>}
      {children}
    </section>
  );
}

export function Table({ headers, children, minWidth = '26rem' }) {
  return (
    <div className="overflow-x-auto rounded-sm" style={{ border: `1px solid ${HAIRLINE}` }}>
      <table className="w-full text-sm border-collapse" style={{ minWidth }}>
        <thead>
          <tr style={{ background: INK }}>
            {headers.map((h, i) => (
              <th key={i} className="text-left text-[10px] font-bold uppercase tracking-wide px-3 py-2 font-serif whitespace-nowrap"
                  style={{ color: PAPER }}>
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

export const Cell = ({ children, className = '' }) => (
  <td className={`py-2 px-3 align-middle text-[13px] ${className}`} style={{ borderBottom: `1px solid ${HAIRLINE}`, color: INK }}>
    {children}
  </td>
);

export const SubHead = ({ children, note }) => (
  <p className="text-[10px] font-bold uppercase tracking-wide font-serif mt-5 mb-1.5" style={{ color: INK }}>
    {children} {note && <span className="normal-case font-normal italic" style={{ color: INK_MUTED }}>{note}</span>}
  </p>
);

// Generic "paper card" modal shell: cream gradient panel, sticky header slot,
// scrim backdrop. Both sheet modals build their header/body around this.
export function SheetShell({ maxWidth = 'max-w-3xl', onClose, children }) {
  return (
    <div className="fixed inset-0 z-[90] overflow-y-auto p-3 md:p-6"
         style={{ background: 'rgba(10,8,5,0.82)', backdropFilter: 'blur(4px)' }}
         onClick={onClose}>
      <div className={`w-full ${maxWidth} mx-auto rounded-md shadow-2xl my-2`}
           style={{ background: PAPER_BG, border: '1px solid rgba(37,30,21,0.25)' }}
           onClick={e => e.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}

// The small red ink-stamp flourish used at the top of every sheet.
export const HankoStamp = ({ kanji }) => (
  <div className="flex justify-end -mt-1 mb-1">
    <div className="w-10 h-10 rounded-[3px] flex items-center justify-center select-none pointer-events-none"
         style={{ border: `2px solid ${HANKO}`, opacity: 0.5, transform: 'rotate(-4deg)' }}>
      <span className="font-serif font-bold text-base" style={{ color: HANKO }}>{kanji}</span>
    </div>
  </div>
);
