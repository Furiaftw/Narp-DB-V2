import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  BookOpen, Users, ChevronRight, BarChart2, TrendingUp, AlertTriangle,
  CheckCircle, ArrowRight, Crown, Skull, Compass, Sword, Flame,
  Plus, Pencil, Trash2, X, Loader2, GripVertical,
} from 'lucide-react';
import {
  DndContext, closestCenter, PointerSensor, TouchSensor, useSensor, useSensors,
} from '@dnd-kit/core';
import {
  SortableContext, verticalListSortingStrategy, useSortable, arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  RadarChart, PolarGrid, PolarAngleAxis, Radar,
  PieChart, Pie, Cell, Legend,
} from 'recharts';
import { supabase } from '../lib/supabase';

// ─── STATIC CONFIG (never changes) ───────────────────────────────────────────

const VILLAGE_META = {
  konoha: { id: 'konoha', name: 'Konohagakure', color: 'emerald', kanji: '木' },
  kumo:   { id: 'kumo',   name: 'Kumogakure',   color: 'amber',   kanji: '雲' },
  kiri:   { id: 'kiri',   name: 'Kirigakure',   color: 'sky',     kanji: '霧' },
};

const SWORDS_LIST = [
  'Kubikiribōchō', 'Samehada', 'Nuibari',
  'Kabutowari', 'Shibuki', 'Kiba', 'Hiramekarei',
];

const TAILED_BEASTS = [
  { id: 'ichibi',      label: 'Ichibi',        sub: 'Shukaku',  tails: 1 },
  { id: 'nibi',        label: 'Nibi',          sub: 'Matatabi', tails: 2 },
  { id: 'sanbi',       label: 'Sanbi',         sub: 'Isobu',    tails: 3 },
  { id: 'yonbi',       label: 'Yonbi',         sub: 'Son Gokū', tails: 4 },
  { id: 'gobi',        label: 'Gobi',          sub: 'Kokuō',    tails: 5 },
  { id: 'rokubi',      label: 'Rokubi',        sub: 'Saiken',   tails: 6 },
  { id: 'nanabi',      label: 'Nanabi',        sub: 'Chōmei',   tails: 7 },
  { id: 'hachibi',     label: 'Hachibi',       sub: 'Gyūki',    tails: 8 },
  { id: 'kurama_yang', label: 'Kurama — Yang', sub: 'Kurama',   tails: 9 },
  { id: 'kurama_yin',  label: 'Kurama — Yin',  sub: 'Kurama',   tails: 9 },
];

const VILLAGE_NAMES = ['Konohagakure', 'Kumogakure', 'Kirigakure'];

// ─── THEME ────────────────────────────────────────────────────────────────────

const THEME = {
  emerald: { accent: '#10b981', accentFaint: 'rgba(16,185,129,0.08)', accentGlow: 'rgba(16,185,129,0.35)', accentBorder: 'rgba(16,185,129,0.25)', badgeBg: 'rgba(16,185,129,0.12)', badgeText: '#6ee7b7', tabActive: '#10b981', tabText: '#022c22' },
  amber:   { accent: '#f59e0b', accentFaint: 'rgba(245,158,11,0.08)', accentGlow: 'rgba(245,158,11,0.35)', accentBorder: 'rgba(245,158,11,0.25)', badgeBg: 'rgba(245,158,11,0.12)', badgeText: '#fcd34d', tabActive: '#f59e0b', tabText: '#1c0a00' },
  sky:     { accent: '#0ea5e9', accentFaint: 'rgba(14,165,233,0.08)', accentGlow: 'rgba(14,165,233,0.35)', accentBorder: 'rgba(14,165,233,0.25)', badgeBg: 'rgba(14,165,233,0.12)', badgeText: '#7dd3fc', tabActive: '#0ea5e9', tabText: '#0c1a20' },
};

const VILLAGE_COLORS  = { konoha: '#10b981', kumo: '#f59e0b', kiri: '#0ea5e9' };
const RANK_COLORS     = { jonin: '#fb923c', specialJonin: '#facc15', chunin: '#34d399', genin: '#38bdf8' };
const BEAST_COLORS    = { 1: '#facc15', 2: '#60a5fa', 3: '#34d399', 4: '#f97316', 5: '#c084fc', 6: '#67e8f9', 7: '#86efac', 8: '#f472b6', 9: '#fb923c' };

const ROGUE_ACCENT     = { accent: '#ef4444', accentFaint: 'rgba(239,68,68,0.07)',    accentGlow: 'rgba(239,68,68,0.3)',    accentBorder: 'rgba(239,68,68,0.22)',    tabActive: '#ef4444', tabText: '#1a0000' };
const WANDERER_ACCENT  = { accent: '#a78bfa', accentFaint: 'rgba(167,139,250,0.07)', accentGlow: 'rgba(167,139,250,0.3)', accentBorder: 'rgba(167,139,250,0.22)', tabActive: '#a78bfa', tabText: '#1a0a2e' };
const SWORDS_ACCENT    = { accent: '#38bdf8', accentFaint: 'rgba(56,189,248,0.07)',  accentGlow: 'rgba(56,189,248,0.3)',  accentBorder: 'rgba(56,189,248,0.22)',  tabActive: '#38bdf8', tabText: '#021a26' };
const JINCHURIKI_ACCENT = { accent: '#f97316', accentFaint: 'rgba(249,115,22,0.07)', accentGlow: 'rgba(249,115,22,0.3)', accentBorder: 'rgba(249,115,22,0.22)', tabActive: '#f97316', tabText: '#1a0800' };

// ─── HELPERS ──────────────────────────────────────────────────────────────────

function isAdmin(role) { return role === 'admin' || role === 'owner'; }
function isReviewer(role) { return role === 'staff'; }

// Double-approval: Reviewers (staff) insert rows with status 'pending';
// a DIFFERENT Reviewer or an Admin performs the second step (approve).
// Admins keep writing directly (rows default to 'approved').
function canModifyRow(perms, row) {
  return perms.admin || (perms.reviewer && row.status === 'pending' && row.created_by === perms.userId);
}
function canApproveRow(perms, row) {
  return row.status === 'pending' && (perms.admin || (perms.reviewer && row.created_by !== perms.userId));
}
async function approveRows(table, ids, userId) {
  const { error } = await supabase.from(table)
    .update({ status: 'approved', approved_by: userId })
    .in('id', ids);
  if (error) throw error;
}

function useSortSensors() {
  return useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor,   { activationConstraint: { delay: 250, tolerance: 5 } }),
  );
}

async function saveEntryOrder(ids) {
  await Promise.all(
    ids.map((id, i) => supabase.from('roster_entries').update({ sort_order: i }).eq('id', id))
  );
}

async function saveSquadMemberOrder(ids) {
  await Promise.all(
    ids.map((id, i) => supabase.from('roster_squads').update({ sort_order: i }).eq('id', id))
  );
}

function getCounts(entries, squads, villageId) {
  const ofType = (t) => entries.filter(e => e.roster_type === t).length;
  const jonin        = ofType(`${villageId}_jonin`);
  const specialJonin = ofType(`${villageId}_special_jonin`);
  const teachers     = jonin + specialJonin;
  const allSquads    = squads.filter(s => s.village === villageId);
  const chunin       = allSquads.filter(s => s.squad_type === 'chunin' && s.role === 'member').length;
  const genin        = allSquads.filter(s => s.squad_type === 'genin'  && s.role === 'genin').length;
  const total        = jonin + specialJonin + chunin + genin;

  const chuninNums   = [...new Set(allSquads.filter(s => s.squad_type === 'chunin').map(s => s.squad_number))];
  const geninNums    = [...new Set(allSquads.filter(s => s.squad_type === 'genin').map(s => s.squad_number))];
  const unteachedChunin = chuninNums.filter(n => !allSquads.find(s => s.squad_number === n && s.squad_type === 'chunin' && s.role === 'captain')).length;
  const unteachedGenin  = geninNums.filter(n => !allSquads.find(s => s.squad_number === n && s.squad_type === 'genin' && s.role === 'captain')).length;
  const geninPerTeacher  = teachers > 0 ? +(genin / teachers).toFixed(1) : 0;
  const assignedTeachers = allSquads.filter(s => s.squad_type === 'genin' && s.role === 'captain').length;
  const freeTeachers     = Math.max(0, teachers - assignedTeachers);

  return { jonin, specialJonin, teachers, chunin, genin, total, unteachedChunin, unteachedGenin, geninPerTeacher, assignedTeachers, freeTeachers };
}

// ─── SORTABLE ROW ─────────────────────────────────────────────────────────────

function SortableRow({ id, t, canEdit, children }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id });
  return (
    <div ref={setNodeRef} className="flex items-center"
         style={{ transform: CSS.Transform.toString(transform), transition,
                  opacity: isDragging ? 0.4 : 1, position: 'relative',
                  zIndex: isDragging ? 10 : 'auto' }}>
      {canEdit && (
        <button {...attributes} {...listeners}
          className="px-1.5 py-2 shrink-0 touch-none cursor-grab active:cursor-grabbing opacity-25 hover:opacity-60 transition-opacity"
          style={{ color: t.accent }}>
          <GripVertical size={11} />
        </button>
      )}
      <div className="flex-1 min-w-0">{children}</div>
    </div>
  );
}

// ─── MODAL ────────────────────────────────────────────────────────────────────
// Generic modal wrapper

