import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { X, Pencil, Save, Loader2, Trash2, Plus, ExternalLink, FileText } from 'lucide-react';
import {
  fetchCharacterSheetById,
  fetchCharacterSheetByName,
  saveCharacterSheet,
  deleteCharacterSheet,
} from '../../lib/supabase';
import {
  STAT_RANKS, SKILL_LEVELS, SHINOBI_RANKS, SHEET_VILLAGES, THREAT_LEVELS,
  CHARACTER_SLOTS, ECONOMIC_STATUS, GENDERS, BLOOD_TYPES, MONTHS,
  FAMILY_STATUS, SHEET_NATURES, JUTSU_RANKS, APPROVED_STATES,
  ACADEMY_JUTSUS, LIMITS, RANK_LIMITS,
  normalizeSheet, computeCU, sheetHasContent,
} from '../../constants/characterSheet';

/*
 * The NARP OC sheet, rendered from the database instead of a Google Doc.
 * Section order and headings follow the original sheet one-for-one so a player
 * moving over recognises the document.
 *
 * Read-only for everyone; the owner and staff+ get an Edit toggle that turns
 * every value into an input in place.
 */

const PANEL = '#0f172a';
const HAIRLINE = 'rgba(255,255,255,0.07)';

// ─── PRIMITIVES ──────────────────────────────────────────────────────────────

const inputCls =
  'w-full rounded-sm px-2 py-1.5 text-sm text-slate-200 outline-none focus:ring-1 focus:ring-sky-500/60 ' +
  'bg-white/[0.04] border border-white/10 placeholder:text-slate-600';

const Dash = () => <span className="text-slate-600">—</span>;

function Text({ value, onChange, editing, placeholder = '', type = 'text' }) {
  if (!editing) return value ? <span className="text-slate-200 break-words">{value}</span> : <Dash />;
  return (
    <input type={type} value={value || ''} placeholder={placeholder}
           onChange={e => onChange(e.target.value)} className={inputCls} />
  );
}

function Choice({ value, onChange, editing, options, placeholder = 'Select' }) {
  if (!editing) return value ? <span className="text-slate-200">{value}</span> : <Dash />;
  return (
    <select value={value || ''} onChange={e => onChange(e.target.value)}
            className={inputCls + ' appearance-none cursor-pointer'}>
      <option value="">{placeholder}</option>
      {options.map(o => <option key={o} value={o}>{o}</option>)}
    </select>
  );
}

function Area({ value, onChange, editing, placeholder = '', rows = 5 }) {
  if (!editing) {
    return value
      ? <p className="text-sm text-slate-300 leading-relaxed whitespace-pre-wrap break-words">{value}</p>
      : <p className="text-sm text-slate-600 italic">Not written yet</p>;
  }
  return (
    <textarea value={value || ''} rows={rows} placeholder={placeholder}
              onChange={e => onChange(e.target.value)}
              className={inputCls + ' leading-relaxed resize-y'} />
  );
}

function Link({ value, onChange, editing, placeholder = 'Hyperlink' }) {
  if (!editing) {
    if (!value) return <Dash />;
    return (
      <a href={value} target="_blank" rel="noopener noreferrer"
         className="inline-flex items-center gap-1 text-sky-400 hover:text-sky-300 text-xs font-semibold">
        Open <ExternalLink size={10} />
      </a>
    );
  }
  return (
    <input type="url" value={value || ''} placeholder={placeholder}
           onChange={e => onChange(e.target.value)} className={inputCls} />
  );
}

// Label / value pair, mirroring the two-column layout of the printed sheet.
function Field({ label, note, children }) {
  return (
    <div className="grid grid-cols-[minmax(9rem,38%)_1fr] gap-3 items-center py-1.5"
         style={{ borderBottom: `1px solid ${HAIRLINE}` }}>
      <div className="min-w-0">
        <span className="text-[10px] font-black uppercase tracking-[0.13em] text-slate-500">{label}</span>
        {note && <span className="block text-[9px] text-slate-600 italic">{note}</span>}
      </div>
      <div className="min-w-0 text-sm">{children}</div>
    </div>
  );
}

function Section({ kanji, title, note, accent, children }) {
  return (
    <section className="mb-8">
      <div className="flex items-center gap-3 mb-3">
        <span className="flex items-center justify-center w-8 h-8 rounded-sm text-base font-serif shrink-0"
              style={{ background: `${accent}14`, border: `1px solid ${accent}3d`, color: accent }}>
          {kanji}
        </span>
        <h3 className="text-xs font-black uppercase tracking-[0.2em] text-slate-200">{title}</h3>
        <div className="flex-1 h-px" style={{ background: `linear-gradient(to right, ${accent}44, transparent)` }} />
      </div>
      {note && <p className="text-[11px] text-slate-500 italic mb-3 leading-relaxed">{note}</p>}
      {children}
    </section>
  );
}

