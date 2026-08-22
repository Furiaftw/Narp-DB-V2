import { useState, useEffect, useMemo, useRef } from 'react';
import { Icon } from '../ui/Icon';
import { getSlotStatus } from '../../utils/helpers';
import {
  submitPendingJutsu, fetchMyOcCount, fetchCharacterSheetByName,
  consumeWandererTicket, getCurrentSession, supabase,
} from '../../lib/supabase';
import { normalizeSheet as normalizeCharacterSheet, sheetHasContent as characterSheetHasContent } from '../../constants/characterSheet';
import CharacterSheetModal from '../features/CharacterSheetModal';

/* ============================================================================
   COMPONENT: OCSubmissionModal
   The Character (OC) submission form. Also the entry point to a character
   sheet composed *before* the OC exists on the roster — its "Character Sheet"
   button opens CharacterSheetModal keyed by the proposed name, which approval
   then hard-requires.
   ============================================================================ */

export const OC_RANKS = ['Genin', 'Chūnin', 'Special Jōnin', 'Jōnin'];
export const OC_RANK_KEY = { 'Genin': 'genin', 'Chūnin': 'chunin', 'Special Jōnin': 'specialJonin', 'Jōnin': 'jonin' };
export const OC_VILLAGES = [
  { id: 'konoha', name: 'Konohagakure' },
  { id: 'kumo',   name: 'Kumogakure' },
  { id: 'kiri',   name: 'Kirigakure' },
];
export const CLANLESS = 'Clanless';

// Slot capacity summary for a bloodline row (app-shape, slots as JSON string).
// Reserved placeholder slots have a username, so they count as occupied —
// a bloodline whose last slot is reserved reads as full.
export const getBloodlineSlotInfo = (bl) => {
  const { parsed } = getSlotStatus(bl.slots);
  const unlimited = Number(bl.max_slots) === -1 || (bl.name || '').trim().toLowerCase() === 'clanless';
  if (unlimited) return { unlimited: true, status: 'open', remaining: Infinity };
  const capacity = parsed.length > 0 ? parsed.length : Number(bl.max_slots ?? 5);
  const filled = parsed.filter(s => s?.username).length;
  const remaining = Math.max(0, capacity - filled);
  return {
    unlimited: false,
    capacity,
    filled,
    remaining,
    status: capacity <= 0 ? 'open' : remaining === 0 ? 'full' : remaining <= 2 ? 'limited' : 'open',
  };
};

export const OC_NEED_BADGES = {
  empty:    { label: 'Most Needed',    cls: 'bg-rose-100 text-rose-700 border-rose-200' },
  critical: { label: 'Most Needed',    cls: 'bg-rose-100 text-rose-700 border-rose-200' },
  moderate: { label: 'Could Use More', cls: 'bg-amber-100 text-amber-700 border-amber-200' },
  healthy:  { label: 'Healthy',        cls: 'bg-emerald-100 text-emerald-700 border-emerald-200' },
  surplus:  { label: 'Well Stocked',   cls: 'bg-slate-100 text-slate-500 border-slate-200' },
};

export const ocNeedLevel = (val, max) => {
  if (val === 0) return 'empty';
  const r = max > 0 ? val / max : 1;
  if (r <= 0.4) return 'critical';
  if (r <= 0.7) return 'moderate';
  if (r <= 0.9) return 'healthy';
  return 'surplus';
};

export const ordinalLabel = (n) => {
  const v = Number(n) || 0;
  const mod100 = v % 100;
  const suffix = (mod100 >= 11 && mod100 <= 13) ? 'th'
    : v % 10 === 1 ? 'st' : v % 10 === 2 ? 'nd' : v % 10 === 3 ? 'rd' : 'th';
  return `${v}${suffix}`;
};