function Modal({ title, onClose, children }) {
  return (
    <div className="fixed inset-0 z-50 overflow-y-auto p-4"
         style={{ background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)' }}>
      <div className="w-full max-w-md mx-auto rounded-sm shadow-2xl my-4"
           style={{ background: '#0f172a', border: '1px solid rgba(255,255,255,0.1)' }}>
        <div className="flex items-center justify-between px-5 py-4 sticky top-0 rounded-t-sm z-10"
             style={{ borderBottom: '1px solid rgba(255,255,255,0.07)', background: '#0f172a' }}>
          <p className="text-xs font-black uppercase tracking-[0.2em] text-slate-300">{title}</p>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-300 transition-colors">
            <X size={16} />
          </button>
        </div>
        <div className="px-5 py-4">{children}</div>
      </div>
    </div>
  );
}

// Reusable text input
function Field({ label, value, onChange, placeholder, type = 'text' }) {
  return (
    <div className="mb-3">
      <label className="block text-[10px] font-black uppercase tracking-[0.15em] text-slate-500 mb-1">{label}</label>
      <input
        type={type} value={value} onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-sm px-3 py-2 text-sm text-slate-200 outline-none focus:ring-1"
        style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', focusRingColor: '#38bdf8' }}
      />
    </div>
  );
}

// Multi-select pill toggle for village names
function VillageToggle({ label, selected, onChange }) {
  const toggle = (v) => onChange(selected.includes(v) ? selected.filter(x => x !== v) : [...selected, v]);
  return (
    <div className="mb-3">
      <label className="block text-[10px] font-black uppercase tracking-[0.15em] text-slate-500 mb-2">{label}</label>
      <div className="flex flex-wrap gap-1.5">
        {VILLAGE_NAMES.map(v => (
          <button key={v} type="button" onClick={() => toggle(v)}
            className="text-[9px] font-black uppercase tracking-wider px-2.5 py-1 rounded-sm transition-all"
            style={selected.includes(v)
              ? { background: '#38bdf8', color: '#021a26' }
              : { background: 'rgba(255,255,255,0.06)', color: '#64748b', border: '1px solid rgba(255,255,255,0.08)' }}>
            {v.replace('gakure', '')}
          </button>
        ))}
      </div>
    </div>
  );
}

function SaveBtn({ loading, onClick, label = 'Save' }) {
  return (
    <button onClick={onClick} disabled={loading}
      className="w-full mt-4 py-2.5 rounded-sm text-xs font-black uppercase tracking-[0.15em] transition-all flex items-center justify-center gap-2"
      style={{ background: '#38bdf8', color: '#021a26', opacity: loading ? 0.6 : 1 }}>
      {loading && <Loader2 size={13} className="animate-spin" />}
      {label}
    </button>
  );
}

// ─── ENTRY EDIT MODAL ─────────────────────────────────────────────────────────

function EntryModal({ rosterType, entry, userId, onClose, onSaved, initialSword = '', initialBeastId = '', asPending = false }) {
  const isEdit = !!entry;
  const meta   = entry?.meta || {};

  const [name, setName]               = useState(entry?.name || '');
  const [link, setLink]               = useState(entry?.discord_link || '');
  const [sword, setSword]             = useState(meta.sword || initialSword || '');
  const [beastId, setBeastId]         = useState(meta.beast_id || initialBeastId || '');
  const [wantedIn, setWantedIn]       = useState(meta.wanted_in || []);
  const [bringIn, setBringIn]         = useState(meta.bring_in || []);
  const [friendlyWith, setFriendly]   = useState(meta.friendly_with || []);
  const [hostileWith, setHostile]     = useState(meta.hostile_with || []);
  const [anbu, setAnbu]               = useState(meta?.anbu || false);
  const [loading, setLoading]         = useState(false);
  const [error, setError]             = useState('');

  const buildMeta = () => {
    if (rosterType === 'rogue')     return { wanted_in: wantedIn, bring_in: bringIn };
    if (rosterType === 'wanderer')  return { friendly_with: friendlyWith, hostile_with: hostileWith };
    if (rosterType === 'swordsmen') return { sword };
    if (rosterType === 'jinchuriki') return { beast_id: beastId };
    if (rosterType.endsWith('_jonin') || rosterType.endsWith('_special_jonin')) return { anbu };
    return {};
  };

  const handleSave = async () => {
    if (!name.trim()) { setError('Name is required.'); return; }
    setLoading(true); setError('');
    const payload = {
      roster_type: rosterType,
      name: name.trim(),
      discord_link: link.trim() || null,
      meta: buildMeta(),
      updated_by: userId,
    };
    if (!isEdit) {
      payload.created_by = userId;
      if (asPending) payload.status = 'pending';
    }

    const { error: err } = isEdit
      ? await supabase.from('roster_entries').update(payload).eq('id', entry.id)
      : await supabase.from('roster_entries').insert(payload);

    setLoading(false);
    if (err) { setError(err.message); return; }
    onSaved();
  };

  const modalTitle = isEdit ? `Edit — ${entry.name}` : 'Add Entry';

  return (
    <Modal title={modalTitle} onClose={onClose}>
      {asPending && !isEdit && (
        <p className="text-[10px] text-amber-400/90 mb-3 leading-relaxed rounded-sm px-2.5 py-2"
           style={{ background: 'rgba(251,191,36,0.08)', border: '1px solid rgba(251,191,36,0.2)' }}>
          This addition needs a second approval — another Reviewer or an Admin must approve it before it appears on the public roster.
        </p>
      )}
      <Field label="Character Name" value={name} onChange={setName} placeholder="OC Name" />
      <Field label="Discord Link" value={link} onChange={setLink} placeholder="https://discord.com/channels/..." />

      {(rosterType.endsWith('_jonin') || rosterType.endsWith('_special_jonin')) && (
        <div className="mb-3 flex items-center gap-2.5">
          <input type="checkbox" id="anbuChk" checked={anbu} onChange={e => setAnbu(e.target.checked)}
                 className="w-4 h-4 rounded" style={{ accentColor: '#38bdf8' }} />
          <label htmlFor="anbuChk" className="text-xs text-slate-400 cursor-pointer select-none">
            ANBU operative
          </label>
        </div>
      )}

      {rosterType === 'swordsmen' && (
        <div className="mb-3">
          <label className="block text-[10px] font-black uppercase tracking-[0.15em] text-slate-500 mb-2">Sword</label>
          <div className="flex flex-wrap gap-1.5">
            {SWORDS_LIST.map(s => (
              <button key={s} type="button" onClick={() => setSword(s)}
                className="text-[9px] font-black uppercase tracking-wider px-2.5 py-1 rounded-sm transition-all"
                style={sword === s
                  ? { background: SWORDS_ACCENT.tabActive, color: SWORDS_ACCENT.tabText }
                  : { background: 'rgba(255,255,255,0.06)', color: '#64748b', border: '1px solid rgba(255,255,255,0.08)' }}>
                {s}
              </button>
            ))}
          </div>
        </div>
      )}

      {rosterType === 'jinchuriki' && (
        <div className="mb-3">
          <label className="block text-[10px] font-black uppercase tracking-[0.15em] text-slate-500 mb-2">Tailed Beast</label>
          <div className="flex flex-wrap gap-1.5">
            {TAILED_BEASTS.map(b => (
              <button key={b.id} type="button" onClick={() => setBeastId(b.id)}
                className="text-[9px] font-black uppercase tracking-wider px-2.5 py-1 rounded-sm transition-all"
                style={beastId === b.id
                  ? { background: JINCHURIKI_ACCENT.tabActive, color: JINCHURIKI_ACCENT.tabText }
                  : { background: 'rgba(255,255,255,0.06)', color: '#64748b', border: '1px solid rgba(255,255,255,0.08)' }}>
                {b.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {rosterType === 'rogue' && (
        <>
          <VillageToggle label="Wanted In" selected={wantedIn} onChange={setWantedIn} />
          <VillageToggle label="Bring In" selected={bringIn} onChange={setBringIn} />
        </>
      )}

      {rosterType === 'wanderer' && (
        <>
          <VillageToggle label="Friendly With" selected={friendlyWith} onChange={setFriendly} />
          <VillageToggle label="Hostile With" selected={hostileWith} onChange={setHostile} />
        </>
      )}

      {error && <p className="text-xs text-red-400 mt-2">{error}</p>}
      <SaveBtn loading={loading} onClick={handleSave} />
    </Modal>
  );
}

// ─── CREATE SQUAD MODAL ───────────────────────────────────────────────────────
// Single-step squad creation: number + optional captain + member slots

function CreateSquadModal({ village, squadType, suggestedNumber, entries, squads, userId, onSaved, onClose, asPending = false }) {
  const [numStr, setNumStr]           = useState(String(suggestedNumber));
  const [captainName, setCaptainName] = useState('');
  const [captainLink, setCaptainLink] = useState('');
  const [skipCaptain, setSkipCaptain] = useState(false);
  const [members, setMembers]         = useState([
    { name: '', link: '', partTime: false },
    { name: '', link: '', partTime: false },
    { name: '', link: '', partTime: false },
  ]);
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState('');

  const assignedCaptainNames = new Set(
    squads.filter(s => s.village === village && s.squad_type === 'genin' && s.role === 'captain').map(s => s.name)
  );
  const availableMentors = squadType === 'genin'
    ? entries
        .filter(e => (e.roster_type === `${village}_jonin` || e.roster_type === `${village}_special_jonin`)
                     && !assignedCaptainNames.has(e.name))
        .map(e => ({ name: e.name, discord_link: e.discord_link,
                     rank: e.roster_type.includes('special') ? 'Spec. Jonin' : 'Jonin' }))
    : [];

  const updateMember = (i, field, value) =>
    setMembers(prev => prev.map((m, idx) => idx === i ? { ...m, [field]: value } : m));

  const addSlot = () => setMembers(prev => [...prev, { name: '', link: '', partTime: true }]);

  const handleCreate = async () => {
    const finalNum = parseInt(numStr, 10) > 0 ? parseInt(numStr, 10) : suggestedNumber;
    const rows = [];

    if (!skipCaptain && captainName.trim()) {
      rows.push({ village, squad_type: squadType, squad_number: finalNum, role: 'captain',
                  name: captainName.trim(), discord_link: captainLink.trim() || null,
                  created_by: userId, updated_by: userId });
    } else {
      rows.push({ village, squad_type: squadType, squad_number: finalNum, role: 'sentinel',
                  name: '', created_by: userId, updated_by: userId });
    }

    members.forEach((m, i) => {
      if (!m.name.trim()) return;
      const role = (i < 3 && !m.partTime) ? (squadType === 'chunin' ? 'member' : 'genin') : 'part_time';
      rows.push({ village, squad_type: squadType, squad_number: finalNum, role,
                  name: m.name.trim(), discord_link: m.link.trim() || null,
                  created_by: userId, updated_by: userId });
    });

    setSaving(true);
    const finalRows = asPending ? rows.map(r => ({ ...r, status: 'pending' })) : rows;
    const { error: err } = await supabase.from('roster_squads').insert(finalRows);
    setSaving(false);
    if (err) { console.error(err); setError(err.message); return; }
    onSaved();
  };

  const memberLabel = squadType === 'chunin' ? 'Chunin' : 'Genin';

  return (
    <Modal title={`New ${memberLabel} Squad`} onClose={onClose}>
      {asPending && (
        <p className="text-[10px] text-amber-400/90 mb-3 leading-relaxed rounded-sm px-2.5 py-2"
           style={{ background: 'rgba(251,191,36,0.08)', border: '1px solid rgba(251,191,36,0.2)' }}>
          This squad needs a second approval — another Reviewer or an Admin must approve it before it appears on the public roster.
        </p>
      )}
      <Field label={`Squad Number (default: ${suggestedNumber})`} value={numStr} onChange={setNumStr}
             type="number" placeholder={String(suggestedNumber)} />

      {/* Captain section */}
      <div className="mb-4">
        <div className="flex items-center justify-between mb-2">
          <label className="text-[10px] font-black uppercase tracking-[0.15em] text-slate-500">
            Captain{skipCaptain ? ' (skip)' : ''}
          </label>
          <button type="button" onClick={() => setSkipCaptain(s => !s)}
            className="text-[9px] font-black uppercase tracking-wider px-2 py-0.5 rounded-sm transition-all"
            style={skipCaptain
              ? { background: 'rgba(251,146,60,0.15)', color: '#fb923c' }
              : { background: 'rgba(255,255,255,0.06)', color: '#64748b', border: '1px solid rgba(255,255,255,0.08)' }}>
            {skipCaptain ? 'Add Later' : 'Skip'}
          </button>
        </div>
        {!skipCaptain && (
          <>
            {availableMentors.length > 0 && (
              <div className="mb-3">
                <label className="block text-[10px] font-black uppercase tracking-[0.15em] text-slate-500 mb-1.5">Available Mentors</label>
                <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto pb-1">
                  {availableMentors.map(m => (
                    <button key={m.name} type="button"
                      onClick={() => { setCaptainName(m.name); setCaptainLink(m.discord_link || ''); }}
                      className="text-[9px] font-black uppercase tracking-wider px-2.5 py-1 rounded-sm transition-all"
                      style={captainName === m.name
                        ? { background: '#38bdf8', color: '#021a26' }
                        : { background: 'rgba(255,255,255,0.06)', color: '#64748b', border: '1px solid rgba(255,255,255,0.08)' }}>
                      {m.name} · {m.rank}
                    </button>
                  ))}
                </div>
                <p className="text-[9px] italic text-slate-600 mt-1.5">Or enter manually ↓</p>
              </div>
            )}
            <Field label="Captain Name" value={captainName} onChange={setCaptainName} placeholder="OC Name" />
            <Field label="Captain Discord Link" value={captainLink} onChange={setCaptainLink} placeholder="https://discord.com/channels/..." />
          </>
        )}
      </div>

      {/* Member slots */}
      <div className="mb-2">
        <label className="block text-[10px] font-black uppercase tracking-[0.15em] text-slate-500 mb-2">Members</label>
        {members.map((m, i) => (
          <div key={i} className="mb-2 rounded-sm p-2.5" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[9px] font-black uppercase tracking-wider text-slate-500">{memberLabel} {i + 1}</span>
              <div className="flex items-center gap-1.5">
                <input type="checkbox" id={`ptBulk-${i}`} checked={m.partTime}
                  onChange={e => updateMember(i, 'partTime', e.target.checked)}
                  className="w-3.5 h-3.5 rounded" style={{ accentColor: '#38bdf8' }} />
                <label htmlFor={`ptBulk-${i}`} className="text-[9px] text-slate-500 cursor-pointer select-none">Part-time</label>
              </div>
            </div>
            <input value={m.name} onChange={e => updateMember(i, 'name', e.target.value)}
              placeholder="Name (optional)"
              className="w-full rounded-sm px-2.5 py-1.5 text-xs text-slate-200 outline-none mb-1.5"
              style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)' }} />
            <input value={m.link} onChange={e => updateMember(i, 'link', e.target.value)}
              placeholder="Discord link (optional)"
              className="w-full rounded-sm px-2.5 py-1.5 text-xs text-slate-200 outline-none"
              style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)' }} />
          </div>
        ))}
        <button type="button" onClick={addSlot}
          className="flex items-center gap-1 px-2.5 py-1 rounded-sm text-[9px] font-black uppercase tracking-wider w-full justify-center transition-all mt-1"
          style={{ background: 'rgba(255,255,255,0.03)', color: '#475569', border: '1px dashed rgba(255,255,255,0.08)' }}>
          <Plus size={9} /> Add Slot (Part-time)
        </button>
      </div>

      {error && <p className="text-xs text-red-400 mt-2">{error}</p>}
      <SaveBtn loading={saving} onClick={handleCreate} label="Create Squad" />
    </Modal>
  );
}

// ─── SQUAD MEMBER MODAL ───────────────────────────────────────────────────────

function SquadMemberModal({ village, squadType, squadNumber, role: rawRole, member, userId, onClose, onSaved, availableMentors = [], asPending = false }) {
  const isEdit = !!member;

  // Normalise: 'part_time' stored in DB is treated as the squad's base role + partTime flag
  const isPartTimeRole   = rawRole === 'part_time';
  const baseRole         = isPartTimeRole ? (squadType === 'chunin' ? 'member' : 'genin') : rawRole;
  const isPartTimeMember = isPartTimeRole || member?.role === 'part_time';

  const [name, setName]       = useState(member?.name || '');
  const [link, setLink]       = useState(member?.discord_link || '');
  const [partTime, setPartTime] = useState(isPartTimeMember);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState('');

  const handleSave = async () => {
    if (!name.trim()) { setError('Name is required.'); return; }
    setLoading(true); setError('');
    const finalRole = (baseRole !== 'captain' && partTime) ? 'part_time' : baseRole;
    const payload = {
      village, squad_type: squadType, squad_number: squadNumber, role: finalRole,
      name: name.trim(), discord_link: link.trim() || null,
      updated_by: userId,
    };
    if (!isEdit) {
      payload.created_by = userId;
      if (asPending) payload.status = 'pending';
    }

    const { error: err } = isEdit
      ? await supabase.from('roster_squads').update(payload).eq('id', member.id)
      : await supabase.from('roster_squads').insert(payload);

    setLoading(false);
    if (err) { console.error('[roster] squad save error:', err); setError(err.message); return; }
    onSaved();
  };

  const roleLabel = baseRole === 'captain' ? 'Captain' : baseRole === 'member' ? 'Chunin Member' : 'Genin';
  return (
    <Modal title={`${isEdit ? 'Edit' : 'Add'} ${roleLabel} — Squad ${squadNumber}`} onClose={onClose}>
      {asPending && !isEdit && (
        <p className="text-[10px] text-amber-400/90 mb-3 leading-relaxed rounded-sm px-2.5 py-2"
           style={{ background: 'rgba(251,191,36,0.08)', border: '1px solid rgba(251,191,36,0.2)' }}>
          This addition needs a second approval — another Reviewer or an Admin must approve it before it appears on the public roster.
        </p>
      )}
      {baseRole === 'captain' && squadType === 'genin' && availableMentors.length > 0 && (
        <div className="mb-4">
          <label className="block text-[10px] font-black uppercase tracking-[0.15em] text-slate-500 mb-1.5">Available Mentors</label>
          <div className="flex flex-wrap gap-1.5 max-h-28 overflow-y-auto pb-1">
            {availableMentors.map(m => (
              <button key={m.name} type="button"
                onClick={() => { setName(m.name); setLink(m.discord_link || ''); }}
                style={name === m.name ? { background: '#38bdf8', color: '#021a26' } : { background: 'rgba(255,255,255,0.06)', color: '#64748b', border: '1px solid rgba(255,255,255,0.08)' }}
                className="text-[9px] font-black uppercase tracking-wider px-2.5 py-1 rounded-sm transition-all">
                {m.name} · {m.rank}
              </button>
            ))}
          </div>
          <p className="text-[9px] italic text-slate-600 mt-1.5">Or enter manually ↓</p>
        </div>
      )}
      <Field label="Character Name" value={name} onChange={setName} placeholder="OC Name" />
      <Field label="Discord Link" value={link} onChange={setLink} placeholder="https://discord.com/channels/..." />
      {baseRole !== 'captain' && (
        <div className="mb-3 flex items-center gap-2.5">
          <input
            type="checkbox" id={`ptChk-${squadNumber}`}
            checked={partTime}
            onChange={e => setPartTime(e.target.checked)}
            className="w-4 h-4 rounded"
            style={{ accentColor: '#38bdf8' }}
          />
          <label htmlFor={`ptChk-${squadNumber}`} className="text-xs text-slate-400 cursor-pointer select-none">
            Part-time member
          </label>
        </div>
      )}
      {error && <p className="text-xs text-red-400 mt-2">{error}</p>}
      <SaveBtn loading={loading} onClick={handleSave} />
    </Modal>
  );
}

// ─── SHARED DISPLAY PRIMITIVES ────────────────────────────────────────────────

const PendingBadge = () => (
  <span className="text-[8px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded-sm shrink-0"
        style={{ background: 'rgba(251,191,36,0.12)', color: '#fbbf24', border: '1px solid rgba(251,191,36,0.3)' }}>
    Pending
  </span>
);

const AdminBtn = ({ icon: IconComp, onClick, color = '#64748b', title, loading = false }) => (
  <button onClick={onClick} title={title} disabled={loading}
    className="p-1 rounded-sm transition-colors hover:opacity-100 opacity-40 hover:opacity-80 disabled:cursor-wait"
    style={{ color }}>
    {loading ? <Loader2 size={12} className="animate-spin" style={{ color }} /> : <IconComp size={12} />}
  </button>
);

const Person = ({ name, link, t, canEdit, onEdit, onDelete, meta, deleteLoading = false, pending = false, onApprove = null, approveLoading = false }) => {
  const nameEl = link
    ? <a href={link} target="_blank" rel="noopener noreferrer"
         style={{ color: t.accent }}
         className="text-sm font-semibold tracking-wide truncate hover:brightness-125 transition-all underline-offset-2 hover:underline">
        {name}
      </a>
    : <span className="text-sm font-semibold tracking-wide truncate text-slate-200">{name}</span>;
  return (
    <div className="flex items-center justify-between py-2 px-3 border-b border-white/5 group transition-colors"
         onMouseEnter={e => e.currentTarget.style.background = t.accentFaint}
         onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
      <div className="flex items-center gap-2 min-w-0">
        <ChevronRight size={12} strokeWidth={3} style={{ color: t.accent, opacity: 0.6, flexShrink: 0 }} />
        {nameEl}
        {meta?.anbu && (
          <span className="text-[8px] font-black tracking-widest px-1.5 py-0.5 rounded-sm shrink-0"
                style={{ background: 'rgba(15,23,42,0.9)', color: '#94a3b8', border: '1px solid rgba(148,163,184,0.2)' }}>
            ANBU
          </span>
        )}
        {pending && <PendingBadge />}
      </div>
      {(canEdit || onApprove) && (
        <div className="flex gap-1 shrink-0 ml-2">
          {onApprove && <AdminBtn icon={CheckCircle} onClick={onApprove} color="#34d399" title="Approve" loading={approveLoading} />}
          {canEdit && (
            <>
              <AdminBtn icon={Pencil} onClick={onEdit} title="Edit" />
              <AdminBtn icon={Trash2} onClick={onDelete} color="#f87171" title={pending ? 'Reject / Remove' : 'Remove'} loading={deleteLoading} />
            </>
          )}
        </div>
      )}
    </div>
  );
};

const SectionHeader = ({ icon: Icon, title, t, canEdit, onAdd }) => (
  <div className="flex items-center gap-3 mb-5">
    <div className="flex items-center justify-center w-7 h-7 rounded-sm"
         style={{ background: t.accentFaint, border: `1px solid ${t.accentBorder}` }}>
      <Icon size={14} style={{ color: t.accent }} />
    </div>
    <h2 className="text-xs font-black uppercase tracking-[0.2em] text-slate-300">{title}</h2>
    <div className="flex-1 h-px" style={{ background: `linear-gradient(to right, ${t.accentBorder}, transparent)` }} />
    {canEdit && (
      <button onClick={onAdd}
        className="flex items-center gap-1 px-2.5 py-1 rounded-sm text-[9px] font-black uppercase tracking-wider transition-all hover:brightness-110"
        style={{ background: t.accentFaint, color: t.accent, border: `1px solid ${t.accentBorder}` }}>
        <Plus size={10} /> Add
      </button>
    )}
  </div>
);

const SubLabel = ({ children, t, canEdit, onAdd }) => (
  <div className="flex items-center justify-between mt-5 mb-1 px-1">
    <p className="text-[10px] font-black uppercase tracking-[0.2em]" style={{ color: t.accent, opacity: 0.55 }}>{children}</p>
    {canEdit && (
      <button onClick={onAdd}
        className="flex items-center gap-1 px-2 py-0.5 rounded-sm text-[9px] font-black uppercase tracking-wider transition-all hover:brightness-110"
        style={{ background: t.accentFaint, color: t.accent, border: `1px solid ${t.accentBorder}` }}>
        <Plus size={9} /> Add
      </button>
    )}
  </div>
);

const EmptyNote = () => <p className="text-xs text-slate-600 italic px-3 py-2">None yet</p>;

const Block = ({ children, t }) => (
  <div className="rounded-sm p-4 md:p-5 mb-4"
       style={{ background: 'rgba(15,23,42,0.7)', border: '1px solid rgba(255,255,255,0.05)', borderLeft: `3px solid ${t.accent}` }}>
    {children}
  </div>
);

const PillList = ({ items, color }) => {
  if (!items || items.length === 0) return <span className="text-xs text-slate-600 italic">—</span>;
  return (
    <div className="flex flex-wrap gap-1.5 mt-1">
      {items.map((v, i) => (
        <span key={i} className="text-[9px] font-black uppercase tracking-wider px-2 py-0.5 rounded-sm"
              style={{ background: `${color}18`, color }}>
          {v.replace('gakure', '')}
        </span>
      ))}
    </div>
  );
};

const SlotTracker = ({ filled, cap, accent }) => (
  <div className="flex items-center gap-3 mb-5 px-1">
    <p className="text-[10px] font-black uppercase tracking-[0.15em] text-slate-500">Slots filled</p>
    <div className="flex gap-1">
      {Array.from({ length: cap }).map((_, i) => (
        <div key={i} className="w-4 h-1.5 rounded-full"
             style={{ background: i < filled ? accent : 'rgba(255,255,255,0.08)' }} />
      ))}
    </div>
    <span className="text-[10px] font-black" style={{ color: accent }}>{filled} / {cap}</span>
  </div>
);

// ─── MEMBER ROW (used inside SquadCard) ──────────────────────────────────────

const MemberRow = ({ m, t, canEdit, onEdit, onDelete, deleteLoading = false, onApprove = null, approveLoading = false }) => (
  <div className="flex items-center justify-between py-2 px-3 border-b border-white/5 group"
       onMouseEnter={e => e.currentTarget.style.background = t.accentFaint}
       onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
    <div className="flex items-center gap-2 min-w-0">
      <ChevronRight size={12} strokeWidth={3} style={{ color: t.accent, opacity: 0.6, flexShrink: 0 }} />
      {m.discord_link
        ? <a href={m.discord_link} target="_blank" rel="noopener noreferrer"
             style={{ color: t.accent }}
             className="text-sm font-semibold tracking-wide truncate hover:brightness-125 transition-all underline-offset-2 hover:underline">
            {m.name}
          </a>
        : <span className="text-sm font-semibold text-slate-200 tracking-wide truncate">{m.name}</span>
      }
    </div>
    <div className="flex items-center gap-1 shrink-0 ml-2">
      {m.role === 'part_time' && (
        <span className="text-[8px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded-sm"
              style={{ background: 'rgba(148,163,184,0.12)', color: '#94a3b8' }}>
          Part Time
        </span>
      )}
      {m.status === 'pending' && <PendingBadge />}
      {onApprove && <AdminBtn icon={CheckCircle} onClick={onApprove} color="#34d399" title="Approve" loading={approveLoading} />}
      {canEdit && (
        <>
          <AdminBtn icon={Pencil} onClick={onEdit} title="Edit" />
          <AdminBtn icon={Trash2} onClick={onDelete} color="#f87171" title={m.status === 'pending' ? 'Reject / Remove' : 'Remove'} loading={deleteLoading} />
        </>
      )}
    </div>
  </div>
);

// ─── SQUAD CARD ───────────────────────────────────────────────────────────────

function SquadCard({ village, squadType, squadNumber, rows, t, perms, onRefresh, entries = [], squads = [] }) {
  const [modal, setModal]           = useState(null); // { role } or { role, member }
  const [editingNum, setEditingNum] = useState(false);

  const canEdit = perms.admin;                 // squad-level ops (renumber, delete squad, reorder)
  const canAdd  = perms.admin || perms.reviewer;
  const [approvingId, setApprovingId] = useState(null);
  const [approvingSquad, setApprovingSquad] = useState(false);
  const approvableIds = rows.filter(r => canApproveRow(perms, r)).map(r => r.id);

  const handleApprove = async (ids) => {
    if (ids.length > 1) setApprovingSquad(true); else setApprovingId(ids[0]);
    try {
      await approveRows('roster_squads', ids, perms.userId);
      onRefresh();
    } catch (e) {
      alert('Approve failed: ' + (e.message || e));
    } finally {
      setApprovingSquad(false);
      setApprovingId(null);
    }
  };

  const captain = rows.find(r => r.role === 'captain');
  const members = rows.filter(r => r.role !== 'captain' && r.role !== 'sentinel');

  const [orderedMembers, setOrderedMembers] = useState(members);
  useEffect(() => setOrderedMembers(members), [rows]); // eslint-disable-line react-hooks/exhaustive-deps
  const memberSensors = useSortSensors();

  const handleMemberDragEnd = ({ active, over }) => {
    if (!over || active.id === over.id) return;
    const oldIndex = orderedMembers.findIndex(m => m.id === active.id);
    const newIndex = orderedMembers.findIndex(m => m.id === over.id);
    const next = arrayMove(orderedMembers, oldIndex, newIndex);
    setOrderedMembers(next);
    saveSquadMemberOrder(next.map(m => m.id));
  };

  const assignedCaptainNames = new Set(
    squads.filter(s => s.village === village && s.squad_type === 'genin' && s.role === 'captain').map(s => s.name)
  );
  const availableMentors = squadType === 'genin'
    ? entries
        .filter(e => (e.roster_type === `${village}_jonin` || e.roster_type === `${village}_special_jonin`)
                     && !assignedCaptainNames.has(e.name))
        .map(e => ({ name: e.name, discord_link: e.discord_link,
                     rank: e.roster_type.includes('special') ? 'Spec. Jonin' : 'Jonin' }))
    : [];

  const [deletingMemberId, setDeletingMemberId] = useState(null);
  const [deletingSquad, setDeletingSquad] = useState(false);
  const [renumbering, setRenumbering] = useState(false);

  const handleDelete = async (id) => {
    if (!window.confirm('Remove this entry?')) return;
    setDeletingMemberId(id);
    try {
      await supabase.from('roster_squads').delete().eq('id', id);
      onRefresh();
    } finally {
      setDeletingMemberId(null);
    }
  };

  const handleRenumber = async (newNum) => {
    if (newNum === squadNumber || !newNum || newNum < 1) return;
    setRenumbering(true);
    try {
      await supabase.from('roster_squads')
        .update({ squad_number: newNum })
        .eq('village', village).eq('squad_type', squadType).eq('squad_number', squadNumber);
      onRefresh();
    } finally {
      setRenumbering(false);
    }
  };

  const handleDeleteSquad = async () => {
    if (!window.confirm(`Delete Squad ${squadNumber} and all its members?`)) return;
    setDeletingSquad(true);
    try {
      await supabase.from('roster_squads')
        .delete()
        .eq('village', village).eq('squad_type', squadType).eq('squad_number', squadNumber);
      onRefresh();
    } finally {
      setDeletingSquad(false);
    }
  };

  return (
    <>
      <div className="rounded-sm p-3"
           style={{ background: 'rgba(15,23,42,0.5)', border: '1px solid rgba(255,255,255,0.04)', borderLeft: `2px solid ${!captain ? 'rgba(251,146,60,0.5)' : t.accentBorder}` }}>
        <div className="flex items-center justify-between mb-2">
          {editingNum ? (
            <input
              type="number"
              defaultValue={squadNumber}
              autoFocus
              onBlur={e => { handleRenumber(parseInt(e.target.value, 10) || squadNumber); setEditingNum(false); }}
              onKeyDown={e => { if (e.key === 'Enter') e.target.blur(); if (e.key === 'Escape') setEditingNum(false); }}
              className="w-16 text-[9px] font-black uppercase bg-transparent outline-none border-b"
              style={{ color: t.accent, borderColor: t.accent }}
            />
          ) : (
            <span className="text-[9px] font-black uppercase tracking-[0.2em] flex items-center gap-1"
                  style={{ color: t.accent, opacity: 0.6, cursor: canEdit && !renumbering ? 'pointer' : 'default' }}
                  onClick={() => canEdit && !renumbering && setEditingNum(true)}>
              Squad {squadNumber}
              {canEdit && (renumbering ? <Loader2 size={8} className="inline animate-spin" /> : <Pencil size={8} className="inline opacity-40" />)}
            </span>
          )}
          <div className="flex items-center gap-1.5">
            {rows.some(r => r.status === 'pending') && <PendingBadge />}
            {approvableIds.length > 1 && (
              <button onClick={() => handleApprove(approvableIds)} disabled={approvingSquad}
                className="flex items-center gap-1 px-2 py-0.5 rounded-sm text-[8px] font-black uppercase tracking-wider transition-all hover:brightness-110 disabled:cursor-wait"
                style={{ background: 'rgba(52,211,153,0.12)', color: '#34d399', border: '1px solid rgba(52,211,153,0.25)' }}>
                {approvingSquad ? <Loader2 size={8} className="animate-spin" /> : <CheckCircle size={8} />} Approve All
              </button>
            )}
            {canEdit && (
              <AdminBtn icon={Trash2} onClick={handleDeleteSquad} color="#f87171" title="Delete squad" loading={deletingSquad} />
            )}
          </div>
        </div>

        {captain && (
          <div className="flex items-center justify-between py-2 px-3 border-b border-white/5 group"
               onMouseEnter={e => e.currentTarget.style.background = t.accentFaint}
               onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
            <div className="flex items-center gap-2 min-w-0">
              <ChevronRight size={12} strokeWidth={3} style={{ color: t.accent, opacity: 0.6, flexShrink: 0 }} />
              <div className="flex flex-col min-w-0">
                {captain.discord_link
                  ? <a href={captain.discord_link} target="_blank" rel="noopener noreferrer"
                       style={{ color: t.accent }}
                       className="text-sm font-semibold tracking-wide truncate hover:brightness-125 transition-all underline-offset-2 hover:underline">
                      {captain.name}
                    </a>
                  : <span className="text-sm font-semibold text-slate-200 tracking-wide truncate">{captain.name}</span>
                }
                <span className="text-[8px] font-black uppercase tracking-[0.15em]"
                      style={{ color: t.accent, opacity: 0.55 }}>Captain</span>
              </div>
            </div>
            <div className="flex items-center gap-1 shrink-0 ml-2">
              {captain.status === 'pending' && <PendingBadge />}
              {canApproveRow(perms, captain) && (
                <AdminBtn icon={CheckCircle} onClick={() => handleApprove([captain.id])} color="#34d399" title="Approve" loading={approvingId === captain.id} />
              )}
              {(canModifyRow(perms, captain) || canApproveRow(perms, captain)) && (
                <>
                  <AdminBtn icon={Pencil} onClick={() => setModal({ role: 'captain', member: captain })} title="Edit" />
                  <AdminBtn icon={Trash2} onClick={() => handleDelete(captain.id)} color="#f87171" title={captain.status === 'pending' ? 'Reject / Remove' : 'Remove'} loading={deletingMemberId === captain.id} />
                </>
              )}
            </div>
          </div>
        )}

        {!captain && (
          <div className="flex items-center justify-between py-2 px-3 border-b border-white/5">
            <p className="text-[10px] font-black uppercase tracking-wider animate-pulse"
               style={{ color: 'rgba(251,146,60,0.8)' }}>
              Looking for Captain
            </p>
            {canAdd && (
              <button onClick={() => setModal({ role: 'captain' })}
                className="flex items-center gap-1 px-1.5 py-0.5 rounded-sm text-[8px] font-black uppercase tracking-wider"
                style={{ background: 'rgba(251,146,60,0.12)', color: '#fb923c', border: '1px solid rgba(251,146,60,0.25)' }}>
                <Plus size={8} /> Add Captain
              </button>
            )}
          </div>
        )}

        {canEdit && orderedMembers.length > 1
          ? <DndContext sensors={memberSensors} collisionDetection={closestCenter} onDragEnd={handleMemberDragEnd}>
              <SortableContext items={orderedMembers.map(m => m.id)} strategy={verticalListSortingStrategy}>
                {orderedMembers.map(m => (
                  <SortableRow key={m.id} id={m.id} t={t} canEdit={canEdit}>
                    <MemberRow m={m} t={t} canEdit={canModifyRow(perms, m) || canApproveRow(perms, m)}
                      onEdit={() => setModal({ role: m.role, member: m })}
                      onDelete={() => handleDelete(m.id)} deleteLoading={deletingMemberId === m.id}
                      onApprove={canApproveRow(perms, m) ? () => handleApprove([m.id]) : null}
                      approveLoading={approvingId === m.id} />
                  </SortableRow>
                ))}
              </SortableContext>
            </DndContext>
          : orderedMembers.map(m => (
              <MemberRow key={m.id} m={m} t={t} canEdit={canModifyRow(perms, m) || canApproveRow(perms, m)}
                onEdit={() => setModal({ role: m.role, member: m })}
                onDelete={() => handleDelete(m.id)} deleteLoading={deletingMemberId === m.id}
                onApprove={canApproveRow(perms, m) ? () => handleApprove([m.id]) : null}
                approveLoading={approvingId === m.id} />
            ))
        }

        {canAdd && (
          <button onClick={() => setModal({ role: squadType === 'chunin' ? 'member' : 'genin' })}
            className="flex items-center gap-1 mt-2 px-2 py-1 rounded-sm text-[9px] font-black uppercase tracking-wider w-full justify-center transition-all hover:brightness-110"
            style={{ background: 'rgba(255,255,255,0.03)', color: '#475569', border: '1px dashed rgba(255,255,255,0.08)' }}>
            <Plus size={9} /> Add {squadType === 'chunin' ? 'Chunin' : 'Genin'}
          </button>
        )}
      </div>

      {modal && (
        <SquadMemberModal
          village={village} squadType={squadType} squadNumber={squadNumber}
          role={modal.role} member={modal.member || null} userId={perms.userId}
          asPending={!perms.admin}
          availableMentors={modal.role === 'captain' ? availableMentors : []}
          onClose={() => setModal(null)}
          onSaved={async () => {
            if (modal.role === 'captain' && !modal.member) {
              await supabase.from('roster_squads')
                .delete()
                .eq('village', village).eq('squad_type', squadType)
                .eq('squad_number', squadNumber).eq('role', 'sentinel');
            }
            setModal(null);
            onRefresh();
          }}
        />
      )}
    </>
  );
}

// ─── ENTRY LIST SECTION ───────────────────────────────────────────────────────
// Handles any flat roster_entries list with add/edit/delete

function EntrySection({ icon, title, rosterType, entries, t, perms, onRefresh, sublabel = false, adminOnly = false }) {
  const [modal, setModal] = useState(null); // null | 'add' | entry object
  const [orderedEntries, setOrderedEntries] = useState(entries);
  const [deletingId, setDeletingId] = useState(null);
  const [approvingId, setApprovingId] = useState(null);
  useEffect(() => setOrderedEntries(entries), [entries]);
  const sensors = useSortSensors();

  const canReorder = perms.admin; // only admins may touch approved rows
  // adminOnly sections (e.g. Sannin) can only be granted by admin+.
  const canAdd = adminOnly ? perms.admin : (perms.admin || perms.reviewer);

  const handleDelete = async (id) => {
    if (!window.confirm('Remove this entry?')) return;
    setDeletingId(id);
    try {
      await supabase.from('roster_entries').delete().eq('id', id);
      onRefresh();
    } finally {
      setDeletingId(null);
    }
  };

  const handleApprove = async (id) => {
    setApprovingId(id);
    try {
      await approveRows('roster_entries', [id], perms.userId);
      onRefresh();
    } catch (e) {
      alert('Approve failed: ' + (e.message || e));
    } finally {
      setApprovingId(null);
    }
  };

  const handleDragEnd = ({ active, over }) => {
    if (!over || active.id === over.id) return;
    const oldIndex = orderedEntries.findIndex(e => e.id === active.id);
    const newIndex = orderedEntries.findIndex(e => e.id === over.id);
    const next = arrayMove(orderedEntries, oldIndex, newIndex);
    setOrderedEntries(next);
    saveEntryOrder(next.map(e => e.id));
  };

  const rowProps = (e) => ({
    name: e.name, link: e.discord_link, t, meta: e.meta,
    pending: e.status === 'pending',
    canEdit: canModifyRow(perms, e) || canApproveRow(perms, e),
    onEdit: () => setModal(e),
    onDelete: () => handleDelete(e.id),
    deleteLoading: deletingId === e.id,
    onApprove: canApproveRow(perms, e) ? () => handleApprove(e.id) : null,
    approveLoading: approvingId === e.id,
  });

  const Header = sublabel
    ? <SubLabel t={t} canEdit={canAdd} onAdd={() => setModal('add')}>{title}</SubLabel>
    : <SectionHeader icon={icon} title={title} t={t} canEdit={canAdd} onAdd={() => setModal('add')} />;

  return (
    <>
      {Header}
      {orderedEntries.length === 0
        ? <EmptyNote />
        : canReorder && orderedEntries.length > 1
          ? <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
              <SortableContext items={orderedEntries.map(e => e.id)} strategy={verticalListSortingStrategy}>
                {orderedEntries.map(e => (
                  <SortableRow key={e.id} id={e.id} t={t} canEdit={canReorder}>
                    <Person {...rowProps(e)} />
                  </SortableRow>
                ))}
              </SortableContext>
            </DndContext>
          : orderedEntries.map(e => <Person key={e.id} {...rowProps(e)} />)
      }
      {modal && (
        <EntryModal
          rosterType={rosterType} entry={modal === 'add' ? null : modal}
          userId={perms.userId}
          asPending={!perms.admin}
          onClose={() => setModal(null)}
          onSaved={() => { setModal(null); onRefresh(); }}
        />
      )}
    </>
  );
}

// ─── WANDERER SECTION ─────────────────────────────────────────────────────────

function WandererSection({ wanderers, perms, onRefresh, wandererModal, setWandererModal }) {
  const ta = WANDERER_ACCENT;
  const [ordered, setOrdered] = useState(wanderers);
  const [deletingId, setDeletingId] = useState(null);
  const [approvingId, setApprovingId] = useState(null);
  useEffect(() => setOrdered(wanderers), [wanderers]);
  const sensors = useSortSensors();

  const canEdit = perms.admin;
  const canAdd  = perms.admin || perms.reviewer;

  const handleApprove = async (id) => {
    setApprovingId(id);
    try {
      await approveRows('roster_entries', [id], perms.userId);
      onRefresh();
    } catch (e) {
      alert('Approve failed: ' + (e.message || e));
    } finally {
      setApprovingId(null);
    }
  };

  const handleDragEnd = ({ active, over }) => {
    if (!over || active.id === over.id) return;
    const oldIndex = ordered.findIndex(w => w.id === active.id);
    const newIndex = ordered.findIndex(w => w.id === over.id);
    const next = arrayMove(ordered, oldIndex, newIndex);
    setOrdered(next);
    saveEntryOrder(next.map(w => w.id));
  };

  const WandererCard = ({ w }) => (
    <div className="rounded-sm p-4" style={{ background: 'rgba(15,23,42,0.7)', border: '1px solid rgba(255,255,255,0.05)', borderLeft: `3px solid ${ta.accent}` }}>
      <div className="flex items-center justify-between gap-2 mb-3 pb-3" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
        <div className="flex items-center gap-2 min-w-0">
          <Compass size={13} style={{ color: ta.accent, opacity: 0.7, flexShrink: 0 }} />
          {w.discord_link
            ? <a href={w.discord_link} target="_blank" rel="noopener noreferrer"
                 style={{ color: ta.accent }}
                 className="text-sm font-bold tracking-wide hover:brightness-125 transition-all underline-offset-2 hover:underline truncate">{w.name}</a>
            : <span className="text-sm font-bold tracking-wide text-slate-200 truncate">{w.name}</span>}
          {w.status === 'pending' && <PendingBadge />}
        </div>
        {(canModifyRow(perms, w) || canApproveRow(perms, w)) && (
          <div className="flex gap-1 shrink-0">
            {canApproveRow(perms, w) && (
              <AdminBtn icon={CheckCircle} onClick={() => handleApprove(w.id)} color="#34d399" title="Approve" loading={approvingId === w.id} />
            )}
            <AdminBtn icon={Pencil} onClick={() => setWandererModal(w)} title="Edit" />
            <AdminBtn icon={Trash2} onClick={async () => { if (window.confirm('Remove?')) { setDeletingId(w.id); try { await supabase.from('roster_entries').delete().eq('id', w.id); onRefresh(); } finally { setDeletingId(null); } }}} color="#f87171" title={w.status === 'pending' ? 'Reject / Remove' : 'Remove'} loading={deletingId === w.id} />
          </div>
        )}
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div><p className="text-[9px] font-black uppercase tracking-[0.15em] text-slate-500 mb-1">Friendly With</p><PillList items={w.meta?.friendly_with} color="#34d399" /></div>
        <div><p className="text-[9px] font-black uppercase tracking-[0.15em] text-slate-500 mb-1">Hostile With</p><PillList items={w.meta?.hostile_with} color="#f87171" /></div>
      </div>
    </div>
  );

  return (
    <div className="rounded-sm p-4 md:p-5" style={{ background: 'rgba(15,23,42,0.7)', border: '1px solid rgba(255,255,255,0.05)', borderLeft: `3px solid ${ta.accent}` }}>
      <SectionHeader icon={Compass} title="Wanderer Roster" t={ta} canEdit={canAdd} onAdd={() => setWandererModal('add')} />
      <SlotTracker filled={wanderers.length} cap={6} accent={ta.accent} />
      <p className="text-[10px] italic text-slate-500 px-1 mb-5">Staff Request required, not guaranteed to get.</p>
      {ordered.length === 0 ? <EmptyNote /> : (
        canEdit && ordered.length > 1
          ? <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
              <SortableContext items={ordered.map(w => w.id)} strategy={verticalListSortingStrategy}>
                <div className="space-y-3">
                  {ordered.map(w => (
                    <SortableRow key={w.id} id={w.id} t={ta} canEdit={canEdit}>
                      <WandererCard w={w} />
                    </SortableRow>
                  ))}
                </div>
              </SortableContext>
            </DndContext>
          : <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {ordered.map(w => <WandererCard key={w.id} w={w} />)}
            </div>
      )}
      {wandererModal && (
        <EntryModal rosterType="wanderer"
          entry={wandererModal === 'add' ? null : wandererModal}
          userId={perms.userId}
          asPending={!perms.admin}
          onClose={() => setWandererModal(null)}
          onSaved={() => { setWandererModal(null); onRefresh(); }} />
      )}
    </div>
  );
}

// ─── DATA TAB ─────────────────────────────────────────────────────────────────

const TT = {
  contentStyle: { background: '#0f172a', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 4, fontSize: 11 },
  labelStyle: { color: '#94a3b8', fontWeight: 700 },
  itemStyle: { color: '#e2e8f0' },
};

function NeedBadge({ level }) {
  const cfg = {
    critical: { bg: 'rgba(239,68,68,0.15)', text: '#f87171', label: 'Critical Need' },
    moderate: { bg: 'rgba(251,146,60,0.15)', text: '#fb923c', label: 'Could Use More' },
    healthy:  { bg: 'rgba(52,211,153,0.15)', text: '#34d399', label: 'Healthy' },
    surplus:  { bg: 'rgba(148,163,184,0.1)', text: '#94a3b8', label: 'Surplus' },
    empty:    { bg: 'rgba(239,68,68,0.15)', text: '#f87171', label: 'Empty' },
  }[level] || { bg: 'rgba(148,163,184,0.1)', text: '#94a3b8', label: level };
  return <span className="text-[9px] font-black uppercase tracking-wider px-2 py-0.5 rounded-sm" style={{ background: cfg.bg, color: cfg.text }}>{cfg.label}</span>;
}

function RankBar({ label, value, max, color, need }) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;
  return (
    <div className="mb-3">
      <div className="flex items-center justify-between mb-1">
        <span className="text-[10px] font-black uppercase tracking-wider text-slate-400">{label}</span>
        <div className="flex items-center gap-2">
          <span className="text-sm font-black text-white">{value}</span>
          <NeedBadge level={need} />
        </div>
      </div>
      <div className="h-1.5 rounded-full w-full" style={{ background: 'rgba(255,255,255,0.05)' }}>
        <div className="h-1.5 rounded-full transition-all duration-500" style={{ width: `${pct}%`, background: color, opacity: 0.8 }} />
      </div>
    </div>
  );
}

function DataTab({ entries, squads }) {
  const villages = Object.values(VILLAGE_META);

  const allCounts = useMemo(() =>
    Object.fromEntries(villages.map(v => [v.id, getCounts(entries, squads, v.id)])),
  [entries, squads]);

  const sortedVillages = useMemo(() =>
    [...villages].sort((a, b) => allCounts[a.id].total - allCounts[b.id].total),
  [allCounts]);

  const allEmpty = Object.values(allCounts).every(c => c.total === 0);

  const insights = useMemo(() => {
    if (allEmpty) return [];
    const results = [];
    const rankKeys   = ['genin', 'chunin', 'jonin', 'specialJonin'];
    const rankLabels = { genin: 'Genin', chunin: 'Chunin', jonin: 'Jonin', specialJonin: 'Special Jonin' };

    rankKeys.forEach(rank => {
      const vals = villages.map(v => ({ id: v.id, val: allCounts[v.id][rank], name: v.name }));
      vals.sort((a, b) => a.val - b.val);
      const lowest = vals[0], highest = vals[vals.length - 1];
      const diff = highest.val - lowest.val;
      if (diff === 0) return;
      const pct = highest.val > 0 ? Math.round((diff / highest.val) * 100) : 0;
      let extra = '';
      if (rank === 'genin') {
        const lc = allCounts[lowest.id];
        if (lc.teachers > 0 && lc.geninPerTeacher < 2) extra = ` ${lowest.name.replace('gakure', '')} already has room — only ${lc.geninPerTeacher} genin per teacher.`;
      }
      results.push({
        type: 'rank_gap', color: RANK_COLORS[rank],
        title: `${rankLabels[rank]} gap`,
        body: `${lowest.name.replace('gakure', '')} has the fewest ${rankLabels[rank].toLowerCase()} (${lowest.val}). ${highest.name.replace('gakure', '')} leads with ${highest.val} — a ${pct}% difference.${extra}`,
        cta: `Want to create a ${rankLabels[rank].toLowerCase()}? Consider ${lowest.name.replace('gakure', '')}.`,
      });
    });

    villages.forEach(v => {
      const c = allCounts[v.id], vn = v.name.replace('gakure', '');
      if (c.geninPerTeacher > 4)
        results.push({ type: 'overloaded', color: '#f87171', title: `${vn} teachers overloaded`, body: `${vn} averages ${c.geninPerTeacher} genin per teacher.`, cta: `Create a Jonin or Special Jonin in ${vn}.` });
      if (c.teachers > 0 && c.geninPerTeacher < 1.5 && c.genin > 0)
        results.push({ type: 'teacher_surplus', color: '#94a3b8', title: `${vn} has open teacher slots`, body: `${vn} only has ${c.geninPerTeacher} genin per teacher. Plenty of room for new genin.`, cta: `Create a Genin in ${vn}.` });
      if (c.unteachedGenin > 0)
        results.push({ type: 'open_squads', color: '#fb923c', title: `${vn} needs squad captains`, body: `${vn} has ${c.unteachedGenin} genin squad${c.unteachedGenin > 1 ? 's' : ''} without a captain.`, cta: `Create a Jonin or Special Jonin in ${vn}.` });
      if (c.unteachedChunin > 0)
        results.push({ type: 'open_squads', color: '#fb923c', title: `${vn} needs squad leaders`, body: `${vn} has ${c.unteachedChunin} chunin squad${c.unteachedChunin > 1 ? 's' : ''} without a leader.`, cta: `Create a Chunin in ${vn}.` });
    });
    return results;
  }, [allCounts, allEmpty]);

  const barData = villages.map(v => ({
    name: v.name.replace('gakure', ''),
    Genin: allCounts[v.id].genin, Chunin: allCounts[v.id].chunin,
    Jonin: allCounts[v.id].jonin, 'Spec. Jonin': allCounts[v.id].specialJonin,
  }));
  const radarData = ['Genin', 'Chunin', 'Jonin', 'Spec. Jonin'].map(rank => {
    const key = rank === 'Spec. Jonin' ? 'specialJonin' : rank.toLowerCase();
    const row = { rank };
    villages.forEach(v => { row[v.name.replace('gakure', '')] = allCounts[v.id][key]; });
    return row;
  });

  const serverStats = useMemo(() => {
    const totalGenin        = villages.reduce((s, v) => s + allCounts[v.id].genin, 0);
    const totalChunin       = villages.reduce((s, v) => s + allCounts[v.id].chunin, 0);
    const totalJonin        = villages.reduce((s, v) => s + allCounts[v.id].jonin, 0);
    const totalSpecialJonin = villages.reduce((s, v) => s + allCounts[v.id].specialJonin, 0);
    const totalRogue      = entries.filter(e => e.roster_type === 'rogue').length;
    const totalWanderer   = entries.filter(e => e.roster_type === 'wanderer').length;
    const totalSwordsmen  = entries.filter(e => e.roster_type === 'swordsmen').length;

    const villagePopData = villages.map(v => ({
      name: v.name.replace('gakure', ''),
      value: allCounts[v.id].total,
      color: VILLAGE_COLORS[v.id],
    }));

    // Jinchuriki are deliberately excluded from the visual data charts.
    const pieData = [
      ...villagePopData,
      { name: 'Rogue',      value: totalRogue,      color: '#ef4444' },
      { name: 'Wanderer',   value: totalWanderer,   color: '#a78bfa' },
      { name: 'Swordsmen',  value: totalSwordsmen,  color: '#38bdf8' },
    ].filter(d => d.value > 0);

    const rankBarData = [
      { name: 'Genin',       total: totalGenin,        fill: RANK_COLORS.genin },
      { name: 'Chunin',      total: totalChunin,       fill: RANK_COLORS.chunin },
      { name: 'Jonin',       total: totalJonin,        fill: RANK_COLORS.jonin },
      { name: 'Spec. Jonin', total: totalSpecialJonin, fill: RANK_COLORS.specialJonin },
      { name: 'Rogue',       total: totalRogue,        fill: '#ef4444' },
      { name: 'Wanderer',    total: totalWanderer,     fill: '#a78bfa' },
      { name: 'Swordsmen',   total: totalSwordsmen,    fill: '#38bdf8' },
    ].filter(d => d.total > 0);

    const serverTotal = pieData.reduce((s, d) => s + d.value, 0);
    return { pieData, rankBarData, serverTotal };
  }, [allCounts, entries]);

  function needLevel(val, max) {
    if (val === 0) return 'empty';
    const r = max > 0 ? val / max : 1;
    if (r <= 0.4) return 'critical';
    if (r <= 0.7) return 'moderate';
    if (r <= 0.9) return 'healthy';
    return 'surplus';
  }

  return (
    <div className="space-y-6">
      <div>
        <p className="text-[10px] uppercase tracking-[0.25em] font-black text-slate-500 mb-3">Village Status</p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {sortedVillages.map(v => {
            const c = allCounts[v.id];
            const allV = Object.values(allCounts);
            const maxG = Math.max(...allV.map(x => x.genin)), maxC = Math.max(...allV.map(x => x.chunin));
            const maxJ = Math.max(...allV.map(x => x.jonin)), maxS = Math.max(...allV.map(x => x.specialJonin));
            return (
              <div key={v.id} className="rounded-sm p-4" style={{ background: 'rgba(15,23,42,0.7)', border: '1px solid rgba(255,255,255,0.05)', borderLeft: `3px solid ${VILLAGE_COLORS[v.id]}` }}>
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-sm font-black uppercase tracking-[0.15em] text-white">{v.name.replace('gakure', '')}</h3>
                  <span className="text-xs font-black text-slate-500">{c.total} total</span>
                </div>
                <RankBar label="Genin"         value={c.genin}        max={maxG} color={RANK_COLORS.genin}        need={needLevel(c.genin, maxG)} />
                <RankBar label="Chunin"        value={c.chunin}       max={maxC} color={RANK_COLORS.chunin}       need={needLevel(c.chunin, maxC)} />
                <RankBar label="Jonin"         value={c.jonin}        max={maxJ} color={RANK_COLORS.jonin}        need={needLevel(c.jonin, maxJ)} />
                <RankBar label="Special Jonin" value={c.specialJonin} max={maxS} color={RANK_COLORS.specialJonin} need={needLevel(c.specialJonin, maxS)} />
                {(c.unteachedGenin > 0 || c.unteachedChunin > 0) && (
                  <div className="mt-3 pt-3" style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                    {c.unteachedGenin  > 0 && <p className="text-[10px] text-slate-400 mb-1"><span style={{ color: '#f87171', fontWeight: 900 }}>{c.unteachedGenin}</span> genin squad{c.unteachedGenin > 1 ? 's' : ''} without a captain</p>}
                    {c.unteachedChunin > 0 && <p className="text-[10px] text-slate-400"><span style={{ color: '#f87171', fontWeight: 900 }}>{c.unteachedChunin}</span> chunin squad{c.unteachedChunin > 1 ? 's' : ''} without a leader</p>}
                  </div>
                )}
                {c.teachers > 0 && (
                  <div className="mt-3 pt-3 flex items-center justify-between"
                       style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                    <span className="text-[10px] font-black uppercase tracking-wider text-slate-500">Teachers</span>
                    <div className="flex items-center gap-1.5 text-[10px] font-black">
                      <span style={{ color: '#34d399' }}>{c.freeTeachers} free</span>
                      <span className="text-slate-600">/</span>
                      <span className="text-slate-400">{c.teachers} total</span>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {!allEmpty && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="rounded-sm p-4" style={{ background: 'rgba(15,23,42,0.7)', border: '1px solid rgba(255,255,255,0.05)' }}>
            <p className="text-[10px] uppercase tracking-[0.2em] font-black text-slate-400 mb-4">Population by Rank</p>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={barData} barCategoryGap="25%">
                <XAxis dataKey="name" tick={{ fill: '#64748b', fontSize: 10, fontWeight: 700 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: '#475569', fontSize: 10 }} axisLine={false} tickLine={false} />
                <Tooltip {...TT} />
                <Bar dataKey="Genin"       stackId="a" fill={RANK_COLORS.genin}        opacity={0.85} />
                <Bar dataKey="Chunin"      stackId="a" fill={RANK_COLORS.chunin}       opacity={0.85} />
                <Bar dataKey="Jonin"       stackId="a" fill={RANK_COLORS.jonin}        opacity={0.85} />
                <Bar dataKey="Spec. Jonin" stackId="a" fill={RANK_COLORS.specialJonin} opacity={0.85} radius={[2,2,0,0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="rounded-sm p-4" style={{ background: 'rgba(15,23,42,0.7)', border: '1px solid rgba(255,255,255,0.05)' }}>
            <p className="text-[10px] uppercase tracking-[0.2em] font-black text-slate-400 mb-4">Rank Shape by Village</p>
            <ResponsiveContainer width="100%" height={200}>
              <RadarChart data={radarData}>
                <PolarGrid stroke="rgba(255,255,255,0.06)" />
                <PolarAngleAxis dataKey="rank" tick={{ fill: '#64748b', fontSize: 10, fontWeight: 700 }} />
                {villages.map(v => (
                  <Radar key={v.id} name={v.name.replace('gakure', '')} dataKey={v.name.replace('gakure', '')}
                         stroke={VILLAGE_COLORS[v.id]} fill={VILLAGE_COLORS[v.id]} fillOpacity={0.12} strokeWidth={2} />
                ))}
                <Tooltip {...TT} />
              </RadarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      <div>
        <p className="text-[10px] uppercase tracking-[0.25em] font-black text-slate-500 mb-3">Where to contribute</p>
        {allEmpty
          ? <p className="text-xs text-slate-600 italic px-1">No characters registered yet. Insights will appear once rosters are populated.</p>
          : <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {insights.map((ins, i) => (
                <div key={i} className="rounded-sm p-4 flex gap-3" style={{ background: 'rgba(15,23,42,0.7)', border: `1px solid ${ins.color}30` }}>
                  <div className="mt-0.5 shrink-0">
                    {ins.type === 'open_squads' ? <AlertTriangle size={15} style={{ color: ins.color }} /> : ins.type === 'teacher_surplus' ? <CheckCircle size={15} style={{ color: ins.color }} /> : <TrendingUp size={15} style={{ color: ins.color }} />}
                  </div>
                  <div className="min-w-0">
                    <p className="text-[10px] font-black uppercase tracking-[0.15em] mb-1" style={{ color: ins.color }}>{ins.title}</p>
                    <p className="text-xs text-slate-400 leading-relaxed mb-2">{ins.body}</p>
                    {ins.cta && <p className="text-[10px] font-black text-slate-300 flex items-center gap-1"><ArrowRight size={10} /> {ins.cta}</p>}
                  </div>
                </div>
              ))}
            </div>
        }
      </div>

      {!allEmpty && (
        <div>
          <p className="text-[10px] uppercase tracking-[0.25em] font-black text-slate-500 mb-3">
            Server Population — {serverStats.serverTotal} total characters
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="rounded-sm p-4" style={{ background: 'rgba(15,23,42,0.7)', border: '1px solid rgba(255,255,255,0.05)' }}>
              <p className="text-[10px] uppercase tracking-[0.2em] font-black text-slate-400 mb-4">Population by Affiliation</p>
              <ResponsiveContainer width="100%" height={220}>
                <PieChart>
                  <Pie data={serverStats.pieData} dataKey="value" nameKey="name"
                       cx="50%" cy="50%" outerRadius={80} innerRadius={40}
                       paddingAngle={3} strokeWidth={0}>
                    {serverStats.pieData.map((d, i) => <Cell key={i} fill={d.color} fillOpacity={0.85} />)}
                  </Pie>
                  <Tooltip {...TT} formatter={(val, name) => [`${val} characters`, name]} />
                  <Legend iconType="circle" iconSize={8}
                          formatter={v => <span style={{ color: '#94a3b8', fontSize: 10, fontWeight: 700 }}>{v}</span>} />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="rounded-sm p-4" style={{ background: 'rgba(15,23,42,0.7)', border: '1px solid rgba(255,255,255,0.05)' }}>
              <p className="text-[10px] uppercase tracking-[0.2em] font-black text-slate-400 mb-4">Breakdown by Category</p>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={serverStats.rankBarData} layout="vertical" barCategoryGap="20%">
                  <XAxis type="number" tick={{ fill: '#475569', fontSize: 10 }} axisLine={false} tickLine={false} allowDecimals={false} />
                  <YAxis type="category" dataKey="name" tick={{ fill: '#64748b', fontSize: 10, fontWeight: 700 }} axisLine={false} tickLine={false} width={72} />
                  <Tooltip {...TT} />
                  <Bar dataKey="total" radius={[0, 2, 2, 0]}>
                    {serverStats.rankBarData.map((d, i) => <Cell key={i} fill={d.fill} fillOpacity={0.85} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── MAIN PAGE ────────────────────────────────────────────────────────────────

export default function RosterPage({ userRole, userId }) {
  const [entries, setEntries]         = useState([]);
  const [squads, setSquads]           = useState([]);
  const [loading, setLoading]         = useState(true);
  const [activeVillage, setActiveVillage] = useState('konoha');
  const [mainTab, setMainTab]         = useState('roster');
  const [deletingRosterId, setDeletingRosterId] = useState(null);
  const [approvingRosterId, setApprovingRosterId] = useState(null);

  const canEdit   = isAdmin(userRole);
  const reviewer  = isReviewer(userRole);
  const canAdd    = canEdit || reviewer;
  const staffView = canEdit || reviewer;
  const perms = useMemo(() => ({ admin: canEdit, reviewer, userId }), [canEdit, reviewer, userId]);

  const handleApproveEntry = async (id) => {
    setApprovingRosterId(id);
    try {
      await approveRows('roster_entries', [id], userId);
      fetchData();
    } catch (e) {
      alert('Approve failed: ' + (e.message || e));
    } finally {
      setApprovingRosterId(null);
    }
  };

  const fetchData = useCallback(async () => {
    const [{ data: e }, { data: s }] = await Promise.all([
      supabase.from('roster_entries').select('*').order('sort_order').order('created_at'),
      supabase.from('roster_squads').select('*').order('squad_number').order('sort_order'),
    ]);
    setEntries(e || []);
    setSquads(s || []);
    setLoading(false);
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Real-time: refresh roster when any entry/squad changes in another tab or for another user
  useEffect(() => {
    if (!supabase) return;
    const channel = supabase
      .channel('roster-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'roster_entries' }, () => fetchData())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'roster_squads' },  () => fetchData())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [fetchData]);

  const isVillageTab = mainTab === 'roster';
  const v  = VILLAGE_META[activeVillage];
  const t  = THEME[v.color];

  const pageAccent =
    mainTab === 'rogue'      ? ROGUE_ACCENT.accentGlow :
    mainTab === 'wanderer'   ? WANDERER_ACCENT.accentGlow :
    mainTab === 'swords'     ? SWORDS_ACCENT.accentGlow :
    mainTab === 'jinchuriki' ? JINCHURIKI_ACCENT.accentGlow :
    mainTab === 'data'       ? 'rgba(14,165,233,0.35)' :
    t.accentGlow;

  const headerBorder =
    mainTab === 'rogue'      ? ROGUE_ACCENT.accentBorder :
    mainTab === 'wanderer'   ? WANDERER_ACCENT.accentBorder :
    mainTab === 'swords'     ? SWORDS_ACCENT.accentBorder :
    mainTab === 'jinchuriki' ? JINCHURIKI_ACCENT.accentBorder :
    mainTab === 'data'       ? 'rgba(14,165,233,0.25)' :
    t.accentBorder;

  const headerTitle =
    mainTab === 'rogue'      ? 'Rogue Roster' :
    mainTab === 'wanderer'   ? 'Wanderer Roster' :
    mainTab === 'swords'     ? 'Seven Swordsmen' :
    mainTab === 'jinchuriki' ? 'Jinchuriki' :
    mainTab === 'data'       ? 'Data' :
    v.name;

  const kanjiChar  = mainTab === 'rogue' ? '罪' : mainTab === 'wanderer' ? '旅' : mainTab === 'swords' ? '刀' : mainTab === 'jinchuriki' ? '獣' : mainTab === 'data' ? '忍' : v.kanji;
  const kanjiColor = mainTab === 'rogue' ? '#ef4444' : mainTab === 'wanderer' ? '#a78bfa' : mainTab === 'swords' ? '#38bdf8' : mainTab === 'jinchuriki' ? '#f97316' : mainTab === 'data' ? '#7dd3fc' : t.accent;

  // Pending rows are staff-only until approved; stats always count approved rows only.
  const visibleEntries  = useMemo(() => staffView ? entries : entries.filter(e => e.status !== 'pending'), [entries, staffView]);
  const visibleSquads   = useMemo(() => staffView ? squads  : squads.filter(s => s.status !== 'pending'),  [squads, staffView]);
  const approvedEntries = useMemo(() => entries.filter(e => e.status !== 'pending'), [entries]);
  const approvedSquads  = useMemo(() => squads.filter(s => s.status !== 'pending'),  [squads]);

  // Helper: filter entries by roster_type
  const ofType = (type) => visibleEntries.filter(e => e.roster_type === type);

  // Squads: group by village + type + squad_number
  const getSquadGroups = (villageId, squadType) => {
    const rows = visibleSquads.filter(s => s.village === villageId && s.squad_type === squadType);
    const nums = [...new Set(rows.map(s => s.squad_number))].sort((a, b) => a - b);
    return nums.map(n => ({ squadNumber: n, rows: rows.filter(s => s.squad_number === n) }));
  };

  // Add new squad: show number picker first, then captain modal
  const handleAddSquad = (villageId, squadType) => {
    const existing = squads.filter(s => s.village === villageId && s.squad_type === squadType);
    const maxNum = existing.length > 0 ? Math.max(...existing.map(s => s.squad_number)) : 0;
    setNewSquadConfig({ village: villageId, squadType, suggestedNumber: maxNum + 1 });
  };

  const [newSquadConfig, setNewSquadConfig] = useState(null);
  const [swordsModal, setSwordsModal]       = useState(null); // { sword, entry } | null
  const [jinchurikiModal, setJinchurikiModal] = useState(null); // { beastId, entry } | null
  const [wandererModal, setWandererModal]   = useState(null); // null | 'add' | entry

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: '#020408' }}>
      <Loader2 size={24} className="animate-spin text-slate-600" />
    </div>
  );

  return (
    <div className="min-h-screen text-slate-200 font-sans overflow-x-hidden"
         style={{ background: 'radial-gradient(ellipse at 20% 0%, rgba(15,25,20,1) 0%, #050a0f 60%, #020408 100%)' }}>

      <div className="fixed top-0 left-1/2 -translate-x-1/2 w-[700px] h-[300px] pointer-events-none"
           style={{ background: `radial-gradient(ellipse, ${pageAccent} 0%, transparent 70%)`, opacity: 0.18, filter: 'blur(40px)' }} />

      <div className="fixed inset-0 flex items-center justify-center pointer-events-none select-none overflow-hidden">
        <span className="text-[40vw] font-black leading-none" style={{ color: kanjiColor, opacity: 0.025, fontFamily: 'serif' }}>
          {kanjiChar}
        </span>
      </div>

      <div className="relative max-w-4xl mx-auto px-4 md:px-8 py-8 md:py-12">

        {/* ── Nav ── */}
        <div className="flex gap-1.5 mb-10 overflow-x-auto pb-1">
          {Object.values(VILLAGE_META).map(vv => {
            const vt = THEME[vv.color];
            const isActive = isVillageTab && activeVillage === vv.id;
            return (
              <button key={vv.id} onClick={() => { setActiveVillage(vv.id); setMainTab('roster'); }}
                className="px-5 py-2.5 text-[11px] font-black uppercase tracking-[0.12em] transition-all whitespace-nowrap rounded-sm"
                style={isActive ? { background: vt.tabActive, color: vt.tabText, boxShadow: `0 0 20px ${vt.accentGlow}` } : { background: 'rgba(255,255,255,0.04)', color: '#64748b', border: '1px solid rgba(255,255,255,0.06)' }}>
                {vv.name}
              </button>
            );
          })}
          <div className="w-px self-stretch mx-1" style={{ background: 'rgba(255,255,255,0.08)' }} />
          {[
            { id: 'rogue',      label: 'Rogues',     icon: <Skull size={11} />,   a: ROGUE_ACCENT },
            { id: 'wanderer',   label: 'Wanderers',  icon: <Compass size={11} />, a: WANDERER_ACCENT },
            { id: 'swords',     label: 'Swordsmen',  icon: <Sword size={11} />,   a: SWORDS_ACCENT },
            { id: 'jinchuriki', label: 'Jinchuriki', icon: <Flame size={11} />,   a: JINCHURIKI_ACCENT },
          ].map(tb => (
            <button key={tb.id} onClick={() => setMainTab(tb.id)}
              className="px-5 py-2.5 text-[11px] font-black uppercase tracking-[0.12em] transition-all whitespace-nowrap rounded-sm flex items-center gap-2"
              style={mainTab === tb.id ? { background: tb.a.tabActive, color: tb.a.tabText, boxShadow: `0 0 20px ${tb.a.accentGlow}` } : { background: 'rgba(255,255,255,0.04)', color: '#64748b', border: '1px solid rgba(255,255,255,0.06)' }}>
              {tb.icon} {tb.label}
            </button>
          ))}
          <div className="w-px self-stretch mx-1" style={{ background: 'rgba(255,255,255,0.08)' }} />
          <button onClick={() => setMainTab('data')}
            className="px-5 py-2.5 text-[11px] font-black uppercase tracking-[0.12em] transition-all whitespace-nowrap rounded-sm flex items-center gap-2"
            style={mainTab === 'data' ? { background: '#0ea5e9', color: '#0c1a20', boxShadow: '0 0 20px rgba(14,165,233,0.4)' } : { background: 'rgba(255,255,255,0.04)', color: '#64748b', border: '1px solid rgba(255,255,255,0.06)' }}>
            <BarChart2 size={12} /> Data
          </button>
        </div>

        {/* ── Header ── */}
        <header className="mb-10 pb-8" style={{ borderBottom: `1px solid ${headerBorder}` }}>
          <h1 className="text-4xl md:text-7xl font-black uppercase italic tracking-tighter text-white leading-none">{headerTitle}</h1>
        </header>

        {/* ── Village roster ── */}
        {isVillageTab && (
          <div className="space-y-4">
            {/* Sannin — legendary rank above the council; granted by admin+ only */}
            <Block t={t}>
              <EntrySection icon={Flame} title="Sannin" rosterType={`${activeVillage}_sannin`}
                entries={ofType(`${activeVillage}_sannin`)} t={t} perms={perms} onRefresh={fetchData} adminOnly />
              {ofType(`${activeVillage}_sannin`).length === 0 && (
                <p className="text-[10px] italic text-slate-500 px-1 -mt-2">
                  A legendary rank — cannot be started with, and only granted by an Admin.
                </p>
              )}
            </Block>
            <Block t={t}>
              <EntrySection icon={Crown} title="Village Council" rosterType={`${activeVillage}_council`}
                entries={ofType(`${activeVillage}_council`)} t={t} perms={perms} onRefresh={fetchData} />
            </Block>
            <Block t={t}>
              <SectionHeader icon={BookOpen} title="Elite Shinobi" t={t} canEdit={false} />
              <EntrySection title="Elite Jonin" rosterType={`${activeVillage}_elite_jonin`}
                entries={ofType(`${activeVillage}_elite_jonin`)} t={t} perms={perms} onRefresh={fetchData} sublabel />
              <EntrySection title="Jonin" rosterType={`${activeVillage}_jonin`}
                entries={ofType(`${activeVillage}_jonin`)} t={t} perms={perms} onRefresh={fetchData} sublabel />
              <EntrySection title="Special Jonin" rosterType={`${activeVillage}_special_jonin`}
                entries={ofType(`${activeVillage}_special_jonin`)} t={t} perms={perms} onRefresh={fetchData} sublabel />
            </Block>

            {/* Chunin Squads */}
            <Block t={t}>
              <div className="flex items-center gap-3 mb-5">
                <div className="flex items-center justify-center w-7 h-7 rounded-sm" style={{ background: t.accentFaint, border: `1px solid ${t.accentBorder}` }}>
                  <BookOpen size={14} style={{ color: t.accent }} />
                </div>
                <h2 className="text-xs font-black uppercase tracking-[0.2em] text-slate-300">Chunin Squads</h2>
                <div className="flex-1 h-px" style={{ background: `linear-gradient(to right, ${t.accentBorder}, transparent)` }} />
                {canAdd && (
                  <button onClick={() => handleAddSquad(activeVillage, 'chunin')}
                    className="flex items-center gap-1 px-2.5 py-1 rounded-sm text-[9px] font-black uppercase tracking-wider transition-all hover:brightness-110"
                    style={{ background: t.accentFaint, color: t.accent, border: `1px solid ${t.accentBorder}` }}>
                    <Plus size={10} /> Add Squad
                  </button>
                )}
              </div>
              {getSquadGroups(activeVillage, 'chunin').length === 0
                ? <EmptyNote />
                : <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {getSquadGroups(activeVillage, 'chunin').map(g => (
                      <SquadCard key={g.squadNumber} village={activeVillage} squadType="chunin"
                        squadNumber={g.squadNumber} rows={g.rows} t={t}
                        perms={perms} onRefresh={fetchData}
                        entries={approvedEntries} squads={squads} />
                    ))}
                  </div>
              }
            </Block>

            {/* Genin Squads */}
            <Block t={t}>
              <div className="flex items-center gap-3 mb-5">
                <div className="flex items-center justify-center w-7 h-7 rounded-sm" style={{ background: t.accentFaint, border: `1px solid ${t.accentBorder}` }}>
                  <Users size={14} style={{ color: t.accent }} />
                </div>
                <h2 className="text-xs font-black uppercase tracking-[0.2em] text-slate-300">Genin Squads</h2>
                <div className="flex-1 h-px" style={{ background: `linear-gradient(to right, ${t.accentBorder}, transparent)` }} />
                {canAdd && (
                  <button onClick={() => handleAddSquad(activeVillage, 'genin')}
                    className="flex items-center gap-1 px-2.5 py-1 rounded-sm text-[9px] font-black uppercase tracking-wider transition-all hover:brightness-110"
                    style={{ background: t.accentFaint, color: t.accent, border: `1px solid ${t.accentBorder}` }}>
                    <Plus size={10} /> Add Squad
                  </button>
                )}
              </div>
              {getSquadGroups(activeVillage, 'genin').length === 0
                ? <EmptyNote />
                : <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    {getSquadGroups(activeVillage, 'genin').map(g => (
                      <SquadCard key={g.squadNumber} village={activeVillage} squadType="genin"
                        squadNumber={g.squadNumber} rows={g.rows} t={t}
                        perms={perms} onRefresh={fetchData}
                        entries={approvedEntries} squads={squads} />
                    ))}
                  </div>
              }
            </Block>
          </div>
        )}

        {/* ── Rogues ── */}
        {mainTab === 'rogue' && (() => {
          const rogues = ofType('rogue');
          const ta = ROGUE_ACCENT;
          return (
            <div className="rounded-sm p-4 md:p-5" style={{ background: 'rgba(15,23,42,0.7)', border: '1px solid rgba(255,255,255,0.05)', borderLeft: `3px solid ${ta.accent}` }}>
              <SectionHeader icon={Skull} title="Rogue Roster" t={ta} canEdit={false} />
              <SlotTracker filled={rogues.length} cap={6} accent={ta.accent} />
              <p className="text-[10px] italic text-slate-500 px-1 mb-5">Must become a rogue in-character.</p>
              <EntrySection title="" rosterType="rogue" entries={rogues} t={ta} perms={perms} onRefresh={fetchData} sublabel={false} icon={Skull} />
            </div>
          );
        })()}

        {/* ── Wanderers ── */}
        {mainTab === 'wanderer' && (
          <WandererSection
            wanderers={ofType('wanderer')}
            perms={perms} onRefresh={fetchData}
            wandererModal={wandererModal} setWandererModal={setWandererModal}
          />
        )}

        {/* ── Swordsmen ── */}
        {mainTab === 'swords' && (() => {
          const swordsmen = ofType('swordsmen');
          const swordMap = Object.fromEntries(swordsmen.map(s => [s.meta?.sword, s]));
          const ta = SWORDS_ACCENT;
          return (
            <div className="rounded-sm p-4 md:p-5" style={{ background: 'rgba(15,23,42,0.7)', border: '1px solid rgba(255,255,255,0.05)', borderLeft: `3px solid ${ta.accent}` }}>
              <SectionHeader icon={Sword} title="Seven Ninja Swordsmen" t={ta} canEdit={false} />
              <SlotTracker filled={swordsmen.length} cap={7} accent={ta.accent} />
              <div className="space-y-2">
                {SWORDS_LIST.map((sword, i) => {
                  const bearer = swordMap[sword];
                  return (
                    <div key={sword} className="flex items-center gap-3 py-2.5 px-3 rounded-sm" style={{ background: 'rgba(15,23,42,0.5)', border: '1px solid rgba(255,255,255,0.04)', borderLeft: `2px solid ${bearer ? ta.accent : 'rgba(255,255,255,0.06)'}` }}>
                      <span className="text-[9px] font-black w-4 shrink-0 text-right" style={{ color: ta.accent, opacity: 0.45 }}>{i + 1}</span>
                      <span className="text-[10px] font-black uppercase tracking-[0.12em] w-36 shrink-0" style={{ color: bearer ? ta.accent : '#334155' }}>{sword}</span>
                      <div className="flex-1 min-w-0 flex items-center gap-2">
                        {bearer
                          ? bearer.discord_link
                            ? <a href={bearer.discord_link} target="_blank" rel="noopener noreferrer" style={{ color: '#e2e8f0' }} className="text-sm font-semibold tracking-wide truncate hover:brightness-125 transition-all underline-offset-2 hover:underline block">{bearer.name}</a>
                            : <span className="text-sm font-semibold text-slate-200 tracking-wide truncate block">{bearer.name}</span>
                          : <span className="text-xs italic text-slate-600">Vacant</span>
                        }
                        {bearer?.status === 'pending' && <PendingBadge />}
                      </div>
                      {canAdd && (
                        <div className="flex gap-1 shrink-0">
                          {bearer
                            ? <>
                                {canApproveRow(perms, bearer) && <AdminBtn icon={CheckCircle} onClick={() => handleApproveEntry(bearer.id)} color="#34d399" title="Approve" loading={approvingRosterId === bearer.id} />}
                                {(canModifyRow(perms, bearer) || canApproveRow(perms, bearer)) && <><AdminBtn icon={Pencil} onClick={() => setSwordsModal({ sword: bearer.meta?.sword, entry: bearer })} title="Edit" /><AdminBtn icon={Trash2} onClick={async () => { if (window.confirm('Remove?')) { setDeletingRosterId(bearer.id); try { await supabase.from('roster_entries').delete().eq('id', bearer.id); fetchData(); } finally { setDeletingRosterId(null); } }}} color="#f87171" title={bearer.status === 'pending' ? 'Reject / Remove' : 'Remove'} loading={deletingRosterId === bearer.id} /></>}
                              </>
                            : <button className="flex items-center gap-1 px-2 py-0.5 rounded-sm text-[8px] font-black uppercase tracking-wider" style={{ background: ta.accentFaint, color: ta.accent, border: `1px solid ${ta.accentBorder}` }} onClick={() => setSwordsModal({ sword, entry: null })}><Plus size={8} /> Assign</button>
                          }
                        </div>
                      )}
                      <div className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: bearer ? ta.accent : 'rgba(255,255,255,0.1)' }} />
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })()}
        {swordsModal && (
          <EntryModal rosterType="swordsmen"
            entry={swordsModal.entry}
            initialSword={swordsModal.entry ? '' : swordsModal.sword}
            userId={userId}
            asPending={!canEdit}
            onClose={() => setSwordsModal(null)}
            onSaved={() => { setSwordsModal(null); fetchData(); }} />
        )}

        {/* ── Jinchuriki ── */}
        {mainTab === 'jinchuriki' && (() => {
          const jins = ofType('jinchuriki');
          const jMap = Object.fromEntries(jins.map(j => [j.meta?.beast_id, j]));
          const ta = JINCHURIKI_ACCENT;
          return (
            <div className="rounded-sm p-4 md:p-5" style={{ background: 'rgba(15,23,42,0.7)', border: '1px solid rgba(255,255,255,0.05)', borderLeft: `3px solid ${ta.accent}` }}>
              <SectionHeader icon={Flame} title="Jinchuriki" t={ta} canEdit={false} />
              <SlotTracker filled={jins.length} cap={10} accent={ta.accent} />
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {TAILED_BEASTS.map(beast => {
                  const host = jMap[beast.id];
                  const bColor = BEAST_COLORS[beast.tails] || '#94a3b8';
                  return (
                    <div key={beast.id} className="flex items-center gap-3 py-3 px-3 rounded-sm" style={{ background: 'rgba(15,23,42,0.5)', border: '1px solid rgba(255,255,255,0.04)', borderLeft: `2px solid ${host ? bColor : 'rgba(255,255,255,0.06)'}` }}>
                      <div className="flex flex-col items-center gap-0.5 w-6 shrink-0">
                        <div className="w-2.5 h-2.5 rounded-full" style={{ background: host ? bColor : 'rgba(255,255,255,0.08)', boxShadow: host ? `0 0 6px ${bColor}88` : 'none' }} />
                        <span className="text-[8px] font-black" style={{ color: host ? bColor : '#1e293b' }}>{beast.tails}✦</span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-[10px] font-black uppercase tracking-[0.12em]" style={{ color: host ? bColor : '#334155' }}>
                          {beast.label} <span className="text-[8px] normal-case tracking-normal font-semibold opacity-50">· {beast.sub}</span>
                        </p>
                        <div className="mt-0.5 flex items-center gap-2">
                          {host
                            ? host.discord_link
                              ? <a href={host.discord_link} target="_blank" rel="noopener noreferrer" style={{ color: '#e2e8f0' }} className="text-sm font-semibold tracking-wide hover:brightness-125 transition-all underline-offset-2 hover:underline">{host.name}</a>
                              : <span className="text-sm font-semibold text-slate-200 tracking-wide">{host.name}</span>
                            : <span className="text-xs italic text-slate-600">No host</span>
                          }
                          {host?.status === 'pending' && <PendingBadge />}
                        </div>
                      </div>
                      {canAdd && (
                        <div className="flex gap-1 shrink-0">
                          {host
                            ? <>
                                {canApproveRow(perms, host) && <AdminBtn icon={CheckCircle} onClick={() => handleApproveEntry(host.id)} color="#34d399" title="Approve" loading={approvingRosterId === host.id} />}
                                {(canModifyRow(perms, host) || canApproveRow(perms, host)) && <><AdminBtn icon={Pencil} onClick={() => setJinchurikiModal({ beastId: beast.id, entry: host })} title="Edit" /><AdminBtn icon={Trash2} onClick={async () => { if (window.confirm('Remove?')) { setDeletingRosterId(host.id); try { await supabase.from('roster_entries').delete().eq('id', host.id); fetchData(); } finally { setDeletingRosterId(null); } }}} color="#f87171" title={host.status === 'pending' ? 'Reject / Remove' : 'Remove'} loading={deletingRosterId === host.id} /></>}
                              </>
                            : <button className="flex items-center gap-1 px-2 py-0.5 rounded-sm text-[8px] font-black uppercase tracking-wider" style={{ background: ta.accentFaint, color: ta.accent, border: `1px solid ${ta.accentBorder}` }} onClick={() => setJinchurikiModal({ beastId: beast.id, entry: null })}><Plus size={8} /> Assign</button>
                          }
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })()}
        {jinchurikiModal && (
          <EntryModal rosterType="jinchuriki"
            entry={jinchurikiModal.entry}
            initialBeastId={jinchurikiModal.entry ? '' : jinchurikiModal.beastId}
            userId={userId}
            asPending={!canEdit}
            onClose={() => setJinchurikiModal(null)}
            onSaved={() => { setJinchurikiModal(null); fetchData(); }} />
        )}

        {mainTab === 'data' && <DataTab entries={approvedEntries} squads={approvedSquads} />}

      </div>

      {newSquadConfig && (
        <CreateSquadModal
          village={newSquadConfig.village}
          squadType={newSquadConfig.squadType}
          suggestedNumber={newSquadConfig.suggestedNumber}
          entries={approvedEntries}
          squads={squads}
          userId={userId}
          asPending={!canEdit}
          onSaved={() => { setNewSquadConfig(null); fetchData(); }}
          onClose={() => setNewSquadConfig(null)}
        />
      )}
    </div>
  );
}