function Table({ headers, children, minWidth = '26rem' }) {
  return (
    <div className="overflow-x-auto -mx-1 px-1">
      <table className="w-full text-sm border-collapse" style={{ minWidth }}>
        <thead>
          <tr>
            {headers.map((h, i) => (
              <th key={i} className="text-left text-[9px] font-black uppercase tracking-[0.13em] text-slate-500 pb-1.5 pr-3"
                  style={{ borderBottom: `1px solid ${HAIRLINE}` }}>
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
  <td className={`py-1.5 pr-3 align-middle ${className}`} style={{ borderBottom: `1px solid ${HAIRLINE}` }}>
    {children}
  </td>
);

// ─── MODAL ───────────────────────────────────────────────────────────────────

export default function CharacterSheetModal({
  sheetId = null,
  characterName = '',
  characterLink = '',
  canEditAny = false,      // staff+ may edit anyone's sheet
  currentUserId = null,
  accent = '#38bdf8',
  onClose,
  onSaved,
}) {
  const [row, setRow] = useState(null);
  const [sheet, setSheet] = useState(() => normalizeSheet(null));
  const [name, setName] = useState(characterName);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [saveError, setSaveError] = useState('');

  // Load by id when the roster already knows it, otherwise by name — a roster
  // row whose character has no sheet yet lands on the "not created" state.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setLoadError('');
      try {
        const found = sheetId
          ? await fetchCharacterSheetById(sheetId)
          : await fetchCharacterSheetByName(characterName);
        if (cancelled) return;
        setRow(found || null);
        setSheet(normalizeSheet(found?.data));
        setName(found?.character_name || characterName);
      } catch (err) {
        if (!cancelled) setLoadError(err.message || String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [sheetId, characterName]);

  const isOwner = !!(row?.owner_id && currentUserId && row.owner_id === currentUserId);
  const canEdit = canEditAny || isOwner || (!row && !!currentUserId);
  const canDelete = !!row && (canEditAny || isOwner);

  // Immutable-ish setters keyed by section, so every field is a one-liner.
  const patch = useCallback((section, key, value) => {
    setSheet(prev => ({ ...prev, [section]: { ...prev[section], [key]: value } }));
  }, []);

  // path points at an array of row objects, e.g. ['equipment', 'tools'].
  const patchRow = useCallback((path, index, key, value) => {
    const setIn = (node, keys) => {
      const [head, ...rest] = keys;
      if (!rest.length) {
        const list = node[head] || [];
        return { ...node, [head]: list.map((r, i) => (i === index ? { ...r, [key]: value } : r)) };
      }
      return { ...node, [head]: setIn(node[head] || {}, rest) };
    };
    setSheet(prev => setIn(prev, path));
  }, []);

  const cu = useMemo(() => computeCU(sheet.stats), [sheet.stats]);
  const rankLimits = RANK_LIMITS[sheet.personal.shinobi_rank] || null;
  const hasContent = sheetHasContent(sheet);

  // The sheet reserves 30 jutsu slots, but showing 30 empty inputs is a wall.
  // Editing exposes the filled ones plus a few spares, growing as they fill.
  const jutsuRowsShown = useMemo(() => {
    const lastFilled = sheet.techniques.jutsu.reduce((last, j, i) => (j.name ? i : last), -1);
    return Math.min(LIMITS.jutsuSlots, Math.max(5, lastFilled + 4));
  }, [sheet.techniques.jutsu]);

  const handleSave = async () => {
    if (saving) return;
    setSaveError('');
    if (!name.trim()) { setSaveError('The sheet needs a character name.'); return; }
    setSaving(true);
    try {
      const saved = await saveCharacterSheet({
        id: row?.id,
        characterName: name,
        village: sheet.personal.village,
        ninjaRank: sheet.personal.shinobi_rank,
        bloodline: sheet.personal.clan_kkg,
        data: sheet,
      });
      setRow(saved);
      setEditing(false);
      if (onSaved) onSaved(saved);
    } catch (err) {
      console.warn('[NARP] Character sheet save failed:', err);
      setSaveError(err.message || String(err));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!row?.id || deleting) return;
    if (!window.confirm(`Delete the character sheet for "${row.character_name}"? This cannot be undone.`)) return;
    setDeleting(true);
    try {
      await deleteCharacterSheet(row.id);
      if (onSaved) onSaved(null);
      onClose();
    } catch (err) {
      setSaveError(err.message || String(err));
      setDeleting(false);
    }
  };

  const ed = editing;

  return (
    <div className="fixed inset-0 z-[90] overflow-y-auto p-3 md:p-6"
         style={{ background: 'rgba(0,0,0,0.78)', backdropFilter: 'blur(4px)' }}
         onClick={onClose}>
      <div className="w-full max-w-3xl mx-auto rounded-sm shadow-2xl my-2"
           style={{ background: PANEL, border: '1px solid rgba(255,255,255,0.1)' }}
           onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="sticky top-0 z-10 px-5 py-4 rounded-t-sm"
             style={{ background: PANEL, borderBottom: `1px solid ${HAIRLINE}` }}>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[9px] font-black uppercase tracking-[0.25em] mb-1" style={{ color: accent }}>
                籍 NARP Character Sheet
              </p>
              {ed ? (
                <input value={name} onChange={e => setName(e.target.value)}
                       placeholder="Character name"
                       className="text-lg font-black tracking-wide text-slate-100 bg-white/[0.04] border border-white/10 rounded-sm px-2 py-1 outline-none focus:ring-1 focus:ring-sky-500/60" />
              ) : (
                <h2 className="text-lg font-black tracking-wide text-slate-100 truncate">{name || 'Unnamed character'}</h2>
              )}
              {!ed && (
                <p className="text-[10px] text-slate-500 mt-0.5">
                  {[sheet.personal.village, sheet.personal.shinobi_rank, sheet.personal.clan_kkg]
                    .filter(Boolean).join(' · ') || 'No affiliation recorded'}
                </p>
              )}
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              {characterLink && !ed && (
                <a href={characterLink} target="_blank" rel="noopener noreferrer" title="Character area"
                   className="p-1.5 rounded-sm text-slate-400 hover:text-slate-200 transition-colors"
                   style={{ border: `1px solid ${HAIRLINE}` }}>
                  <ExternalLink size={14} />
                </a>
              )}
              {canEdit && !ed && !loading && (
                <button onClick={() => setEditing(true)} title="Edit sheet"
                        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-sm text-[10px] font-black uppercase tracking-wider transition-all hover:brightness-110"
                        style={{ background: `${accent}1f`, color: accent, border: `1px solid ${accent}3d` }}>
                  <Pencil size={11} /> {row ? 'Edit' : 'Create sheet'}
                </button>
              )}
              {ed && (
                <>
                  <button onClick={handleSave} disabled={saving}
                          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-sm text-[10px] font-black uppercase tracking-wider transition-all hover:brightness-110 disabled:opacity-50"
                          style={{ background: 'rgba(16,185,129,0.15)', color: '#34d399', border: '1px solid rgba(16,185,129,0.3)' }}>
                    {saving ? <Loader2 size={11} className="animate-spin" /> : <Save size={11} />} Save
                  </button>
                  <button onClick={() => { setEditing(false); setSheet(normalizeSheet(row?.data)); setName(row?.character_name || characterName); setSaveError(''); }}
                          className="px-2.5 py-1.5 rounded-sm text-[10px] font-black uppercase tracking-wider text-slate-400 hover:text-slate-200 transition-colors"
                          style={{ border: `1px solid ${HAIRLINE}` }}>
                    Cancel
                  </button>
                </>
              )}
              <button onClick={onClose} className="p-1.5 text-slate-500 hover:text-slate-300 transition-colors">
                <X size={16} />
              </button>
            </div>
          </div>
          {saveError && (
            <p className="mt-2 text-[11px] font-semibold text-rose-400">{saveError}</p>
          )}
        </div>

        {/* Body */}
        <div className="px-5 py-5">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-16 text-slate-500 text-xs">
              <Loader2 size={14} className="animate-spin" /> Loading sheet…
            </div>
          ) : loadError ? (
            <p className="py-16 text-center text-sm text-rose-400">Could not load this sheet: {loadError}</p>
          ) : !row && !ed ? (
            <div className="py-14 text-center">
              <FileText size={26} className="mx-auto mb-3 text-slate-700" />
              <p className="text-sm text-slate-400 font-semibold">No character sheet yet</p>
              <p className="text-xs text-slate-600 mt-1 max-w-sm mx-auto leading-relaxed">
                {canEdit
                  ? `Nothing has been filled in for ${name || 'this character'} yet. Use “Create sheet” to start one.`
                  : `${name || 'This character'} hasn’t had their sheet filled in yet. Only the player who owns them or a staff member can create it.`}
              </p>
            </div>
          ) : (
            <>
              {!ed && !hasContent && (
                <p className="mb-6 text-xs text-amber-400/80 italic">This sheet exists but is mostly empty.</p>
              )}

              {/* 人 PERSONAL INFORMATION */}
              <Section kanji="人" title="Personal Information" accent={accent}>
                <Field label="Submitted by"><Text editing={ed} value={sheet.personal.submitted_by} onChange={v => patch('personal', 'submitted_by', v)} placeholder="Discord username" /></Field>
                <Field label="Character slot"><Choice editing={ed} value={sheet.personal.character_slot} onChange={v => patch('personal', 'character_slot', v)} options={CHARACTER_SLOTS} /></Field>
                <Field label="Alias(es)"><Text editing={ed} value={sheet.personal.aliases} onChange={v => patch('personal', 'aliases', v)} /></Field>
                <Field label="Village affiliation"><Choice editing={ed} value={sheet.personal.village} onChange={v => patch('personal', 'village', v)} options={SHEET_VILLAGES} /></Field>
                <Field label="Threat level"><Choice editing={ed} value={sheet.personal.threat_level} onChange={v => patch('personal', 'threat_level', v)} options={THREAT_LEVELS} /></Field>
                <Field label="Shinobi rank"><Choice editing={ed} value={sheet.personal.shinobi_rank} onChange={v => patch('personal', 'shinobi_rank', v)} options={SHINOBI_RANKS} /></Field>
                <Field label="Clan / KKG"><Text editing={ed} value={sheet.personal.clan_kkg} onChange={v => patch('personal', 'clan_kkg', v)} /></Field>
                <Field label="Economic status"><Choice editing={ed} value={sheet.personal.economic_status} onChange={v => patch('personal', 'economic_status', v)} options={ECONOMIC_STATUS} /></Field>
                <Field label="Age"><Text editing={ed} value={sheet.personal.age} onChange={v => patch('personal', 'age', v)} placeholder="years old" /></Field>
                <Field label="Birthday">
                  {ed ? (
                    <div className="grid grid-cols-[5rem_1fr] gap-2">
                      <input value={sheet.personal.birthday_day || ''} onChange={e => patch('personal', 'birthday_day', e.target.value)}
                             placeholder="Day" className={inputCls} />
                      <select value={sheet.personal.birthday_month || ''} onChange={e => patch('personal', 'birthday_month', e.target.value)}
                              className={inputCls + ' appearance-none cursor-pointer'}>
                        <option value="">Month</option>
                        {MONTHS.map(m => <option key={m} value={m}>{m}</option>)}
                      </select>
                    </div>
                  ) : (
                    (sheet.personal.birthday_day || sheet.personal.birthday_month)
                      ? <span className="text-slate-200">{[sheet.personal.birthday_day, sheet.personal.birthday_month].filter(Boolean).join(' ')}</span>
                      : <Dash />
                  )}
                </Field>
                <Field label="Gender"><Choice editing={ed} value={sheet.personal.gender} onChange={v => patch('personal', 'gender', v)} options={GENDERS} /></Field>
                <Field label="Blood type" note="non-mandatory"><Choice editing={ed} value={sheet.personal.blood_type} onChange={v => patch('personal', 'blood_type', v)} options={BLOOD_TYPES} /></Field>
                <Field label="Height"><Text editing={ed} value={sheet.personal.height} onChange={v => patch('personal', 'height', v)} /></Field>
                <Field label="Weight"><Text editing={ed} value={sheet.personal.weight} onChange={v => patch('personal', 'weight', v)} /></Field>

                <p className="text-[10px] font-black uppercase tracking-[0.13em] text-slate-500 mt-5 mb-1.5">Personality</p>
                <p className="text-[10px] text-slate-600 italic mb-2 leading-relaxed">
                  For any OC above Chūnin rank: how do people see them? How do they interact with family, strangers,
                  friends, enemies? How do they act on duty versus at home, alone versus in public? Flaws?
                </p>
                <Area editing={ed} value={sheet.personal.personality} onChange={v => patch('personal', 'personality', v)} rows={6} />

                <p className="text-[10px] font-black uppercase tracking-[0.13em] text-slate-500 mt-5 mb-1.5">Personal goals <span className="text-slate-600 normal-case font-normal italic">(not mandatory)</span></p>
                <Area editing={ed} value={sheet.personal.goals} onChange={v => patch('personal', 'goals', v)} rows={4} />
              </Section>

              {/* 家 FAMILY */}
              <Section kanji="家" title="Family Information" accent={accent}
                       note="Two parents with their current status are required, whether your OC knows them or not. NPCs or player characters both work — ask before assuming a family connection to someone else's OC.">
                <Table headers={['Relation', 'Name', 'Status']}>
                  {sheet.family.map((f, i) => (
                    <tr key={i}>
                      <Cell className="w-32">
                        {i < 2
                          ? <span className="text-[10px] font-black uppercase tracking-wider text-slate-500">{f.relation}</span>
                          : <Text editing={ed} value={f.relation} onChange={v => patchRow(['family'], i, 'relation', v)} placeholder="Other" />}
                      </Cell>
                      <Cell><Text editing={ed} value={f.name} onChange={v => patchRow(['family'], i, 'name', v)} placeholder="Insert name" /></Cell>
                      <Cell className="w-36"><Choice editing={ed} value={f.status} onChange={v => patchRow(['family'], i, 'status', v)} options={FAMILY_STATUS} /></Cell>
                    </tr>
                  ))}
                </Table>
              </Section>

              {/* 具 EQUIPMENT */}
              <Section kanji="具" title="Equipment" accent={accent}>
                <p className="text-[10px] font-black uppercase tracking-[0.13em] text-slate-500 mb-1.5">Tools <span className="text-slate-600 normal-case font-normal italic">(limit of 20 per tool)</span></p>
                <Table headers={['Tool name', 'Amount']}>
                  {sheet.equipment.tools.map((t, i) => (
                    <tr key={i}>
                      <Cell><Text editing={ed} value={t.name} onChange={v => patchRow(['equipment', 'tools'], i, 'name', v)} /></Cell>
                      <Cell className="w-28"><Text editing={ed} value={t.amount} onChange={v => patchRow(['equipment', 'tools'], i, 'amount', v)} /></Cell>
                    </tr>
                  ))}
                </Table>

                <p className="text-[10px] font-black uppercase tracking-[0.13em] text-slate-500 mt-5 mb-1.5">Scrolls <span className="text-slate-600 normal-case font-normal italic">(limit of {LIMITS.scrolls}; content stacks of 20 each)</span></p>
                <Table headers={['Scroll type / name', 'Contents']}>
                  {sheet.equipment.scrolls.map((s, i) => (
                    <tr key={i}>
                      <Cell className="w-1/3"><Text editing={ed} value={s.name} onChange={v => patchRow(['equipment', 'scrolls'], i, 'name', v)} /></Cell>
                      <Cell><Text editing={ed} value={s.contents} onChange={v => patchRow(['equipment', 'scrolls'], i, 'contents', v)} /></Cell>
                    </tr>
                  ))}
                </Table>

                <p className="text-[10px] font-black uppercase tracking-[0.13em] text-slate-500 mt-5 mb-1.5">Special weapons &amp; items <span className="text-slate-600 normal-case font-normal italic">(limit of 2 each)</span></p>
                <div className="grid md:grid-cols-2 gap-x-6">
                  <div>
                    <p className="text-[9px] font-black uppercase tracking-[0.13em] text-slate-600 mb-1">Special / custom weapons</p>
                    <Table headers={['Name', 'Link']} minWidth="15rem">
                      {sheet.equipment.special_weapons.map((w, i) => (
                        <tr key={i}>
                          <Cell><Text editing={ed} value={w.name} onChange={v => patchRow(['equipment', 'special_weapons'], i, 'name', v)} /></Cell>
                          <Cell className="w-24"><Link editing={ed} value={w.link} onChange={v => patchRow(['equipment', 'special_weapons'], i, 'link', v)} /></Cell>
                        </tr>
                      ))}
                    </Table>
                  </div>
                  <div>
                    <p className="text-[9px] font-black uppercase tracking-[0.13em] text-slate-600 mb-1 mt-4 md:mt-0">Special / custom tools</p>
                    <Table headers={['Name', 'Link']} minWidth="15rem">
                      {sheet.equipment.special_tools.map((w, i) => (
                        <tr key={i}>
                          <Cell><Text editing={ed} value={w.name} onChange={v => patchRow(['equipment', 'special_tools'], i, 'name', v)} /></Cell>
                          <Cell className="w-24"><Link editing={ed} value={w.link} onChange={v => patchRow(['equipment', 'special_tools'], i, 'link', v)} /></Cell>
                        </tr>
                      ))}
                    </Table>
                  </div>
                </div>

                <div className="mt-4">
                  <Field label="Special items"><Text editing={ed} value={sheet.equipment.special_items} onChange={v => patch('equipment', 'special_items', v)} /></Field>
                  <Field label="Prosthetic" note="see puppet system"><Text editing={ed} value={sheet.equipment.prosthetic} onChange={v => patch('equipment', 'prosthetic', v)} placeholder="N/A" /></Field>
                </div>
              </Section>

              {/* 力 STATS */}
              <Section kanji="力" title="Stats" accent={accent}
                       note={rankLimits ? `${sheet.personal.shinobi_rank} — ${rankLimits.stats}` : 'Check your rank’s starting limitations in the server systems and mechanics section.'}>
                <Field label="Chakra level"><Choice editing={ed} value={sheet.stats.chakra_level} onChange={v => patch('stats', 'chakra_level', v)} options={STAT_RANKS} /></Field>
                <Field label="Chakra control"><Choice editing={ed} value={sheet.stats.chakra_control} onChange={v => patch('stats', 'chakra_control', v)} options={STAT_RANKS} /></Field>
                <Field label="Speed"><Choice editing={ed} value={sheet.stats.speed} onChange={v => patch('stats', 'speed', v)} options={STAT_RANKS} /></Field>
                <Field label="Strength"><Choice editing={ed} value={sheet.stats.strength} onChange={v => patch('stats', 'strength', v)} options={STAT_RANKS} /></Field>
                <Field label="Base chakra pool / unit" note="chakra level + control + 5">
                  <span className="font-black tabular-nums" style={{ color: accent }}>{cu.base} CU</span>
                </Field>
                <Field label="Extra CU" note="amount and from what">
                  {ed ? (
                    <div className="grid grid-cols-[5rem_1fr] gap-2">
                      <input value={sheet.stats.extra_cu || ''} onChange={e => patch('stats', 'extra_cu', e.target.value)}
                             placeholder="0" className={inputCls} />
                      <input value={sheet.stats.extra_cu_source || ''} onChange={e => patch('stats', 'extra_cu_source', e.target.value)}
                             placeholder="from what" className={inputCls} />
                    </div>
                  ) : (
                    (sheet.stats.extra_cu || sheet.stats.extra_cu_source)
                      ? <span className="text-slate-200">{sheet.stats.extra_cu || '0'}{sheet.stats.extra_cu_source ? ` — ${sheet.stats.extra_cu_source}` : ''}</span>
                      : <Dash />
                  )}
                </Field>
                <Field label="Total CU">
                  <span className="font-black tabular-nums text-base" style={{ color: accent }}>{cu.total} CU</span>
                </Field>
              </Section>

              {/* 技 SKILLS */}
              <Section kanji="技" title="Skills" accent={accent}
                       note={rankLimits ? `${sheet.personal.shinobi_rank} — ${rankLimits.skills}` : 'Check your rank’s starting limitations in the server systems and mechanics section.'}>
                {[
                  ['ninjutsu', 'Ninjutsu'], ['taijutsu', 'Taijutsu'], ['genjutsu', 'Genjutsu'],
                  ['fuinjutsu', 'Fuinjutsu'], ['bukijutsu', 'Bukijutsu'], ['medical', 'Medical'],
                ].map(([k, label]) => (
                  <Field key={k} label={label}>
                    <Choice editing={ed} value={sheet.skills[k]} onChange={v => patch('skills', k, v)} options={SKILL_LEVELS} />
                  </Field>
                ))}
              </Section>

              {/* 獣 SUMMONS */}
              <Section kanji="獣" title="Summon Information" accent={accent} note="A character cannot start with a contract.">
                <Field label="Summon contract"><Text editing={ed} value={sheet.summon.contract} onChange={v => patch('summon', 'contract', v)} placeholder="Put name here" /></Field>
                <Field label="Summon skill"><Choice editing={ed} value={sheet.summon.skill} onChange={v => patch('summon', 'skill', v)} options={SKILL_LEVELS} /></Field>
                <div className="mt-4">
                  <Table headers={['Summon level', 'Summon’s name', 'Link']}>
                    {sheet.summon.entries.map((s, i) => (
                      <tr key={i}>
                        <Cell className="w-36"><span className="text-[10px] font-black uppercase tracking-wider text-slate-500">{s.level}</span></Cell>
                        <Cell><Text editing={ed} value={s.name} onChange={v => patchRow(['summon', 'entries'], i, 'name', v)} /></Cell>
                        <Cell className="w-24"><Link editing={ed} value={s.link} onChange={v => patchRow(['summon', 'entries'], i, 'link', v)} /></Cell>
                      </tr>
                    ))}
                  </Table>
                </div>
              </Section>

              {/* 異 SPECIAL SKILLS */}
              <Section kanji="異" title="Special Skills" accent={accent}>
                <Field label="Special"><Text editing={ed} value={sheet.special.special} onChange={v => patch('special', 'special', v)} /></Field>
                <Field label="Special ability"><Text editing={ed} value={sheet.special.ability} onChange={v => patch('special', 'ability', v)} /></Field>
                <Field label="Special skill level"><Choice editing={ed} value={sheet.special.level} onChange={v => patch('special', 'level', v)} options={SKILL_LEVELS} /></Field>
              </Section>

              {/* 限 LIMITED ABILITIES */}
              <Section kanji="限" title="Limited Abilities" accent={accent}>
                <p className="text-[10px] font-black uppercase tracking-[0.13em] text-slate-500 mb-1.5">Dojutsu</p>
                <Field label="Dojutsu"><Text editing={ed} value={sheet.limited.dojutsu_name} onChange={v => patch('limited', 'dojutsu_name', v)} placeholder="Dojutsu name" /></Field>
                <Field label="Stage"><Text editing={ed} value={sheet.limited.dojutsu_stage} onChange={v => patch('limited', 'dojutsu_stage', v)} /></Field>
                <Field label="Dojutsu skill"><Choice editing={ed} value={sheet.limited.dojutsu_skill} onChange={v => patch('limited', 'dojutsu_skill', v)} options={SKILL_LEVELS} /></Field>

                <p className="text-[10px] font-black uppercase tracking-[0.13em] text-slate-500 mt-5 mb-1.5">Known chakra natures</p>
                <p className="text-[10px] text-slate-600 italic mb-2">The listed ranks are the starting limits per shinobi rank.</p>
                <Field label="Yin"><span className="text-slate-400 text-xs italic">All characters know</span></Field>
                <Field label="Yang"><span className="text-slate-400 text-xs italic">All characters know</span></Field>
                <Field label="Clan / KKG / Hidden / Jin nature"><Text editing={ed} value={sheet.limited.clan_nature} onChange={v => patch('limited', 'clan_nature', v)} placeholder="N/A if none" /></Field>
                {[
                  ['Nature 1', ''],
                  ['Nature 2', 'Chūnin and above'],
                  ['Nature 3', 'Jōnin / Anbu and above'],
                  ['Nature 4', 'Kage-class rank only'],
                  ['Nature 5', 'Non-clan — unlocks at Special Jōnin and above'],
                ].map(([label, note], i) => (
                  <Field key={label} label={label} note={note}>
                    <Choice editing={ed} value={sheet.limited.natures[i]} options={SHEET_NATURES}
                            onChange={v => setSheet(prev => {
                              const natures = [...prev.limited.natures];
                              natures[i] = v;
                              return { ...prev, limited: { ...prev.limited, natures } };
                            })} />
                  </Field>
                ))}
              </Section>

              {/* 術 TECHNIQUES */}
              <Section kanji="術" title="Techniques" accent={accent}
                       note={`Every jutsu listed here must already exist in this database. ${rankLimits ? `${sheet.personal.shinobi_rank} — ${rankLimits.techniques}` : 'Check the NARP documentation for your allowed jutsu number and rank.'}`}>
                <Table headers={['Slot', 'Name', 'Rank', 'Nature', 'Approved?', 'Doc link']}>
                  {sheet.techniques.jutsu.map((j, i) => (
                    (ed ? i < jutsuRowsShown : !!j.name) ? (
                      <tr key={i}>
                        <Cell className="w-10"><span className="text-[10px] font-black text-slate-600 tabular-nums">{i + 1}</span></Cell>
                        <Cell><Text editing={ed} value={j.name} onChange={v => patchRow(['techniques', 'jutsu'], i, 'name', v)} /></Cell>
                        <Cell className="w-20"><Choice editing={ed} value={j.rank} onChange={v => patchRow(['techniques', 'jutsu'], i, 'rank', v)} options={JUTSU_RANKS} placeholder="—" /></Cell>
                        <Cell className="w-28"><Choice editing={ed} value={j.nature} onChange={v => patchRow(['techniques', 'jutsu'], i, 'nature', v)} options={SHEET_NATURES} placeholder="—" /></Cell>
                        <Cell className="w-24"><Choice editing={ed} value={j.approved} onChange={v => patchRow(['techniques', 'jutsu'], i, 'approved', v)} options={APPROVED_STATES} placeholder="—" /></Cell>
                        <Cell className="w-24"><Link editing={ed} value={j.link} onChange={v => patchRow(['techniques', 'jutsu'], i, 'link', v)} /></Cell>
                      </tr>
                    ) : null
                  ))}
                </Table>
                {!ed && !sheet.techniques.jutsu.some(j => j.name) && (
                  <p className="text-xs text-slate-600 italic py-2">No techniques listed yet</p>
                )}
                {ed && (
                  <p className="text-[10px] text-slate-600 italic mt-1.5">
                    Showing {jutsuRowsShown} of {LIMITS.jutsuSlots} slots — more appear as you fill these in.
                  </p>
                )}

                <p className="text-[10px] font-black uppercase tracking-[0.13em] text-slate-500 mt-5 mb-1.5">PvE slots</p>
                <Table headers={['Slot', 'Name', 'Rank', 'Nature', 'Approved?', 'Doc link']}>
                  {sheet.techniques.pve.map((j, i) => (
                    (ed || j.name) ? (
                      <tr key={i}>
                        <Cell className="w-14"><span className="text-[10px] font-black text-slate-600">PvE {i + 1}</span></Cell>
                        <Cell><Text editing={ed} value={j.name} onChange={v => patchRow(['techniques', 'pve'], i, 'name', v)} /></Cell>
                        <Cell className="w-20"><Choice editing={ed} value={j.rank} onChange={v => patchRow(['techniques', 'pve'], i, 'rank', v)} options={JUTSU_RANKS} placeholder="—" /></Cell>
                        <Cell className="w-28"><Choice editing={ed} value={j.nature} onChange={v => patchRow(['techniques', 'pve'], i, 'nature', v)} options={SHEET_NATURES} placeholder="—" /></Cell>
                        <Cell className="w-24"><Choice editing={ed} value={j.approved} onChange={v => patchRow(['techniques', 'pve'], i, 'approved', v)} options={APPROVED_STATES} placeholder="—" /></Cell>
                        <Cell className="w-24"><Link editing={ed} value={j.link} onChange={v => patchRow(['techniques', 'pve'], i, 'link', v)} /></Cell>
                      </tr>
                    ) : null
                  ))}
                </Table>
                {!ed && !sheet.techniques.pve.some(j => j.name) && (
                  <p className="text-xs text-slate-600 italic py-2">No PvE techniques listed yet</p>
                )}
              </Section>

              {/* 基 ACADEMY JUTSUS + Battle modes */}
              <Section kanji="基" title="Academy Jutsus" accent={accent} note="Everyone has these.">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1">
                  {ACADEMY_JUTSUS.map(j => (
                    <div key={j} className="flex items-center gap-2 text-xs text-slate-400">
                      <span style={{ color: accent }}>●</span> {j}
                    </div>
                  ))}
                </div>

                <p className="text-[10px] font-black uppercase tracking-[0.13em] text-slate-500 mt-6 mb-1.5">Battle mode list</p>
                <Table headers={['Slot type', 'Name of battle mode / technique', 'Link']}>
                  {sheet.battle_modes.slots.map((b, i) => (
                    <tr key={i}>
                      <Cell className="w-40"><span className="text-[10px] font-black uppercase tracking-wider text-slate-500">{b.slot}</span></Cell>
                      <Cell><Text editing={ed} value={b.name} onChange={v => patchRow(['battle_modes', 'slots'], i, 'name', v)} /></Cell>
                      <Cell className="w-24"><Link editing={ed} value={b.link} onChange={v => patchRow(['battle_modes', 'slots'], i, 'link', v)} /></Cell>
                    </tr>
                  ))}
                </Table>

                <div className="mt-4">
                  <Field label="Awakening skill">
                    {ed ? (
                      <div className="grid grid-cols-[7rem_1fr] gap-2">
                        <select value={sheet.battle_modes.awakening_level || ''} onChange={e => patch('battle_modes', 'awakening_level', e.target.value)}
                                className={inputCls + ' appearance-none cursor-pointer'}>
                          <option value="">Select</option>
                          {SKILL_LEVELS.map(s => <option key={s} value={s}>{s}</option>)}
                        </select>
                        <input type="url" value={sheet.battle_modes.awakening_link || ''} onChange={e => patch('battle_modes', 'awakening_link', e.target.value)}
                               placeholder="Hyperlink" className={inputCls} />
                      </div>
                    ) : (
                      sheet.battle_modes.awakening_level || sheet.battle_modes.awakening_link ? (
                        <span className="flex items-center gap-2">
                          <span className="text-slate-200">{sheet.battle_modes.awakening_level || '—'}</span>
                          {sheet.battle_modes.awakening_link && (
                            <a href={sheet.battle_modes.awakening_link} target="_blank" rel="noopener noreferrer"
                               className="inline-flex items-center gap-1 text-sky-400 hover:text-sky-300 text-xs font-semibold">
                              Open <ExternalLink size={10} />
                            </a>
                          )}
                        </span>
                      ) : <Dash />
                    )}
                  </Field>
                  {sheet.battle_modes.primary_abilities.map((a, i) => (
                    <Field key={i} label={`Primary special ability ${i === 0 ? 'one' : 'two'}`}>
                      {ed ? (
                        <div className="grid grid-cols-2 gap-2">
                          <input value={a.name || ''} onChange={e => patchRow(['battle_modes', 'primary_abilities'], i, 'name', e.target.value)}
                                 placeholder="Name of the technique" className={inputCls} />
                          <input type="url" value={a.link || ''} onChange={e => patchRow(['battle_modes', 'primary_abilities'], i, 'link', e.target.value)}
                                 placeholder="Hyperlink" className={inputCls} />
                        </div>
                      ) : (
                        a.name || a.link ? (
                          <span className="flex items-center gap-2">
                            <span className="text-slate-200">{a.name || '—'}</span>
                            {a.link && (
                              <a href={a.link} target="_blank" rel="noopener noreferrer"
                                 className="inline-flex items-center gap-1 text-sky-400 hover:text-sky-300 text-xs font-semibold">
                                Open <ExternalLink size={10} />
                              </a>
                            )}
                          </span>
                        ) : <Dash />
                      )}
                    </Field>
                  ))}
                </div>
              </Section>

              {/* 趣 OTHER INFORMATION */}
              <Section kanji="趣" title="Other Information" accent={accent} note="All non-mandatory.">
                {[
                  ['foods', 'Favorite foods'], ['colors', 'Favorite colors'], ['hobbies', 'Hobbies'],
                  ['likes', 'Likes'], ['dislikes', 'Dislikes'],
                  ['beliefs', 'Beliefs, religions, philosophies'], ['locations', 'Special locations'],
                ].map(([k, label]) => (
                  <Field key={k} label={label}>
                    <Text editing={ed} value={sheet.other[k]} onChange={v => patch('other', k, v)} />
                  </Field>
                ))}
              </Section>

              {/* 歆 BACKGROUND */}
              <Section kanji="歆" title="Background" accent={accent}
                       note="One full paragraph and one significant event for each ninja rank.">
                <Area editing={ed} value={sheet.background} onChange={v => setSheet(prev => ({ ...prev, background: v }))} rows={10} />
              </Section>

              {/* 画 IMAGES */}
              <Section kanji="画" title="Images" accent={accent}>
                {ed ? (
                  <div className="space-y-2">
                    {sheet.images.map((url, i) => (
                      <div key={i} className="flex gap-2">
                        <input type="url" value={url} placeholder="https://…" className={inputCls + ' flex-1'}
                               onChange={e => setSheet(prev => ({ ...prev, images: prev.images.map((u, j) => j === i ? e.target.value : u) }))} />
                        <button type="button" onClick={() => setSheet(prev => ({ ...prev, images: prev.images.filter((_, j) => j !== i) }))}
                                className="px-2 text-slate-500 hover:text-rose-400 transition-colors">
                          <Trash2 size={13} />
                        </button>
                      </div>
                    ))}
                    {sheet.images.length < LIMITS.images && (
                      <button type="button" onClick={() => setSheet(prev => ({ ...prev, images: [...prev.images, ''] }))}
                              className="flex items-center gap-1 px-2.5 py-1 rounded-sm text-[9px] font-black uppercase tracking-wider transition-all hover:brightness-110"
                              style={{ background: `${accent}14`, color: accent, border: `1px solid ${accent}3d` }}>
                        <Plus size={10} /> Add image
                      </button>
                    )}
                  </div>
                ) : sheet.images.filter(Boolean).length ? (
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                    {sheet.images.filter(Boolean).map((url, i) => (
                      <a key={i} href={url} target="_blank" rel="noopener noreferrer"
                         className="block rounded-sm overflow-hidden" style={{ border: `1px solid ${HAIRLINE}` }}>
                        <img src={url} alt={`${name} ${i + 1}`} loading="lazy"
                             className="w-full h-32 object-cover hover:brightness-110 transition-all" />
                      </a>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-slate-600 italic">No images added</p>
                )}
              </Section>

              {/* 僀 PUPPET CATALOGUE — Puppet Clan only */}
              {(ed || sheet.puppets.length > 0) && (
                <Section kanji="僀" title="Puppet Catalogue" accent={accent} note="Puppet Clan characters only.">
                  <Table headers={['Name', 'Class', 'Size', 'Attuned nature', 'Docs', '']}>
                    {sheet.puppets.map((p, i) => (
                      <tr key={i}>
                        <Cell><Text editing={ed} value={p.name} onChange={v => patchRow(['puppets'], i, 'name', v)} /></Cell>
                        <Cell className="w-24"><Text editing={ed} value={p.puppet_class} onChange={v => patchRow(['puppets'], i, 'puppet_class', v)} /></Cell>
                        <Cell className="w-24"><Text editing={ed} value={p.size} onChange={v => patchRow(['puppets'], i, 'size', v)} /></Cell>
                        <Cell className="w-28"><Choice editing={ed} value={p.nature} onChange={v => patchRow(['puppets'], i, 'nature', v)} options={SHEET_NATURES} placeholder="N/A" /></Cell>
                        <Cell className="w-20"><Link editing={ed} value={p.link} onChange={v => patchRow(['puppets'], i, 'link', v)} /></Cell>
                        <Cell className="w-8">
                          {ed && (
                            <button type="button" onClick={() => setSheet(prev => ({ ...prev, puppets: prev.puppets.filter((_, j) => j !== i) }))}
                                    className="text-slate-500 hover:text-rose-400 transition-colors">
                              <Trash2 size={13} />
                            </button>
                          )}
                        </Cell>
                      </tr>
                    ))}
                  </Table>
                  {ed && sheet.puppets.length < LIMITS.puppets && (
                    <button type="button"
                            onClick={() => setSheet(prev => ({ ...prev, puppets: [...prev.puppets, { name: '', puppet_class: '', size: '', nature: '', link: '' }] }))}
                            className="mt-3 flex items-center gap-1 px-2.5 py-1 rounded-sm text-[9px] font-black uppercase tracking-wider transition-all hover:brightness-110"
                            style={{ background: `${accent}14`, color: accent, border: `1px solid ${accent}3d` }}>
                      <Plus size={10} /> Add puppet
                    </button>
                  )}
                </Section>
              )}

              {/* Footer */}
              <div className="flex items-center justify-between gap-3 pt-2" style={{ borderTop: `1px solid ${HAIRLINE}` }}>
                <p className="text-[10px] text-slate-600 pt-3">
                  {row?.updated_at ? `Last updated ${new Date(row.updated_at).toLocaleString()}` : 'Not saved yet'}
                </p>
                {ed && canDelete && (
                  <button onClick={handleDelete} disabled={deleting}
                          className="mt-3 flex items-center gap-1.5 px-2.5 py-1 rounded-sm text-[9px] font-black uppercase tracking-wider text-rose-400 hover:text-rose-300 transition-colors disabled:opacity-50"
                          style={{ border: '1px solid rgba(244,63,94,0.25)' }}>
                    {deleting ? <Loader2 size={11} className="animate-spin" /> : <Trash2 size={11} />} Delete sheet
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
