import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { X, Pencil, Save, Loader2, Trash2, Plus, ExternalLink, FileText, ChevronDown } from 'lucide-react';
import {
  RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Radar,
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
} from 'recharts';
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
import {
  PAPER, PAPER_BG, CARD, INK, INK_MUTED, HAIRLINE, RULE, HANKO, LINK_COLOR,
  inputCls, inputStyle, zebraRow, chartCardStyle, chartTooltipStyle,
  Dash, Text, Choice, Area, Link, Field, Section, Table, Cell, SubHead,
  SheetShell, HankoStamp,
} from './SheetKit';

/*
 * The NARP OC sheet, rendered from the database instead of a Google Doc.
 * Visual language is lifted from the original doc — cream paper, ink-black
 * serif headers with a kanji mark, a hanko stamp, thin hairline field rows,
 * dark-header zebra tables — with a few charts layered on top (stat radar,
 * skill bars, CU gauge, jutsu-rank histogram) since a live page can do more
 * than a static doc could.
 *
 * Read-only for everyone; the owner and staff+ get an Edit toggle that turns
 * every value into an input in place.
 *
 * Shared visual primitives (colors, Field/Section/Table/etc.) live in
 * ./SheetKit — JutsuSheetModal uses the same ones so the two sheets stay
 * visually identical.
 */

function StatRadar({ data, accent }) {
  return (
    <div className="rounded-sm p-2.5" style={chartCardStyle}>
      <ResponsiveContainer width="100%" height={170}>
        <RadarChart data={data} outerRadius="70%">
          <PolarGrid stroke={HAIRLINE} />
          <PolarAngleAxis dataKey="stat" tick={{ fill: INK, fontSize: 10, fontWeight: 700 }} />
          <PolarRadiusAxis domain={[0, STAT_RANKS.length - 1]} tick={false} axisLine={false} />
          <Radar dataKey="value" stroke={accent} fill={accent} fillOpacity={0.35} strokeWidth={2} />
        </RadarChart>
      </ResponsiveContainer>
    </div>
  );
}

function CUGauge({ cu, accent }) {
  const basePct = cu.total > 0 ? Math.round((cu.base / cu.total) * 100) : 0;
  return (
    <div className="rounded-sm p-3.5 flex flex-col justify-center h-full" style={chartCardStyle}>
      <div className="flex items-baseline justify-between mb-2.5">
        <span className="text-[10px] font-bold uppercase tracking-wide font-serif" style={{ color: INK_MUTED }}>Total Chakra Units</span>
        <span className="text-2xl font-serif font-black tabular-nums" style={{ color: INK }}>{cu.total}</span>
      </div>
      <div className="h-2.5 rounded-full overflow-hidden flex mb-2.5" style={{ background: HAIRLINE }}>
        {cu.base > 0 && <div style={{ width: `${basePct}%`, background: accent }} />}
        {cu.extra > 0 && <div style={{ width: `${100 - basePct}%`, background: HANKO }} />}
      </div>
      <div className="flex items-center gap-4 text-[10px] font-bold uppercase tracking-wide">
        <span className="flex items-center gap-1.5" style={{ color: INK_MUTED }}>
          <span className="w-2 h-2 rounded-full inline-block" style={{ background: accent }} /> Base {cu.base}
        </span>
        <span className="flex items-center gap-1.5" style={{ color: INK_MUTED }}>
          <span className="w-2 h-2 rounded-full inline-block" style={{ background: HANKO }} /> Extra {cu.extra}
        </span>
      </div>
    </div>
  );
}