export function OCSubmissionModal({ profile, bloodlines, jutsus = [], onClose, onAfterSubmit, editPending = null, onSavedEdit = null, isAdmin = false, onSubmitAndApprove = null }) {
  const initial = editPending?.data || {};
  // Character Sheet button (mirrors the jutsu form's "Add Documentation"
  // button): opens CharacterSheetModal as its own overlay so it can be
  // filled in while still composing the submission, not just afterward.
  const [sheetEditorOpen, setSheetEditorOpen] = useState(false);
  const [sheetFilled, setSheetFilled] = useState(false);
  const [name, setName] = useState(initial.name || '');
  const [ninjaRank, setNinjaRank] = useState(initial.ninja_rank || '');
  const [village, setVillage] = useState(initial.village || '');
  const [bloodline, setBloodline] = useState(initial.bloodline || CLANLESS);
  const [squadChoice, setSquadChoice] = useState(() =>
    initial.squad_number ? { number: Number(initial.squad_number), isNew: !!initial.squad_is_new } : null
  );
  const [mentorSquad, setMentorSquad] = useState(initial.mentor_squad_number ? String(initial.mentor_squad_number) : '');
  const [councilor, setCouncilor] = useState(!!initial.councilor);
  // Auto-calculated from the player's existing OCs (approved roster + other
  // in-flight submissions) instead of self-reported — see fetchMyOcCount.
  const [ocNumber, setOcNumber] = useState(initial.oc_number ? Number(initial.oc_number) : 0);
  const [ocCountLoading, setOcCountLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [rosterCounts, setRosterCounts] = useState(null);
  const [rosterSquads, setRosterSquads] = useState([]);

  const isEdit = !!editPending;
  // Wanderer is not a pickable option for ordinary users — an admin has to
  // grant a one-time ticket first (after the user cleared it with them in
  // Discord). Editing an existing Wanderer submission stays allowed even
  // without a ticket, since the ticket was already spent to create it.
  const hasWandererTicket = isEdit ? initial.village === 'Wanderer' : !!profile?.wanderer_ticket;

  useEffect(() => {
    if (isEdit || !profile?.id) return;
    let cancelled = false;
    setOcCountLoading(true);
    fetchMyOcCount(profile.id, editPending?.id || null)
      .then(count => { if (!cancelled) setOcNumber(count + 1); })
      .catch(err => console.warn('[NARP] OC count fetch failed:', err))
      .finally(() => { if (!cancelled) setOcCountLoading(false); });
    return () => { cancelled = true; };
  }, [isEdit, profile?.id, editPending?.id]);

  // Tracks whether the character sheet (opened via the button below) has
  // been filled in yet, so the button can say "Add" vs "Edit" like the
  // jutsu form's documentation button does.
  useEffect(() => {
    if (isEdit || !name.trim()) { setSheetFilled(false); return; }
    let cancelled = false;
    fetchCharacterSheetByName(name.trim())
      .then(row => { if (!cancelled) setSheetFilled(!!row && characterSheetHasContent(normalizeCharacterSheet(row.data))); })
      .catch(() => { if (!cancelled) setSheetFilled(false); });
    return () => { cancelled = true; };
  }, [isEdit, name, sheetEditorOpen]);

  // Population per village per rank, straight from the public roster tables.
  useEffect(() => {
    if (!supabase) return;
    (async () => {
      try {
        const [{ data: e }, { data: s }] = await Promise.all([
          supabase.from('roster_entries').select('roster_type, status'),
          supabase.from('roster_squads').select('village, squad_type, squad_number, role, name, status'),
        ]);
        const entries = (e || []).filter(x => x.status !== 'pending');
        const squadRows = (s || []).filter(x => x.status !== 'pending');
        const counts = {};
        for (const v of OC_VILLAGES) {
          counts[v.id] = {
            jonin:        entries.filter(x => x.roster_type === `${v.id}_jonin`).length,
            specialJonin: entries.filter(x => x.roster_type === `${v.id}_special_jonin`).length,
            chunin:       squadRows.filter(x => x.village === v.id && x.squad_type === 'chunin' && x.role === 'member').length,
            genin:        squadRows.filter(x => x.village === v.id && x.squad_type === 'genin'  && x.role === 'genin').length,
          };
        }
        setRosterCounts(counts);
        setRosterSquads(squadRows);
      } catch (err) {
        console.warn('[NARP] OC roster stats fetch failed:', err);
      }
    })();
  }, []);

  /* ---- Squad interaction ------------------------------------------------ */
  const isWanderer = village === 'Wanderer';
  const villageId = OC_VILLAGES.find(v => v.name === village)?.id || null;
  // Genin and Chūnin join (or start) a squad of their own rank. Wanderers
  // live outside the village system — no squads, mentoring, or council.
  const squadType = !isWanderer && (ninjaRank === 'Genin' ? 'genin' : ninjaRank === 'Chūnin' ? 'chunin' : null);
  const memberRole = squadType === 'genin' ? 'genin' : 'member';

  // Squads of the relevant type in the chosen village, with member counts.
  // The squad with the fewest members needs recruits the most → recommended.
  const squadGroups = useMemo(() => {
    if (!villageId || !squadType) return [];
    const byNum = new Map();
    for (const s of rosterSquads) {
      if (s.village !== villageId || s.squad_type !== squadType) continue;
      let g = byNum.get(s.squad_number);
      if (!g) { g = { number: s.squad_number, members: 0, captain: null }; byNum.set(s.squad_number, g); }
      if (s.role === memberRole || s.role === 'part_time') g.members += 1;
      if (s.role === 'captain') g.captain = s.name;
    }
    return [...byNum.values()].sort((a, b) => a.number - b.number);
  }, [rosterSquads, villageId, squadType, memberRole]);

  const recommendedSquad = useMemo(() => {
    if (!squadGroups.length) return null;
    return squadGroups.reduce((min, g) => (g.members < min.members ? g : min), squadGroups[0]).number;
  }, [squadGroups]);

  const nextSquadNumber = squadGroups.length ? Math.max(...squadGroups.map(g => g.number)) + 1 : 1;

  // Captainless genin squads the new Jōnin / Special Jōnin could mentor.
  const mentorableSquads = useMemo(() => {
    if (!villageId || (ninjaRank !== 'Jōnin' && ninjaRank !== 'Special Jōnin')) return [];
    const byNum = new Map();
    for (const s of rosterSquads) {
      if (s.village !== villageId || s.squad_type !== 'genin') continue;
      let g = byNum.get(s.squad_number);
      if (!g) { g = { number: s.squad_number, members: 0, hasCaptain: false }; byNum.set(s.squad_number, g); }
      if (s.role === 'genin' || s.role === 'part_time') g.members += 1;
      if (s.role === 'captain') g.hasCaptain = true;
    }
    return [...byNum.values()].filter(g => !g.hasCaptain).sort((a, b) => a.number - b.number);
  }, [rosterSquads, villageId, ninjaRank]);

  // Rank or village change invalidates the squad-related picks.
  const pickRank = (r) => { setNinjaRank(r); setSquadChoice(null); setMentorSquad(''); if (r !== 'Jōnin') setCouncilor(false); };
  const pickVillage = (name) => { setVillage(name); setSquadChoice(null); setMentorSquad(''); if (name === 'Wanderer') setCouncilor(false); };

  const rankTotals = useMemo(() => {
    if (!rosterCounts) return null;
    const totals = {};
    OC_RANKS.forEach(r => {
      const key = OC_RANK_KEY[r];
      totals[r] = OC_VILLAGES.reduce((sum, v) => sum + (rosterCounts[v.id]?.[key] || 0), 0);
    });
    return totals;
  }, [rosterCounts]);
  const rankMax = rankTotals ? Math.max(...Object.values(rankTotals)) : 0;

  // Village with the fewest characters of the chosen rank = suggested pick.
  const suggestedVillage = useMemo(() => {
    if (!rosterCounts || !ninjaRank) return null;
    const key = OC_RANK_KEY[ninjaRank];
    let best = null;
    for (const v of OC_VILLAGES) {
      const val = rosterCounts[v.id]?.[key] || 0;
      if (!best || val < best.val) best = { name: v.name, val };
    }
    return best?.name || null;
  }, [rosterCounts, ninjaRank]);

  // Deduplicate bloodlines by name and compute slot status for the picker.
  const bloodlineOptions = useMemo(() => {
    const seen = new Set([CLANLESS.toLowerCase()]);
    const opts = [];
    for (const bl of bloodlines || []) {
      const key = (bl.name || '').trim().toLowerCase();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      opts.push({ name: bl.name, info: getBloodlineSlotInfo(bl) });
    }
    return opts.sort((a, b) => a.name.localeCompare(b.name));
  }, [bloodlines]);

  const selectedInfo = bloodline === CLANLESS
    ? { unlimited: true, status: 'open', remaining: Infinity }
    : (bloodlineOptions.find(o => o.name === bloodline)?.info || { status: 'open', remaining: Infinity });

  const needsReservation = !isEdit && selectedInfo.status === 'limited';
  const bloodlineFull = selectedInfo.status === 'full';

  const squadRequired = !!squadType && !!village;
  const submitDisabled = !name.trim() || !ninjaRank || !village || !ocNumber || ocCountLoading
    || (squadRequired && !squadChoice) || bloodlineFull || submitting;

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (submitDisabled) return;
    setSubmitting(true);
    try {
      const squadFields = {
        squad_type: squadType || null,
        squad_number: squadType && squadChoice ? squadChoice.number : null,
        squad_is_new: squadType && squadChoice ? !!squadChoice.isNew : false,
        mentor_squad_number: !isWanderer && (ninjaRank === 'Jōnin' || ninjaRank === 'Special Jōnin') && mentorSquad ? Number(mentorSquad) : null,
        councilor: !isWanderer && ninjaRank === 'Jōnin' ? councilor : false,
        oc_number: ocNumber || null,
      };

      if (isEdit) {
        // Reviewer edit: overwrite the entry fields, keep workflow fields
        // (reservation state, final-step links, etc.) untouched.
        await onSavedEdit({
          ...editPending.data,
          name: name.trim(),
          ninja_rank: ninjaRank,
          village,
          bloodline,
          ...squadFields,
        });
        onClose();
        return;
      }

      // Wanderer is ticket-gated: the ticket is spent right here, at
      // submission time, not at approval — cancelling afterward does not
      // refund it, so a stolen/duplicate submit attempt can't consume it
      // twice and a legitimate submit can't slip through without one.
      if (isWanderer) {
        const consumed = await consumeWandererTicket();
        if (!consumed) {
          alert('You don’t have a Wanderer ticket. Ask an admin in Discord for one before submitting a Wanderer OC.');
          setSubmitting(false);
          return;
        }
      }

      const data = {
        type: 'Character',
        name: name.trim(),
        ninja_rank: ninjaRank,
        village,
        bloodline,
        ...squadFields,
        ...(needsReservation ? { subType: 'reservation_request', reservationStatus: 'requested' } : {}),
      };
      const inserted = await submitPendingJutsu('insert', null, data, 'pending_review');

      // Admin+ don't need a second approver — auto-approve right away, unless
      // this went into the reservation flow (that's inherently a waiting
      // period while the bloodline slot is held). If the approval-time sheet
      // check (see handleApprovePending) rejects it because the sheet isn't
      // filled in yet (the "Character Sheet" button above is optional, not
      // required, before submitting), it just stays in the Inbox for a
      // normal approval later once the sheet is done.
      if (isAdmin && !needsReservation && onSubmitAndApprove && inserted?.id) {
        try {
          await onSubmitAndApprove(inserted.id, {
            id: inserted.id,
            operation: 'insert',
            target_id: null,
            data,
            status: 'pending_review',
            submitted_by: profile.id,
            submitter: profile,
            first_reviewer: profile,
          });
          if (onAfterSubmit) onAfterSubmit();
          onClose();
          return;
        } catch (approveErr) {
          console.warn('[NARP] Admin auto-approve failed, left in the review queue:', approveErr);
          alert(
            'Submitted, but could not auto-approve: ' + (approveErr.message || approveErr) +
            '\n\nIt is waiting in the Inbox — approve it from there once ready.'
          );
          if (onAfterSubmit) onAfterSubmit();
          onClose();
          return;
        }
      }

      const _pingSess = await getCurrentSession();
      fetch('/.netlify/functions/reviewer-ping', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(_pingSess?.access_token ? { Authorization: `Bearer ${_pingSess.access_token}` } : {}),
        },
        body: JSON.stringify({
          triggerType: 'creation',
          itemName: needsReservation ? `${data.name} (Réservation Request)` : data.name,
          itemType: 'Character',
          submitterName: profile?.username || 'Unknown',
        }),
      }).catch((pingErr) => {
        console.warn('[NARP] Reviewer ping creation alert failed:', pingErr);
      });

      if (onAfterSubmit) onAfterSubmit();
      onClose();
    } catch (err) {
      console.error('[NARP] Failed to submit OC:', err);
      alert('Submission failed: ' + (err.message || err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
    <div className="fixed inset-0 z-[80] bg-black/60 flex items-center justify-center p-4 animate-in fade-in" onClick={onClose}>
      <div className="bg-white rounded-3xl max-w-lg w-full overflow-hidden max-h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="bg-slate-900 text-white p-5 flex justify-between items-center shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <Icon n="PlusCir" size={18} className="text-emerald-400 shrink-0" />
            <h2 className="font-serif font-bold text-base truncate">{isEdit ? 'Edit OC Submission' : 'Submit Original Character'}</h2>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white transition-colors">
            <Icon n="X" size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-5 space-y-4 custom-scrollbar">
          {!isEdit && (
            <div className="flex items-start gap-2 bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2.5 text-xs text-emerald-800">
              <Icon n="Info" size={14} className="shrink-0 mt-0.5" />
              <span>No Google Doc needed — use the Character Sheet button below to fill in their full sheet right here on the site. It has to be filled in before a reviewer can approve this character.</span>
            </div>
          )}
          <div>
            <label className="text-xs font-bold text-slate-500 uppercase tracking-widest block mb-1.5">OC Name (Mandatory)</label>
            <input
              type="text"
              required
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="e.g. Hana Yuki"
              className="w-full text-sm border border-slate-300 bg-white rounded-xl px-3 py-2 text-slate-800 focus:outline-none focus:border-emerald-500"
            />
          </div>

          {/* Which OC — auto-calculated from the player's existing OCs, shown to reviewers */}
          <div>
            <label className="text-xs font-bold text-slate-500 uppercase tracking-widest block mb-1.5">Which OC is this for you?</label>
            <div className="p-3 rounded-xl border-2 border-slate-200 bg-slate-50 text-sm font-bold text-slate-800 flex items-center gap-2">
              {ocCountLoading ? (
                <><Icon n="Refresh" size={14} className="animate-spin text-slate-400" /> Calculating…</>
              ) : (
                <>Your {ordinalLabel(ocNumber)} OC</>
              )}
            </div>
          </div>

          {/* Ninja rank — each option shows how needed that rank is server-wide */}
          <div>
            <label className="text-xs font-bold text-slate-500 uppercase tracking-widest block mb-1.5">Ninja Rank (Mandatory)</label>
            <div className="grid grid-cols-2 gap-2">
              {OC_RANKS.map(r => {
                const total = rankTotals ? rankTotals[r] : null;
                const badge = rankTotals ? OC_NEED_BADGES[ocNeedLevel(rankTotals[r], rankMax)] : null;
                const active = ninjaRank === r;
                return (
                  <button
                    key={r}
                    type="button"
                    onClick={() => pickRank(r)}
                    className={`text-left p-3 rounded-xl border-2 transition-all ${
                      active ? 'border-emerald-500 bg-emerald-50' : 'border-slate-200 bg-white hover:border-slate-300'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-1">
                      <span className={`text-sm font-bold ${active ? 'text-emerald-800' : 'text-slate-800'}`}>{r}</span>
                      {total !== null && <span className="text-[10px] font-bold text-slate-400 tabular-nums">{total} on server</span>}
                    </div>
                    {badge && (
                      <span className={`inline-block mt-1.5 text-[9px] font-extrabold uppercase tracking-wider px-1.5 py-0.5 rounded border ${badge.cls}`}>
                        {badge.label}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Faction — revealed after a rank is picked, with a balance suggestion */}
          {ninjaRank && (
            <div className="animate-in fade-in slide-in-from-top-2">
              <label className="text-xs font-bold text-slate-500 uppercase tracking-widest block mb-1.5">Faction — Village or Wanderer (Mandatory)</label>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                {OC_VILLAGES.map(v => {
                  const count = rosterCounts ? (rosterCounts[v.id]?.[OC_RANK_KEY[ninjaRank]] || 0) : null;
                  const suggested = suggestedVillage === v.name;
                  const active = village === v.name;
                  return (
                    <button
                      key={v.id}
                      type="button"
                      onClick={() => pickVillage(v.name)}
                      className={`text-left p-3 rounded-xl border-2 transition-all ${
                        active ? 'border-emerald-500 bg-emerald-50' : 'border-slate-200 bg-white hover:border-slate-300'
                      }`}
                    >
                      <span className={`text-sm font-bold block ${active ? 'text-emerald-800' : 'text-slate-800'}`}>{v.name}</span>
                      {count !== null && (
                        <span className="text-[10px] text-slate-400 font-semibold">{count} {ninjaRank}{count === 1 ? '' : 's'}</span>
                      )}
                      {suggested && (
                        <span className="block mt-1">
                          <span className="text-[9px] font-extrabold uppercase tracking-wider px-1.5 py-0.5 rounded border bg-indigo-100 text-indigo-700 border-indigo-200">
                            ★ Suggested for {ninjaRank}
                          </span>
                        </span>
                      )}
                    </button>
                  );
                })}
                {hasWandererTicket && (
                  <button
                    type="button"
                    onClick={() => pickVillage('Wanderer')}
                    className={`text-left p-3 rounded-xl border-2 border-dashed transition-all sm:col-span-3 ${
                      isWanderer ? 'border-emerald-500 bg-emerald-50' : 'border-slate-300 bg-white hover:border-slate-400'
                    }`}
                  >
                    <span className={`text-sm font-bold block ${isWanderer ? 'text-emerald-800' : 'text-slate-800'}`}>Wanderer</span>
                    <span className="text-[10px] text-slate-400 font-semibold">
                      Outside the village system — no squads or council, keeps their ninja rank.
                    </span>
                    {!isEdit && (
                      <span className="block mt-1 text-[9px] font-extrabold uppercase tracking-wider px-1.5 py-0.5 rounded border bg-amber-100 text-amber-700 border-amber-200 w-fit">
                        Uses your one-time ticket
                      </span>
                    )}
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Squad — Genin and Chūnin join an existing squad or start their own */}
          {squadType && village && (
            <div className="animate-in fade-in slide-in-from-top-2">
              <label className="text-xs font-bold text-slate-500 uppercase tracking-widest block mb-1.5">
                {ninjaRank} Squad (Mandatory)
              </label>
              <div className="flex flex-col gap-2">
                {squadGroups.map(g => {
                  const active = squadChoice && !squadChoice.isNew && squadChoice.number === g.number;
                  const recommended = recommendedSquad === g.number;
                  return (
                    <button
                      key={g.number}
                      type="button"
                      onClick={() => setSquadChoice({ number: g.number, isNew: false })}
                      className={`text-left p-3 rounded-xl border-2 transition-all flex items-center justify-between gap-2 ${
                        active ? 'border-emerald-500 bg-emerald-50' : 'border-slate-200 bg-white hover:border-slate-300'
                      }`}
                    >
                      <span>
                        <span className={`text-sm font-bold block ${active ? 'text-emerald-800' : 'text-slate-800'}`}>
                          Squad {g.number}
                        </span>
                        <span className="text-[10px] text-slate-400 font-semibold">
                          {g.members} member{g.members === 1 ? '' : 's'}
                          {g.captain ? ` · led by ${g.captain}` : ' · no captain yet'}
                        </span>
                      </span>
                      {recommended && (
                        <span className="text-[9px] font-extrabold uppercase tracking-wider px-1.5 py-0.5 rounded border bg-indigo-100 text-indigo-700 border-indigo-200 shrink-0">
                          ★ Needs {ninjaRank}s
                        </span>
                      )}
                    </button>
                  );
                })}
                <button
                  type="button"
                  onClick={() => setSquadChoice({ number: nextSquadNumber, isNew: true })}
                  className={`text-left p-3 rounded-xl border-2 border-dashed transition-all ${
                    squadChoice?.isNew ? 'border-emerald-500 bg-emerald-50' : 'border-slate-300 bg-white hover:border-slate-400'
                  }`}
                >
                  <span className={`text-sm font-bold block ${squadChoice?.isNew ? 'text-emerald-800' : 'text-slate-800'}`}>
                    ＋ Start My Own Squad (Squad {nextSquadNumber})
                  </span>
                  <span className="text-[10px] text-slate-400 font-semibold">
                    Begin alone — others can join your squad later.
                  </span>
                </button>
              </div>
            </div>
          )}

          {/* Jōnin / Special Jōnin — optional mentoring + councilor (village-only) */}
          {(ninjaRank === 'Jōnin' || ninjaRank === 'Special Jōnin') && village && !isWanderer && (
            <div className="animate-in fade-in slide-in-from-top-2 space-y-3">
              <div>
                <label className="text-xs font-bold text-slate-500 uppercase tracking-widest block mb-1.5">
                  Mentor a Genin Squad (Optional)
                </label>
                {mentorableSquads.length > 0 ? (
                  <select
                    value={mentorSquad}
                    onChange={e => setMentorSquad(e.target.value)}
                    className="w-full text-sm border border-slate-300 bg-white rounded-xl px-3 py-2.5 text-slate-800 focus:outline-none focus:border-emerald-500"
                  >
                    <option value="">No squad — just take my roster slot</option>
                    {mentorableSquads.map(g => (
                      <option key={g.number} value={g.number}>
                        Genin Squad {g.number} — {g.members} genin, needs a captain
                      </option>
                    ))}
                  </select>
                ) : (
                  <p className="text-xs text-slate-400 bg-slate-50 border border-slate-200 rounded-xl p-2.5">
                    No captainless genin squads in {village} right now — your roster slot will be filled automatically.
                  </p>
                )}
              </div>
              {ninjaRank === 'Jōnin' && (
                <label className="flex items-start gap-2.5 bg-slate-50 border border-slate-200 rounded-xl p-3 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={councilor}
                    onChange={e => setCouncilor(e.target.checked)}
                    className="w-4 h-4 mt-0.5 rounded accent-emerald-600 shrink-0"
                  />
                  <span className="text-xs font-bold text-slate-700">
                    Councilor — member of the Village Council
                    <span className="block text-[10px] font-semibold text-slate-400 mt-0.5">
                      Symbolic rank: you stay a Jōnin and are also listed in the Village Council.
                    </span>
                  </span>
                </label>
              )}
            </div>
          )}

          {/* Bloodline — full bloodlines are blocked, low bloodlines require a reservation */}
          <div>
            <label className="text-xs font-bold text-slate-500 uppercase tracking-widest block mb-1.5">Bloodline</label>
            <select
              value={bloodline}
              onChange={e => setBloodline(e.target.value)}
              className="w-full text-sm border border-slate-300 bg-white rounded-xl px-3 py-2.5 text-slate-800 focus:outline-none focus:border-emerald-500"
            >
              <option value={CLANLESS}>Clanless — Unlimited</option>
              {bloodlineOptions.map(({ name: blName, info }) => (
                <option key={blName} value={blName} disabled={info.status === 'full'}>
                  {blName}
                  {info.unlimited ? ' — Unlimited'
                    : info.status === 'full' ? ' — FULL'
                    : info.status === 'limited' ? ` — ${info.remaining} left · Reservation Required`
                    : ` — ${info.remaining} left`}
                </option>
              ))}
            </select>
            {bloodlineFull && (
              <p className="text-xs font-bold text-rose-600 bg-rose-50 border border-rose-200 rounded-xl p-2.5 mt-2">
                This bloodline is full — every slot is taken or reserved. Pick another bloodline, or check back when a slot opens.
              </p>
            )}
            {needsReservation && (
              <div className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-xl p-3 mt-2 space-y-1">
                <p className="font-bold">⏳ Réservation Request</p>
                <p>
                  <strong>{bloodline}</strong> has only {selectedInfo.remaining} slot{selectedInfo.remaining === 1 ? '' : 's'} left, so this
                  will be submitted as a reservation request. A reviewer must grant your reservation — once granted, you have{' '}
                  <strong>48 hours</strong> to complete your OC sheet. Reviewers can extend the deadline if your sheet shows real progress.
                </p>
              </div>
            )}
          </div>

          {/* Character Sheet — mirrors the jutsu form's "Add Documentation" button */}
          {!isEdit && (
            <div className="p-4 bg-slate-50 border rounded-2xl">
              <p className="text-sm font-bold text-slate-800">Character Sheet</p>
              <p className="text-xs text-slate-500 mb-3">
                Required before a reviewer can approve this character. Fill it in now, or later from the Inbox.
              </p>
              <button
                type="button"
                onClick={() => setSheetEditorOpen(true)}
                disabled={!name.trim()}
                title={!name.trim() ? 'Enter a character name first' : undefined}
                className="bg-white border-2 border-emerald-200 text-emerald-700 px-4 py-2 rounded-xl font-bold text-sm hover:bg-emerald-50 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
              >
                <Icon n="Edit" size={14}/> {sheetFilled ? 'Edit Character Sheet' : 'Add Character Sheet'}
              </button>
            </div>
          )}

          <div className="flex justify-end gap-3 pt-2 border-t border-slate-100 shrink-0">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm font-bold text-slate-600 hover:bg-slate-50 rounded-xl transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitDisabled}
              className="px-5 py-2.5 rounded-xl text-sm font-bold transition-all shadow-md bg-emerald-600 hover:bg-emerald-700 text-white disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {submitting
                ? (isEdit ? 'Saving...' : 'Submitting...')
                : isEdit ? 'Save Changes'
                : needsReservation ? 'Submit Réservation Request'
                : 'Submit for Review'}
            </button>
          </div>
        </form>
      </div>
    </div>
    {sheetEditorOpen && (
      <CharacterSheetModal
        characterName={name.trim()}
        currentUserId={profile?.id}
        ownerIdHint={profile?.id}
        jutsus={jutsus}
        prefill={{
          village,
          shinobi_rank: ninjaRank,
          clan_kkg: bloodline && bloodline !== CLANLESS ? bloodline : '',
          oc_number: ocNumber || null,
        }}
        onClose={() => setSheetEditorOpen(false)}
        onSaved={() => setSheetFilled(true)}
      />
    )}
    </>
  );
}

/* ============================================================================
   MODAL: SlotsViewModal
   ============================================================================ */

export default OCSubmissionModal;