function SkillBarChart({ data, accent }) {
  return (
    <div className="rounded-sm p-2.5" style={chartCardStyle}>
      <ResponsiveContainer width="100%" height={190}>
        <BarChart data={data} layout="vertical" margin={{ top: 4, right: 20, bottom: 4, left: 4 }}>
          <XAxis type="number" domain={[0, 100]} hide />
          <YAxis type="category" dataKey="skill" width={76} tick={{ fill: INK, fontSize: 11, fontWeight: 700 }} axisLine={false} tickLine={false} />
          <Tooltip formatter={v => `${v}%`} contentStyle={chartTooltipStyle} cursor={{ fill: HAIRLINE }} />
          <Bar dataKey="value" fill={accent} radius={[0, 3, 3, 0]} barSize={12} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function JutsuRankChart({ data, accent }) {
  return (
    <div className="rounded-sm p-2.5 mb-3" style={chartCardStyle}>
      <ResponsiveContainer width="100%" height={86}>
        <BarChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
          <XAxis dataKey="rank" tick={{ fill: INK, fontSize: 11, fontWeight: 700 }} axisLine={false} tickLine={false} />
          <YAxis hide allowDecimals={false} />
          <Tooltip contentStyle={chartTooltipStyle} cursor={{ fill: HAIRLINE }} />
          <Bar dataKey="count" fill={accent} radius={[3, 3, 0, 0]} barSize={22} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

// ─── MODAL ───────────────────────────────────────────────────────────────────

export default function CharacterSheetModal({
  sheetId = null,
  characterName = '',
  characterLink = '',
  canEditAny = false,      // staff+ may edit anyone's sheet
  currentUserId = null,
  accent = '#a23a2c',
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

  const anyStat = ['chakra_level', 'chakra_control', 'speed', 'strength'].some(k => sheet.stats[k]);
  const statRadarData = useMemo(() => ([
    { stat: 'Chakra Lvl', value: Math.max(0, STAT_RANKS.indexOf(sheet.stats.chakra_level)) },
    { stat: 'Chakra Ctrl', value: Math.max(0, STAT_RANKS.indexOf(sheet.stats.chakra_control)) },
    { stat: 'Speed', value: Math.max(0, STAT_RANKS.indexOf(sheet.stats.speed)) },
    { stat: 'Strength', value: Math.max(0, STAT_RANKS.indexOf(sheet.stats.strength)) },
  ]), [sheet.stats]);

  const anySkill = Object.values(sheet.skills).some(Boolean);
  const skillBarData = useMemo(() => ([
    { skill: 'Ninjutsu', value: parseInt(sheet.skills.ninjutsu) || 0 },
    { skill: 'Taijutsu', value: parseInt(sheet.skills.taijutsu) || 0 },
    { skill: 'Genjutsu', value: parseInt(sheet.skills.genjutsu) || 0 },
    { skill: 'Fuinjutsu', value: parseInt(sheet.skills.fuinjutsu) || 0 },
    { skill: 'Bukijutsu', value: parseInt(sheet.skills.bukijutsu) || 0 },
    { skill: 'Medical', value: parseInt(sheet.skills.medical) || 0 },
  ]), [sheet.skills]);

  const jutsuRankData = useMemo(() => (
    JUTSU_RANKS.map(r => ({ rank: r, count: sheet.techniques.jutsu.filter(j => j.rank === r).length }))
  ), [sheet.techniques.jutsu]);
  const anyJutsuRanked = jutsuRankData.some(d => d.count > 0);

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
         style={{ background: 'rgba(10,8,5,0.82)', backdropFilter: 'blur(4px)' }}
         onClick={onClose}>
      <div className="w-full max-w-3xl mx-auto rounded-md shadow-2xl my-2"
           style={{ background: PAPER_BG, border: '1px solid rgba(37,30,21,0.25)' }}
           onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="sticky top-0 z-10 px-5 py-4 rounded-t-md"
             style={{ background: PAPER_BG, borderBottom: `1px solid ${HAIRLINE}` }}>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[10px] font-bold uppercase tracking-[0.25em] mb-1 font-serif" style={{ color: INK_MUTED }}>
                籍 SARP Character Sheet
              </p>
              {ed ? (
                <input value={name} onChange={e => setName(e.target.value)}
                       placeholder="Character name"
                       className="text-xl font-serif font-bold tracking-tight px-2 py-1 rounded-sm outline-none border"
                       style={{ color: INK, ...inputStyle }} />
              ) : (
                <h2 className="text-xl font-serif font-bold tracking-tight truncate" style={{ color: INK }}>
                  {name || 'Unnamed character'}
                </h2>
              )}
              {!ed && (
                <p className="text-[11px] mt-0.5" style={{ color: INK_MUTED }}>
                  {[sheet.personal.village, sheet.personal.shinobi_rank, sheet.personal.clan_kkg]
                    .filter(Boolean).join(' · ') || 'No affiliation recorded'}
                </p>
              )}
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              {characterLink && !ed && (
                <a href={characterLink} target="_blank" rel="noopener noreferrer" title="Character area"
                   className="p-1.5 rounded-sm transition-colors hover:opacity-70"
                   style={{ color: INK_MUTED, border: `1px solid ${HAIRLINE}` }}>
                  <ExternalLink size={14} />
                </a>
              )}
              {canEdit && !ed && !loading && (
                <button onClick={() => setEditing(true)} title="Edit sheet"
                        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-sm text-[10px] font-bold uppercase tracking-wider transition-all hover:brightness-110"
                        style={{ background: `${accent}1f`, color: accent, border: `1px solid ${accent}55` }}>
                  <Pencil size={11} /> {row ? 'Edit' : 'Create sheet'}
                </button>
              )}
              {ed && (
                <>
                  <button onClick={handleSave} disabled={saving}
                          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-sm text-[10px] font-bold uppercase tracking-wider transition-all hover:brightness-110 disabled:opacity-50"
                          style={{ background: 'rgba(63,109,63,0.14)', color: '#3f6d3f', border: '1px solid rgba(63,109,63,0.35)' }}>
                    {saving ? <Loader2 size={11} className="animate-spin" /> : <Save size={11} />} Save
                  </button>
                  <button onClick={() => { setEditing(false); setSheet(normalizeSheet(row?.data)); setName(row?.character_name || characterName); setSaveError(''); }}
                          className="px-2.5 py-1.5 rounded-sm text-[10px] font-bold uppercase tracking-wider transition-colors hover:opacity-70"
                          style={{ color: INK_MUTED, border: `1px solid ${HAIRLINE}` }}>
                    Cancel
                  </button>
                </>
              )}
              <button onClick={onClose} className="p-1.5 transition-colors hover:opacity-70" style={{ color: INK_MUTED }}>
                <X size={16} />
              </button>
            </div>
          </div>
          {saveError && (
            <p className="mt-2 text-[11px] font-semibold" style={{ color: HANKO }}>{saveError}</p>
          )}
        </div>

        {/* Body */}
        <div className="px-5 py-5">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-16 text-xs" style={{ color: INK_MUTED }}>
              <Loader2 size={14} className="animate-spin" /> Loading sheet…
            </div>
          ) : loadError ? (
            <p className="py-16 text-center text-sm font-semibold" style={{ color: HANKO }}>Could not load this sheet: {loadError}</p>
          ) : !row && !ed ? (
            <div className="py-14 text-center">
              <FileText size={26} className="mx-auto mb-3" style={{ color: INK_MUTED, opacity: 0.6 }} />
              <p className="text-sm font-bold font-serif" style={{ color: INK }}>No character sheet yet</p>
              <p className="text-xs mt-1 max-w-sm mx-auto leading-relaxed" style={{ color: INK_MUTED }}>
                {canEdit
                  ? `Nothing has been filled in for ${name || 'this character'} yet. Use “Create sheet” to start one.`
                  : `${name || 'This character'} hasn’t had their sheet filled in yet. Only the player who owns them or a staff member can create it.`}
              </p>
            </div>
          ) : (
            <>
              {!ed && !hasContent && (
                <p className="mb-4 text-xs italic font-semibold" style={{ color: HANKO }}>This sheet exists but is mostly empty.</p>
              )}

              {/* Hanko stamp flourish */}
              <div className="flex justify-end -mt-1 mb-1">
                <div className="w-10 h-10 rounded-[3px] flex items-center justify-center select-none pointer-events-none"
                     style={{ border: `2px solid ${HANKO}`, opacity: 0.5, transform: 'rotate(-4deg)' }}>
                  <span className="font-serif font-bold text-base" style={{ color: HANKO }}>籍</span>
                </div>
              </div>

              {/* 人 PERSONAL INFORMATION */}
              <Section kanji="人" title="Personal Information">
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
                             placeholder="Day" className={inputCls} style={inputStyle} />
                      <div className="relative">
                        <select value={sheet.personal.birthday_month || ''} onChange={e => patch('personal', 'birthday_month', e.target.value)}
                                className={inputCls + ' appearance-none pr-7 cursor-pointer'} style={inputStyle}>
                          <option value="">Month</option>
                          {MONTHS.map(m => <option key={m} value={m}>{m}</option>)}
                        </select>
                        <ChevronDown size={13} className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: INK_MUTED }} />
                      </div>
                    </div>
                  ) : (
                    (sheet.personal.birthday_day || sheet.personal.birthday_month)
                      ? <span style={{ color: INK }}>{[sheet.personal.birthday_day, sheet.personal.birthday_month].filter(Boolean).join(' ')}</span>
                      : <Dash />
                  )}
                </Field>
                <Field label="Gender"><Choice editing={ed} value={sheet.personal.gender} onChange={v => patch('personal', 'gender', v)} options={GENDERS} /></Field>
                <Field label="Blood type" note="non-mandatory"><Choice editing={ed} value={sheet.personal.blood_type} onChange={v => patch('personal', 'blood_type', v)} options={BLOOD_TYPES} /></Field>
                <Field label="Height"><Text editing={ed} value={sheet.personal.height} onChange={v => patch('personal', 'height', v)} /></Field>
                <Field label="Weight"><Text editing={ed} value={sheet.personal.weight} onChange={v => patch('personal', 'weight', v)} /></Field>

                <SubHead>Personality</SubHead>
                <p className="text-[11px] italic mb-2 leading-relaxed" style={{ color: INK_MUTED }}>
                  For any OC above Chūnin rank: how do people see them? How do they interact with family, strangers,
                  friends, enemies? How do they act on duty versus at home, alone versus in public? Flaws?
                </p>
                <Area editing={ed} value={sheet.personal.personality} onChange={v => patch('personal', 'personality', v)} rows={6} />

                <SubHead note="(not mandatory)">Personal goals</SubHead>
                <Area editing={ed} value={sheet.personal.goals} onChange={v => patch('personal', 'goals', v)} rows={4} />
              </Section>

              {/* 家 FAMILY */}
              <Section kanji="家" title="Family Information"
                       note="Two parents with their current status are required, whether your OC knows them or not. NPCs or player characters both work — ask before assuming a family connection to someone else's OC.">
                <Table headers={['Relation', 'Name', 'Status']}>
                  {sheet.family.map((f, i) => (
                    <tr key={i} className={zebraRow}>
                      <Cell className="w-32">
                        {i < 2
                          ? <span className="text-[11px] font-bold uppercase tracking-wide font-serif" style={{ color: INK }}>{f.relation}</span>
                          : <Text editing={ed} value={f.relation} onChange={v => patchRow(['family'], i, 'relation', v)} placeholder="Other" />}
                      </Cell>
                      <Cell><Text editing={ed} value={f.name} onChange={v => patchRow(['family'], i, 'name', v)} placeholder="Insert name" /></Cell>
                      <Cell className="w-36"><Choice editing={ed} value={f.status} onChange={v => patchRow(['family'], i, 'status', v)} options={FAMILY_STATUS} /></Cell>
                    </tr>
                  ))}
                </Table>
              </Section>

              {/* 具 EQUIPMENT */}
              <Section kanji="具" title="Equipment">
                <SubHead note="(limit of 20 per tool)">Tools</SubHead>
                <Table headers={['Tool name', 'Amount']}>
                  {sheet.equipment.tools.map((t, i) => (
                    <tr key={i} className={zebraRow}>
                      <Cell><Text editing={ed} value={t.name} onChange={v => patchRow(['equipment', 'tools'], i, 'name', v)} /></Cell>
                      <Cell className="w-28"><Text editing={ed} value={t.amount} onChange={v => patchRow(['equipment', 'tools'], i, 'amount', v)} /></Cell>
                    </tr>
                  ))}
                </Table>

                <SubHead note={`(limit of ${LIMITS.scrolls}; content stacks of 20 each)`}>Scrolls</SubHead>
                <Table headers={['Scroll type / name', 'Contents']}>
                  {sheet.equipment.scrolls.map((s, i) => (
                    <tr key={i} className={zebraRow}>
                      <Cell className="w-1/3"><Text editing={ed} value={s.name} onChange={v => patchRow(['equipment', 'scrolls'], i, 'name', v)} /></Cell>
                      <Cell><Text editing={ed} value={s.contents} onChange={v => patchRow(['equipment', 'scrolls'], i, 'contents', v)} /></Cell>
                    </tr>
                  ))}
                </Table>

                <SubHead note="(limit of 2 each)">Special weapons &amp; items</SubHead>
                <div className="grid md:grid-cols-2 gap-x-6 gap-y-4">
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-wide font-serif mb-1" style={{ color: INK_MUTED }}>Special / custom weapons</p>
                    <Table headers={['Name', 'Link']} minWidth="15rem">
                      {sheet.equipment.special_weapons.map((w, i) => (
                        <tr key={i} className={zebraRow}>
                          <Cell><Text editing={ed} value={w.name} onChange={v => patchRow(['equipment', 'special_weapons'], i, 'name', v)} /></Cell>
                          <Cell className="w-24"><Link editing={ed} value={w.link} onChange={v => patchRow(['equipment', 'special_weapons'], i, 'link', v)} /></Cell>
                        </tr>
                      ))}
                    </Table>
                  </div>
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-wide font-serif mb-1" style={{ color: INK_MUTED }}>Special / custom tools</p>
                    <Table headers={['Name', 'Link']} minWidth="15rem">
                      {sheet.equipment.special_tools.map((w, i) => (
                        <tr key={i} className={zebraRow}>
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
              <Section kanji="力" title="Stats"
                       note={rankLimits ? `${sheet.personal.shinobi_rank} — ${rankLimits.stats}` : 'Check your rank’s starting limitations in the server systems and mechanics section.'}>
                {(anyStat || cu.total > 5) && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
                    <StatRadar data={statRadarData} accent={accent} />
                    <CUGauge cu={cu} accent={accent} />
                  </div>
                )}
                <Field label="Chakra level"><Choice editing={ed} value={sheet.stats.chakra_level} onChange={v => patch('stats', 'chakra_level', v)} options={STAT_RANKS} /></Field>
                <Field label="Chakra control"><Choice editing={ed} value={sheet.stats.chakra_control} onChange={v => patch('stats', 'chakra_control', v)} options={STAT_RANKS} /></Field>
                <Field label="Speed"><Choice editing={ed} value={sheet.stats.speed} onChange={v => patch('stats', 'speed', v)} options={STAT_RANKS} /></Field>
                <Field label="Strength"><Choice editing={ed} value={sheet.stats.strength} onChange={v => patch('stats', 'strength', v)} options={STAT_RANKS} /></Field>
                <Field label="Base chakra pool / unit" note="chakra level + control + 5">
                  <span className="font-serif font-black tabular-nums" style={{ color: INK }}>{cu.base} CU</span>
                </Field>
                <Field label="Extra CU" note="amount and from what">
                  {ed ? (
                    <div className="grid grid-cols-[5rem_1fr] gap-2">
                      <input value={sheet.stats.extra_cu || ''} onChange={e => patch('stats', 'extra_cu', e.target.value)}
                             placeholder="0" className={inputCls} style={inputStyle} />
                      <input value={sheet.stats.extra_cu_source || ''} onChange={e => patch('stats', 'extra_cu_source', e.target.value)}
                             placeholder="from what" className={inputCls} style={inputStyle} />
                    </div>
                  ) : (
                    (sheet.stats.extra_cu || sheet.stats.extra_cu_source)
                      ? <span style={{ color: INK }}>{sheet.stats.extra_cu || '0'}{sheet.stats.extra_cu_source ? ` — ${sheet.stats.extra_cu_source}` : ''}</span>
                      : <Dash />
                  )}
                </Field>
                <Field label="Total CU">
                  <span className="font-serif font-black tabular-nums text-base" style={{ color: INK }}>{cu.total} CU</span>
                </Field>
              </Section>

              {/* 技 SKILLS */}
              <Section kanji="技" title="Skills"
                       note={rankLimits ? `${sheet.personal.shinobi_rank} — ${rankLimits.skills}` : 'Check your rank’s starting limitations in the server systems and mechanics section.'}>
                {anySkill && <div className="mb-4"><SkillBarChart data={skillBarData} accent={accent} /></div>}
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
              <Section kanji="獣" title="Summon Information" note="A character cannot start with a contract.">
                <Field label="Summon contract"><Text editing={ed} value={sheet.summon.contract} onChange={v => patch('summon', 'contract', v)} placeholder="Put name here" /></Field>
                <Field label="Summon skill"><Choice editing={ed} value={sheet.summon.skill} onChange={v => patch('summon', 'skill', v)} options={SKILL_LEVELS} /></Field>
                <div className="mt-4">
                  <Table headers={['Summon level', 'Summon’s name', 'Link']}>
                    {sheet.summon.entries.map((s, i) => (
                      <tr key={i} className={zebraRow}>
                        <Cell className="w-36"><span className="text-[11px] font-bold uppercase tracking-wide font-serif" style={{ color: INK }}>{s.level}</span></Cell>
                        <Cell><Text editing={ed} value={s.name} onChange={v => patchRow(['summon', 'entries'], i, 'name', v)} /></Cell>
                        <Cell className="w-24"><Link editing={ed} value={s.link} onChange={v => patchRow(['summon', 'entries'], i, 'link', v)} /></Cell>
                      </tr>
                    ))}
                  </Table>
                </div>
              </Section>

              {/* 異 SPECIAL SKILLS */}
              <Section kanji="異" title="Special Skills">
                <Field label="Special"><Text editing={ed} value={sheet.special.special} onChange={v => patch('special', 'special', v)} /></Field>
                <Field label="Special ability"><Text editing={ed} value={sheet.special.ability} onChange={v => patch('special', 'ability', v)} /></Field>
                <Field label="Special skill level"><Choice editing={ed} value={sheet.special.level} onChange={v => patch('special', 'level', v)} options={SKILL_LEVELS} /></Field>
              </Section>

              {/* 限 LIMITED ABILITIES */}
              <Section kanji="限" title="Limited Abilities">
                <SubHead>Dojutsu</SubHead>
                <Field label="Dojutsu"><Text editing={ed} value={sheet.limited.dojutsu_name} onChange={v => patch('limited', 'dojutsu_name', v)} placeholder="Dojutsu name" /></Field>
                <Field label="Stage"><Text editing={ed} value={sheet.limited.dojutsu_stage} onChange={v => patch('limited', 'dojutsu_stage', v)} /></Field>
                <Field label="Dojutsu skill"><Choice editing={ed} value={sheet.limited.dojutsu_skill} onChange={v => patch('limited', 'dojutsu_skill', v)} options={SKILL_LEVELS} /></Field>

                <SubHead>Known chakra natures</SubHead>
                <p className="text-[11px] italic mb-2" style={{ color: INK_MUTED }}>The listed ranks are the starting limits per shinobi rank.</p>
                <Field label="Yin"><span className="text-[13px] italic" style={{ color: INK_MUTED }}>All characters know</span></Field>
                <Field label="Yang"><span className="text-[13px] italic" style={{ color: INK_MUTED }}>All characters know</span></Field>
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
              <Section kanji="術" title="Techniques"
                       note={`Every jutsu listed here must already exist in this database. ${rankLimits ? `${sheet.personal.shinobi_rank} — ${rankLimits.techniques}` : 'Check the SARP documentation for your allowed jutsu number and rank.'}`}>
                {anyJutsuRanked && <JutsuRankChart data={jutsuRankData} accent={accent} />}
                <Table headers={['Slot', 'Name', 'Rank', 'Nature', 'Approved?', 'Doc link']}>
                  {sheet.techniques.jutsu.map((j, i) => (
                    (ed ? i < jutsuRowsShown : !!j.name) ? (
                      <tr key={i} className={zebraRow}>
                        <Cell className="w-10"><span className="text-[10px] font-bold tabular-nums" style={{ color: INK_MUTED }}>{i + 1}</span></Cell>
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
                  <p className="text-xs italic py-2" style={{ color: INK_MUTED }}>No techniques listed yet</p>
                )}
                {ed && (
                  <p className="text-[10px] italic mt-1.5" style={{ color: INK_MUTED }}>
                    Showing {jutsuRowsShown} of {LIMITS.jutsuSlots} slots — more appear as you fill these in.
                  </p>
                )}

                <SubHead>PvE slots</SubHead>
                <Table headers={['Slot', 'Name', 'Rank', 'Nature', 'Approved?', 'Doc link']}>
                  {sheet.techniques.pve.map((j, i) => (
                    (ed || j.name) ? (
                      <tr key={i} className={zebraRow}>
                        <Cell className="w-14"><span className="text-[10px] font-bold" style={{ color: INK_MUTED }}>PvE {i + 1}</span></Cell>
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
                  <p className="text-xs italic py-2" style={{ color: INK_MUTED }}>No PvE techniques listed yet</p>
                )}
              </Section>

              {/* 基 ACADEMY JUTSUS + Battle modes */}
              <Section kanji="基" title="Academy Jutsus" note="Everyone has these.">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1">
                  {ACADEMY_JUTSUS.map(j => (
                    <div key={j} className="flex items-center gap-2 text-[13px]" style={{ color: INK }}>
                      <span style={{ color: HANKO }}>●</span> {j}
                    </div>
                  ))}
                </div>

                <SubHead>Battle mode list</SubHead>
                <Table headers={['Slot type', 'Name of battle mode / technique', 'Link']}>
                  {sheet.battle_modes.slots.map((b, i) => (
                    <tr key={i} className={zebraRow}>
                      <Cell className="w-40"><span className="text-[11px] font-bold uppercase tracking-wide font-serif" style={{ color: INK }}>{b.slot}</span></Cell>
                      <Cell><Text editing={ed} value={b.name} onChange={v => patchRow(['battle_modes', 'slots'], i, 'name', v)} /></Cell>
                      <Cell className="w-24"><Link editing={ed} value={b.link} onChange={v => patchRow(['battle_modes', 'slots'], i, 'link', v)} /></Cell>
                    </tr>
                  ))}
                </Table>

                <div className="mt-4">
                  <Field label="Awakening skill">
                    {ed ? (
                      <div className="grid grid-cols-[7rem_1fr] gap-2">
                        <div className="relative">
                          <select value={sheet.battle_modes.awakening_level || ''} onChange={e => patch('battle_modes', 'awakening_level', e.target.value)}
                                  className={inputCls + ' appearance-none pr-7 cursor-pointer'} style={inputStyle}>
                            <option value="">Select</option>
                            {SKILL_LEVELS.map(s => <option key={s} value={s}>{s}</option>)}
                          </select>
                          <ChevronDown size={13} className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: INK_MUTED }} />
                        </div>
                        <input type="url" value={sheet.battle_modes.awakening_link || ''} onChange={e => patch('battle_modes', 'awakening_link', e.target.value)}
                               placeholder="Hyperlink" className={inputCls} style={inputStyle} />
                      </div>
                    ) : (
                      sheet.battle_modes.awakening_level || sheet.battle_modes.awakening_link ? (
                        <span className="flex items-center gap-2">
                          <span style={{ color: INK }}>{sheet.battle_modes.awakening_level || '—'}</span>
                          {sheet.battle_modes.awakening_link && (
                            <a href={sheet.battle_modes.awakening_link} target="_blank" rel="noopener noreferrer"
                               className="inline-flex items-center gap-1 text-[12px] font-semibold underline underline-offset-2 hover:opacity-70 transition-opacity" style={{ color: LINK_COLOR }}>
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
                                 placeholder="Name of the technique" className={inputCls} style={inputStyle} />
                          <input type="url" value={a.link || ''} onChange={e => patchRow(['battle_modes', 'primary_abilities'], i, 'link', e.target.value)}
                                 placeholder="Hyperlink" className={inputCls} style={inputStyle} />
                        </div>
                      ) : (
                        a.name || a.link ? (
                          <span className="flex items-center gap-2">
                            <span style={{ color: INK }}>{a.name || '—'}</span>
                            {a.link && (
                              <a href={a.link} target="_blank" rel="noopener noreferrer"
                                 className="inline-flex items-center gap-1 text-[12px] font-semibold underline underline-offset-2 hover:opacity-70 transition-opacity" style={{ color: LINK_COLOR }}>
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
              <Section kanji="趣" title="Other Information" note="All non-mandatory.">
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
              <Section kanji="歆" title="Background" note="One full paragraph and one significant event for each ninja rank.">
                <Area editing={ed} value={sheet.background} onChange={v => setSheet(prev => ({ ...prev, background: v }))} rows={10} />
              </Section>

              {/* 画 IMAGES */}
              <Section kanji="画" title="Images">
                {ed ? (
                  <div className="space-y-2">
                    {sheet.images.map((url, i) => (
                      <div key={i} className="flex gap-2">
                        <input type="url" value={url} placeholder="https://…" className={inputCls + ' flex-1'} style={inputStyle}
                               onChange={e => setSheet(prev => ({ ...prev, images: prev.images.map((u, j) => j === i ? e.target.value : u) }))} />
                        <button type="button" onClick={() => setSheet(prev => ({ ...prev, images: prev.images.filter((_, j) => j !== i) }))}
                                className="px-2 transition-colors hover:opacity-70" style={{ color: HANKO }}>
                          <Trash2 size={13} />
                        </button>
                      </div>
                    ))}
                    {sheet.images.length < LIMITS.images && (
                      <button type="button" onClick={() => setSheet(prev => ({ ...prev, images: [...prev.images, ''] }))}
                              className="flex items-center gap-1 px-2.5 py-1 rounded-sm text-[9px] font-bold uppercase tracking-wider transition-all hover:brightness-110"
                              style={{ background: `${accent}14`, color: accent, border: `1px solid ${accent}55` }}>
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
                  <div className="rounded-sm py-8 text-center" style={{ border: `1px dashed ${HAIRLINE}` }}>
                    <p className="text-[11px] font-bold uppercase tracking-wide font-serif" style={{ color: INK_MUTED }}>
                      Space for character images
                    </p>
                  </div>
                )}
              </Section>

              {/* 僀 PUPPET CATALOGUE — Puppet Clan only */}
              {(ed || sheet.puppets.length > 0) && (
                <Section kanji="僀" title="Puppet Catalogue" note="Puppet Clan characters only.">
                  <Table headers={['Name', 'Class', 'Size', 'Attuned nature', 'Docs', '']}>
                    {sheet.puppets.map((p, i) => (
                      <tr key={i} className={zebraRow}>
                        <Cell><Text editing={ed} value={p.name} onChange={v => patchRow(['puppets'], i, 'name', v)} /></Cell>
                        <Cell className="w-24"><Text editing={ed} value={p.puppet_class} onChange={v => patchRow(['puppets'], i, 'puppet_class', v)} /></Cell>
                        <Cell className="w-24"><Text editing={ed} value={p.size} onChange={v => patchRow(['puppets'], i, 'size', v)} /></Cell>
                        <Cell className="w-28"><Choice editing={ed} value={p.nature} onChange={v => patchRow(['puppets'], i, 'nature', v)} options={SHEET_NATURES} placeholder="N/A" /></Cell>
                        <Cell className="w-20"><Link editing={ed} value={p.link} onChange={v => patchRow(['puppets'], i, 'link', v)} /></Cell>
                        <Cell className="w-8">
                          {ed && (
                            <button type="button" onClick={() => setSheet(prev => ({ ...prev, puppets: prev.puppets.filter((_, j) => j !== i) }))}
                                    className="transition-colors hover:opacity-70" style={{ color: HANKO }}>
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
                            className="mt-3 flex items-center gap-1 px-2.5 py-1 rounded-sm text-[9px] font-bold uppercase tracking-wider transition-all hover:brightness-110"
                            style={{ background: `${accent}14`, color: accent, border: `1px solid ${accent}55` }}>
                      <Plus size={10} /> Add puppet
                    </button>
                  )}
                </Section>
              )}

              {/* Footer */}
              <div className="flex items-center justify-between gap-3 pt-2" style={{ borderTop: `1px solid ${HAIRLINE}` }}>
                <p className="text-[10px] pt-3" style={{ color: INK_MUTED }}>
                  {row?.updated_at ? `Last updated ${new Date(row.updated_at).toLocaleString()}` : 'Not saved yet'}
                </p>
                {ed && canDelete && (
                  <button onClick={handleDelete} disabled={deleting}
                          className="mt-3 flex items-center gap-1.5 px-2.5 py-1 rounded-sm text-[9px] font-bold uppercase tracking-wider transition-colors hover:opacity-80 disabled:opacity-50"
                          style={{ color: HANKO, border: `1px solid ${HANKO}55` }}>
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
