/*
 * RP Hub — the Phase-1 grading & upgrade pipeline, on-site.
 *
 * Four views behind one tab:
 *   Wallet   (everyone)   — per-OC credit ledger, cycle usage, upgrade requests
 *   Submit   (everyone)   — the RP grading submission form (replaces
 *                           #rp-grading-submission)
 *   Grading  (grader+)    — Gate 1: read the Discord thread, set SoL /
 *                           per-player eligible tags, approve → credits minted
 *   Upgrades (reviewer+)  — Gate 2: soft-warning panel, approve-with-override /
 *                           reject / revert; approval auto-updates the sheet
 *
 * The human read step stays on Discord: graders open the thread link. The
 * site structures the data, computes costs, warns (never blocks — reviewers
 * override with a logged reason), mints/spends credits, and writes approved
 * upgrades to the character sheet atomically.
 */

import { useState, useEffect, useMemo, useCallback } from 'react';
import { Icon } from '../components/ui/Icon';
import {
  isSupabaseConfigured, getCurrentSession,
  fetchMyCharacterSheets, fetchCharacterSheetIndex, fetchAllProfiles,
  fetchRpSubmissions, submitRpSubmission, cancelRpSubmission, gradeRpSubmission,
  fetchCreditsForCharacters, fetchUpgradeRequests, submitUpgradeRequest,
  cancelUpgradeRequest, approveUpgradeRequest, rejectUpgradeRequest,
  revertUpgrade, fetchApprovedThisCycle,
} from '../lib/supabase';
import { normalizeSheet, JUTSU_RANKS } from '../constants/characterSheet';
import {
  TRAINABLE_TAGS, RP_TYPES, WEEKLY_UPGRADE_CAP, GRADER_CHECKLIST,
  UPGRADE_STATS, UPGRADE_SKILLS,
  buildStatTarget, buildSkillTarget, buildDojutsuTarget, buildJutsuTarget,
  computeUpgradeWarnings,
} from '../constants/upgradeRules';

const displayName = (p) => p?.site_nickname || p?.username || 'Unknown';

const fmtDate = (ts) => ts ? new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '—';

const authHeaders = async () => {
  const sess = await getCurrentSession();
  return sess?.access_token ? { Authorization: `Bearer ${sess.access_token}` } : {};
};

// Best-effort Discord notifications — the pipeline works without them.
const pingReviewers = async (triggerType, itemName, submitterName) => {
  try {
    const hdrs = await authHeaders();
    fetch('/.netlify/functions/reviewer-ping', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...hdrs },
      body: JSON.stringify({ triggerType, itemName, itemType: 'RP', submitterName }),
    }).catch(err => console.warn('[NARP] RP ping failed:', err));
  } catch { /* best-effort */ }
};

const dmUser = async (discordUserId, message) => {
  if (!discordUserId) return;
  try {
    const hdrs = await authHeaders();
    fetch('/.netlify/functions/discord-dm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...hdrs },
      body: JSON.stringify({ discordUserId, message }),
    }).catch(err => console.warn('[NARP] RP verdict DM failed:', err));
  } catch { /* best-effort */ }
};

/* ── Small shared pieces ─────────────────────────────────────────────────── */

function TagChips({ options, selected, onToggle, disabled }) {
  return (
    <div className="flex flex-wrap gap-1">
      {options.map(t => {
        const on = selected.includes(t);
        return (
          <button key={t} type="button" disabled={disabled}
            onClick={() => onToggle(t)}
            className={`text-[10px] font-bold px-2 py-0.5 rounded-full border transition-colors ${
              on ? 'bg-indigo-600 text-white border-indigo-600'
                 : 'bg-white text-slate-500 border-slate-200 hover:border-indigo-300'
            } ${disabled ? 'opacity-60 cursor-default' : ''}`}>
            {t}
          </button>
        );
      })}
    </div>
  );
}

function StatusBadge({ status }) {
  const map = {
    pending:  'bg-amber-100 text-amber-800 border-amber-200',
    graded:   'bg-emerald-100 text-emerald-800 border-emerald-200',
    approved: 'bg-emerald-100 text-emerald-800 border-emerald-200',
    rejected: 'bg-rose-100 text-rose-800 border-rose-200',
    reverted: 'bg-slate-200 text-slate-600 border-slate-300',
  };
  return (
    <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded border ${map[status] || map.pending}`}>
      {status}
    </span>
  );
}

function WarningPanel({ warnings }) {
  if (!warnings?.length) return (
    <div className="flex items-center gap-2 text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2 text-xs font-semibold">
      <Icon n="CheckCir" size={14} /> All rule checks pass.
    </div>
  );
  return (
    <div className="bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 space-y-1">
      {warnings.map((w, i) => (
        <div key={i} className="flex items-start gap-2 text-xs text-amber-900">
          <Icon n="Alert" size={13} className="mt-0.5 shrink-0 text-amber-600" />
          <span><span className="font-bold uppercase text-[10px] mr-1">{String(w.code || '').replace(/_/g, ' ')}</span>{w.message}</span>
        </div>
      ))}
      <p className="text-[10px] text-amber-700 font-semibold pt-0.5">
        Warnings never block — the reviewer can approve with a logged override reason.
      </p>
    </div>
  );
}

function CreditPill({ credit }) {
  const spent = credit.status === 'spent';
  return (
    <div className={`rounded-xl border px-3 py-2 ${spent ? 'bg-slate-50 border-slate-200 opacity-70' : 'bg-white border-indigo-200'}`}>
      <div className="flex items-center justify-between gap-2">
        <span className={`text-[10px] font-black uppercase tracking-wider ${spent ? 'text-slate-400' : 'text-indigo-600'}`}>
          {spent ? 'Spent' : 'Unspent'} · {credit.credit_value} credit{credit.credit_value > 1 ? 's' : ''}
        </span>
        <span className="text-[10px] text-slate-400">{fmtDate(credit.created_at)}</span>
      </div>
      <div className="mt-1 flex flex-wrap gap-1">
        {(credit.eligible_tags || []).length
          ? credit.eligible_tags.map(t => (
              <span key={t} className="text-[10px] font-bold bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded">{t}</span>
            ))
          : <span className="text-[10px] italic text-slate-400">No eligible tags (record-only)</span>}
      </div>
      {credit.submission && (
        <div className="mt-1 text-[10px] text-slate-500 flex items-center gap-1.5 flex-wrap">
          <span className="font-semibold">{credit.submission.rp_type} RP</span>
          {credit.submission.thread_url && (
            <a href={credit.submission.thread_url} target="_blank" rel="noreferrer"
               className="text-indigo-500 hover:text-indigo-700 inline-flex items-center gap-0.5">
              thread <Icon n="ExtLink" size={9} />
            </a>
          )}
          {credit.submission.grader_notes && (
            <span className="italic text-slate-400 truncate max-w-[16rem]" title={credit.submission.grader_notes}>
              “{credit.submission.grader_notes}”
            </span>
          )}
        </div>
      )}
    </div>
  );
}

/* ── The page ────────────────────────────────────────────────────────────── */

export default function RpHubPage({ profile, role, jutsus = [] }) {
  const supabaseReady = isSupabaseConfigured();
  const isGrader = ['grader', 'reviewer', 'admin', 'owner'].includes(role);
  const isReviewer = ['reviewer', 'admin', 'owner'].includes(role);

  const [view, setView] = useState('wallet');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState(null);

  const [myChars, setMyChars] = useState([]);
  const [allSheets, setAllSheets] = useState([]);
  const [profiles, setProfiles] = useState([]);
  const [submissions, setSubmissions] = useState([]);
  const [credits, setCredits] = useState([]);
  const [requests, setRequests] = useState([]);
  const [cycleUsed, setCycleUsed] = useState({});
  const [selectedCharId, setSelectedCharId] = useState(null);

  const reload = useCallback(async () => {
    if (!supabaseReady || !profile?.id) { setLoading(false); return; }
    setLoading(true);
    setError('');
    try {
      const [chars, sheetIndex, profs, subs, reqs] = await Promise.all([
        fetchMyCharacterSheets(),
        fetchCharacterSheetIndex(),
        fetchAllProfiles().catch(() => []),
        fetchRpSubmissions(),
        fetchUpgradeRequests(),
      ]);
      setMyChars(chars);
      setAllSheets(Object.values(sheetIndex).sort((a, b) => (a.character_name || '').localeCompare(b.character_name || '')));
      setProfiles(profs);
      setSubmissions(subs);
      setRequests(reqs);
      setSelectedCharId(prev => prev && chars.some(c => c.id === prev) ? prev : (chars[0]?.id || null));

      // Credits: own characters, plus (for reviewers) every character with a
      // pending request, so the warning panel can resolve attached credits.
      const creditCharIds = new Set(chars.map(c => c.id));
      if (['reviewer', 'admin', 'owner'].includes(role)) {
        reqs.filter(r => r.status === 'pending' || r.status === 'approved').forEach(r => creditCharIds.add(r.character_id));
      }
      const creds = await fetchCreditsForCharacters([...creditCharIds]);
      setCredits(creds);

      // Cycle usage for own chars + pending-request chars.
      const cycleIds = new Set([...chars.map(c => c.id), ...reqs.filter(r => r.status === 'pending').map(r => r.character_id)]);
      const usage = {};
      await Promise.all([...cycleIds].map(async id => { usage[id] = await fetchApprovedThisCycle(id); }));
      setCycleUsed(usage);
    } catch (err) {
      console.warn('[NARP] RP hub load failed:', err);
      setError(err.message || 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [supabaseReady, profile?.id, role]);

  useEffect(() => { reload(); }, [reload]);

  const creditsByChar = useMemo(() => {
    const map = {};
    for (const c of credits) (map[c.character_id] = map[c.character_id] || []).push(c);
    return map;
  }, [credits]);

  const creditById = useMemo(() => Object.fromEntries(credits.map(c => [c.id, c])), [credits]);

  const pendingQueue = useMemo(() => submissions.filter(s => s.status === 'pending'), [submissions]);
  const mySubmissions = useMemo(
    () => submissions.filter(s => s.submitter_id === profile?.id || (s.participants || []).some(p => p.user_id === profile?.id)),
    [submissions, profile?.id]
  );
  const pendingRequests = useMemo(() => requests.filter(r => r.status === 'pending'), [requests]);
  const revertableRequests = useMemo(() => requests.filter(r => r.status === 'approved').slice(0, 15), [requests]);
  const myRequests = useMemo(
    () => requests.filter(r => r.requester_id === profile?.id || myChars.some(c => c.id === r.character_id)),
    [requests, profile?.id, myChars]
  );

  if (!supabaseReady) {
    return (
      <div className="max-w-3xl mx-auto bg-white rounded-3xl border border-slate-200 p-8 text-center text-sm text-slate-500">
        The RP grading &amp; upgrade system needs the Supabase backend — it isn't available in local dev mode.
      </div>
    );
  }
  if (!profile) {
    return (
      <div className="max-w-3xl mx-auto bg-white rounded-3xl border border-slate-200 p-8 text-center text-sm text-slate-500">
        Sign in with Discord to use the RP grading &amp; upgrade system.
      </div>
    );
  }

  const VIEWS = [
    { id: 'wallet', label: 'My Wallet' },
    { id: 'submit', label: 'Submit RP' },
    ...(isGrader ? [{ id: 'grading', label: 'Grading Queue', count: pendingQueue.length }] : []),
    ...(isReviewer ? [{ id: 'upgrades', label: 'Upgrade Queue', count: pendingRequests.length }] : []),
  ];

  return (
    <div className="max-w-5xl mx-auto space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {VIEWS.map(v => (
          <button key={v.id} type="button" onClick={() => setView(v.id)}
            className={`text-xs font-bold uppercase tracking-wider px-3.5 py-2 rounded-xl border transition-colors ${
              view === v.id ? 'bg-slate-900 text-white border-slate-900'
                            : 'bg-white text-slate-600 border-slate-200 hover:border-slate-400'
            }`}>
            {v.label}
            {v.count > 0 && (
              <span className="ml-1.5 bg-amber-400 text-amber-950 rounded-full px-1.5 py-0.5 text-[10px]">{v.count}</span>
            )}
          </button>
        ))}
        <button type="button" onClick={reload} disabled={loading}
          className="ml-auto text-xs font-bold text-slate-500 hover:text-slate-800 flex items-center gap-1.5 px-2 py-2">
          <Icon n="Refresh" size={13} className={loading ? 'animate-spin' : ''} /> Refresh
        </button>
      </div>

      {error && (
        <div className="bg-rose-50 border border-rose-200 text-rose-800 text-xs font-semibold rounded-xl px-3 py-2">{error}</div>
      )}

      {loading ? (
        <div className="bg-white rounded-3xl border border-slate-200 p-10 text-center">
          <div className="w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin mx-auto" />
        </div>
      ) : (
        <>
          {view === 'wallet' && (
            <WalletView
              myChars={myChars} selectedCharId={selectedCharId} setSelectedCharId={setSelectedCharId}
              creditsByChar={creditsByChar} cycleUsed={cycleUsed} myRequests={myRequests}
              jutsus={jutsus} profile={profile}
              onCancelRequest={async (id) => {
                setBusyId(id);
                try { await cancelUpgradeRequest(id); await reload(); }
                catch (err) { alert('Cancel failed: ' + err.message); }
                finally { setBusyId(null); }
              }}
              onSubmitted={reload}
              busyId={busyId}
            />
          )}

          {view === 'submit' && (
            <SubmitRpView
              profile={profile} profiles={profiles} allSheets={allSheets}
              mySubmissions={mySubmissions}
              onCancel={async (id) => {
                setBusyId(id);
                try { await cancelRpSubmission(id); await reload(); }
                catch (err) { alert('Cancel failed: ' + err.message); }
                finally { setBusyId(null); }
              }}
              onSubmitted={reload}
              busyId={busyId}
            />
          )}

          {view === 'grading' && isGrader && (
            <GradingQueueView
              queue={pendingQueue} profile={profile}
              onGraded={reload} busyId={busyId} setBusyId={setBusyId}
            />
          )}

          {view === 'upgrades' && isReviewer && (
            <UpgradeQueueView
              pending={pendingRequests} revertable={revertableRequests}
              creditById={creditById} cycleUsed={cycleUsed} profile={profile}
              onReviewed={reload} busyId={busyId} setBusyId={setBusyId}
            />
          )}
        </>
      )}
    </div>
  );
}

/* ── Wallet ──────────────────────────────────────────────────────────────── */

function WalletView({ myChars, selectedCharId, setSelectedCharId, creditsByChar, cycleUsed, myRequests, jutsus, profile, onCancelRequest, onSubmitted, busyId }) {
  const [requesting, setRequesting] = useState(false);
  const char = myChars.find(c => c.id === selectedCharId) || null;
  const charCredits = creditsByChar[selectedCharId] || [];
  const unspent = charCredits.filter(c => c.status === 'unspent');
  const used = cycleUsed[selectedCharId] ?? 0;
  const charRequests = myRequests.filter(r => r.character_id === selectedCharId);

  if (!myChars.length) {
    return (
      <div className="bg-white rounded-3xl border border-slate-200 p-8 text-center text-sm text-slate-500">
        You don't have a character sheet yet. Credits attach to characters — create your OC's sheet
        (Roster tab → your character) and it will show up here.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-3xl border border-slate-200 shadow-xs overflow-hidden">
        <div className="bg-slate-900 text-white p-4 flex flex-wrap items-center gap-3">
          <Icon n="Shield" size={18} className="text-indigo-400" />
          <h3 className="font-bold font-serif">Character Wallet</h3>
          <select value={selectedCharId || ''} onChange={e => setSelectedCharId(e.target.value)}
            className="ml-auto text-xs bg-slate-800 border border-slate-700 rounded-lg px-2.5 py-1.5 text-white focus:outline-none">
            {myChars.map(c => <option key={c.id} value={c.id}>{c.character_name}</option>)}
          </select>
        </div>

        <div className="p-4 grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="rounded-2xl border border-slate-200 p-3">
            <div className="text-[10px] font-black uppercase tracking-wider text-slate-400">Unspent credits</div>
            <div className="text-2xl font-black text-indigo-600">{unspent.reduce((s, c) => s + (c.credit_value || 1), 0)}</div>
          </div>
          <div className="rounded-2xl border border-slate-200 p-3">
            <div className="text-[10px] font-black uppercase tracking-wider text-slate-400">Grants this cycle</div>
            <div className="text-2xl font-black text-slate-800">{used} <span className="text-sm text-slate-400 font-bold">of {WEEKLY_UPGRADE_CAP}</span></div>
            <div className="text-[10px] text-slate-400">Resets Monday 00:00 ET</div>
          </div>
          <div className="rounded-2xl border border-slate-200 p-3">
            <div className="text-[10px] font-black uppercase tracking-wider text-slate-400">Rank</div>
            <div className="text-lg font-bold text-slate-800">{char?.ninja_rank || '—'}</div>
          </div>
        </div>

        <div className="px-4 pb-4">
          <button type="button" onClick={() => setRequesting(r => !r)}
            className="w-full sm:w-auto bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold uppercase tracking-wider px-4 py-2.5 rounded-xl flex items-center justify-center gap-1.5">
            <Icon n="Plus" size={13} /> {requesting ? 'Close request form' : 'Request an upgrade'}
          </button>
        </div>

        {requesting && char && (
          <div className="border-t border-slate-100 p-4">
            <UpgradeRequestForm
              char={char} unspentCredits={unspent} cycleUsedCount={used}
              jutsus={jutsus} profile={profile}
              onDone={() => { setRequesting(false); onSubmitted(); }}
            />
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-white rounded-3xl border border-slate-200 p-4 space-y-2">
          <h4 className="text-xs font-black uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
            <Icon n="Tag" size={13} /> Credit ledger
          </h4>
          {charCredits.length
            ? charCredits.map(c => <CreditPill key={c.id} credit={c} />)
            : <p className="text-xs text-slate-400 italic">No credits yet — submit an RP for grading to earn one.</p>}
        </div>

        <div className="bg-white rounded-3xl border border-slate-200 p-4 space-y-2">
          <h4 className="text-xs font-black uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
            <Icon n="Clock" size={13} /> Upgrade history
          </h4>
          {charRequests.length ? charRequests.map(r => (
            <div key={r.id} className="rounded-xl border border-slate-200 px-3 py-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-bold text-slate-700">{r.target?.label || r.upgrade_type}</span>
                <StatusBadge status={r.status} />
              </div>
              <div className="text-[10px] text-slate-400 mt-0.5">
                {r.computed_cost} credit{r.computed_cost > 1 ? 's' : ''} · requested {fmtDate(r.created_at)}
                {r.reviewed_at && <> · reviewed {fmtDate(r.reviewed_at)}</>}
              </div>
              {r.review_note && <div className="text-[10px] text-rose-600 mt-0.5">Reviewer: {r.review_note}</div>}
              {r.override_reason && <div className="text-[10px] text-amber-700 mt-0.5">Override: {r.override_reason}</div>}
              {r.status === 'pending' && (
                <button type="button" disabled={busyId === r.id} onClick={() => onCancelRequest(r.id)}
                  className="mt-1.5 text-[10px] font-bold text-rose-500 hover:text-rose-700">
                  Cancel request
                </button>
              )}
            </div>
          )) : <p className="text-xs text-slate-400 italic">No upgrade requests yet.</p>}
        </div>
      </div>
    </div>
  );
}

/* ── Upgrade request form (player, Gate 2 entry) ─────────────────────────── */

function UpgradeRequestForm({ char, unspentCredits, cycleUsedCount, jutsus, profile, onDone }) {
  const sheet = useMemo(() => normalizeSheet(char.data), [char.data]);
  const [upgradeType, setUpgradeType] = useState('stat');
  const [fieldKey, setFieldKey] = useState(UPGRADE_STATS[0].key);
  const [jutsuName, setJutsuName] = useState('');
  const [jutsuRank, setJutsuRank] = useState('D');
  const [dropIndex, setDropIndex] = useState('');
  const [attached, setAttached] = useState([]);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  const catalogMatch = useMemo(
    () => jutsus.find(j => (j.name || '').toLowerCase() === jutsuName.trim().toLowerCase()),
    [jutsus, jutsuName]
  );

  const target = useMemo(() => {
    if (upgradeType === 'stat') return buildStatTarget(sheet, fieldKey);
    if (upgradeType === 'skill') return buildSkillTarget(sheet, fieldKey);
    if (upgradeType === 'dojutsu_skill') return buildDojutsuTarget(sheet);
    if (upgradeType === 'jutsu') {
      return buildJutsuTarget(sheet, {
        name: jutsuName.trim(),
        rank: jutsuRank,
        nature: catalogMatch?.nature || '',
        dropIndex: dropIndex === '' ? undefined : Number(dropIndex),
      });
    }
    return null;
  }, [upgradeType, fieldKey, sheet, jutsuName, jutsuRank, dropIndex, catalogMatch]);

  const attachedCredits = unspentCredits.filter(c => attached.includes(c.id));
  const warnings = useMemo(() => target ? computeUpgradeWarnings({
    sheet, upgradeType, target, attachedCredits, approvedThisCycle: cycleUsedCount,
  }) : [], [sheet, upgradeType, target, attachedCredits, cycleUsedCount]);

  // Which credits could pay for this target (tag match) — shown first.
  const tagLc = (target?.tag || '').toLowerCase();
  const eligible = unspentCredits.filter(c => (c.eligible_tags || []).some(t => t.toLowerCase() === tagLc));
  const others = unspentCredits.filter(c => !eligible.includes(c));

  const filledJutsu = sheet.techniques.jutsu.map((j, i) => ({ ...j, i })).filter(j => j.name);

  const changeType = (t) => {
    setUpgradeType(t);
    setErr('');
    if (t === 'stat') setFieldKey(UPGRADE_STATS[0].key);
    if (t === 'skill') setFieldKey(UPGRADE_SKILLS[0].key);
  };

  const submit = async () => {
    if (!target) { setErr('Pick a valid upgrade target.'); return; }
    if (!attached.length) { setErr('Attach at least one credit.'); return; }
    setSaving(true);
    setErr('');
    try {
      await submitUpgradeRequest({
        characterId: char.id,
        upgradeType,
        target,
        computedCost: target.cost,
        attachedCreditIds: attached,
        warnings,
      });
      pingReviewers('upgrade_request', `${char.character_name}: ${target.label}`, displayName(profile));
      onDone();
    } catch (e) {
      setErr(e.message || 'Failed to submit');
    } finally {
      setSaving(false);
    }
  };

  const typeOptions = [
    { id: 'stat', label: 'Stat' },
    { id: 'skill', label: 'Skill' },
    ...(sheet.limited.dojutsu_name ? [{ id: 'dojutsu_skill', label: 'Dojutsu skill' }] : []),
    { id: 'jutsu', label: 'New jutsu' },
  ];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1.5">
        {typeOptions.map(t => (
          <button key={t.id} type="button" onClick={() => changeType(t.id)}
            className={`text-[10px] font-bold uppercase px-3 py-1.5 rounded-lg border ${
              upgradeType === t.id ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-slate-500 border-slate-200'
            }`}>
            {t.label}
          </button>
        ))}
      </div>

      {(upgradeType === 'stat' || upgradeType === 'skill') && (
        <select value={fieldKey} onChange={e => setFieldKey(e.target.value)}
          className="w-full sm:w-72 text-xs border border-slate-200 rounded-xl px-3 py-2 bg-white">
          {(upgradeType === 'stat' ? UPGRADE_STATS : UPGRADE_SKILLS).map(s => {
            const t = upgradeType === 'stat' ? buildStatTarget(sheet, s.key) : buildSkillTarget(sheet, s.key);
            return (
              <option key={s.key} value={s.key} disabled={!t}>
                {t ? t.label : `${s.label} (maxed)`}
              </option>
            );
          })}
        </select>
      )}

      {upgradeType === 'jutsu' && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          <div className="sm:col-span-2">
            <input list="rp-jutsu-catalog" value={jutsuName} onChange={e => setJutsuName(e.target.value)}
              placeholder="Jutsu name (from the database)"
              className="w-full text-xs border border-slate-200 rounded-xl px-3 py-2" />
            <datalist id="rp-jutsu-catalog">
              {jutsus.slice(0, 400).map(j => <option key={j._id || j.id || j.name} value={j.name} />)}
            </datalist>
          </div>
          <select value={jutsuRank} onChange={e => setJutsuRank(e.target.value)}
            className="text-xs border border-slate-200 rounded-xl px-3 py-2 bg-white">
            {(catalogMatch?.rank?.length ? catalogMatch.rank : JUTSU_RANKS).map(r => (
              <option key={r} value={r}>{r}-rank</option>
            ))}
          </select>
          <div className="sm:col-span-3">
            <label className="text-[10px] font-bold uppercase text-slate-400">Drop a jutsu (only if no free slot)</label>
            <select value={dropIndex} onChange={e => setDropIndex(e.target.value)}
              className="w-full text-xs border border-slate-200 rounded-xl px-3 py-2 bg-white mt-1">
              <option value="">— keep everything, use a free slot —</option>
              {filledJutsu.map(j => (
                <option key={j.i} value={j.i}>Drop: {j.name} ({j.rank || '?'})</option>
              ))}
            </select>
          </div>
        </div>
      )}

      {target ? (
        <div className="text-xs font-bold text-slate-700 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 flex items-center justify-between">
          <span>{target.label}</span>
          <span className="text-indigo-600">{target.cost} credit{target.cost > 1 ? 's' : ''}</span>
        </div>
      ) : (
        <p className="text-xs text-slate-400 italic">
          {upgradeType === 'jutsu' ? 'Enter the jutsu to learn.' : 'This field is already maxed out.'}
        </p>
      )}

      <div>
        <label className="text-[10px] font-bold uppercase text-slate-400">Attach credits (each is single-use — spent whole)</label>
        <div className="mt-1 space-y-1.5">
          {[...eligible, ...others].map(c => (
            <label key={c.id} className={`flex items-start gap-2 rounded-xl border px-3 py-2 cursor-pointer ${
              attached.includes(c.id) ? 'border-indigo-400 bg-indigo-50' : 'border-slate-200 bg-white'
            }`}>
              <input type="checkbox" checked={attached.includes(c.id)}
                onChange={() => setAttached(a => a.includes(c.id) ? a.filter(x => x !== c.id) : [...a, c.id])}
                className="mt-0.5" />
              <div className="flex-1 min-w-0">
                <div className="text-[10px] font-bold text-slate-600">
                  {c.credit_value} credit{c.credit_value > 1 ? 's' : ''} · {c.submission?.rp_type || 'RP'} · {fmtDate(c.created_at)}
                  {!eligible.includes(c) && <span className="ml-1.5 text-amber-600">(tag mismatch)</span>}
                </div>
                <div className="flex flex-wrap gap-1 mt-0.5">
                  {(c.eligible_tags || []).map(t => (
                    <span key={t} className="text-[10px] bg-slate-100 text-slate-500 font-bold px-1.5 rounded">{t}</span>
                  ))}
                </div>
              </div>
            </label>
          ))}
          {!unspentCredits.length && <p className="text-xs text-slate-400 italic">No unspent credits for this character.</p>}
        </div>
      </div>

      <WarningPanel warnings={warnings} />

      {err && <p className="text-xs text-rose-600 font-semibold">{err}</p>}
      <button type="button" disabled={saving || !target || !attached.length} onClick={submit}
        className="bg-slate-900 hover:bg-slate-700 text-white text-xs font-bold uppercase tracking-wider px-4 py-2.5 rounded-xl disabled:opacity-50">
        {saving ? 'Submitting…' : 'Submit upgrade request'}
      </button>
    </div>
  );
}

/* ── Submit RP (player, Gate 1 entry) ────────────────────────────────────── */

const emptyParticipant = () => ({ userId: '', characterId: '', claimedTags: [] });

function SubmitRpView({ profile, profiles, allSheets, mySubmissions, onCancel, onSubmitted, busyId }) {
  const [rpType, setRpType] = useState('Regular');
  const [description, setDescription] = useState('');
  const [threadUrl, setThreadUrl] = useState('');
  const [participants, setParticipants] = useState([emptyParticipant()]);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  const profById = useMemo(() => Object.fromEntries(profiles.map(p => [p.id, p])), [profiles]);

  const setPart = (i, patch) => setParticipants(ps => ps.map((p, j) => j === i ? { ...p, ...patch } : p));

  const valid = threadUrl.trim() && description.trim()
    && participants.length > 0
    && participants.every(p => p.userId && p.characterId);

  const submit = async () => {
    if (!valid) { setErr('Fill in the thread link, description, and every participant (account + OC).'); return; }
    setSaving(true);
    setErr('');
    try {
      await submitRpSubmission({
        rpType,
        description,
        threadUrl,
        participants: participants.map(p => ({
          userId: p.userId,
          discordUserId: profById[p.userId]?.discord_id || '',
          characterId: p.characterId,
          claimedTags: p.claimedTags,
        })),
      });
      pingReviewers('rp_submission', description.slice(0, 80) || 'RP submission', displayName(profile));
      setDescription(''); setThreadUrl(''); setParticipants([emptyParticipant()]);
      onSubmitted();
    } catch (e) {
      setErr(e.message || 'Failed to submit');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-3xl border border-slate-200 shadow-xs overflow-hidden">
        <div className="bg-slate-900 text-white p-4 flex items-center gap-2">
          <Icon n="Edit" size={16} className="text-indigo-400" />
          <h3 className="font-bold font-serif">Submit an RP for grading</h3>
        </div>
        <div className="p-4 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <select value={rpType} onChange={e => setRpType(e.target.value)}
              className="text-xs border border-slate-200 rounded-xl px-3 py-2 bg-white">
              {RP_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
            <input value={threadUrl} onChange={e => setThreadUrl(e.target.value)}
              placeholder="Discord thread / forum link (the grader reads this)"
              className="sm:col-span-2 text-xs border border-slate-200 rounded-xl px-3 py-2" />
          </div>
          <input value={description} onChange={e => setDescription(e.target.value)} maxLength={200}
            placeholder="One-line description of the RP"
            className="w-full text-xs border border-slate-200 rounded-xl px-3 py-2" />

          <div className="space-y-2">
            <label className="text-[10px] font-bold uppercase text-slate-400">
              Participants — Discord account + OC, plus the stats/skills this RP should count toward
            </label>
            {participants.map((p, i) => (
              <div key={i} className="rounded-2xl border border-slate-200 p-3 space-y-2">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <select value={p.userId} onChange={e => setPart(i, { userId: e.target.value })}
                    className="text-xs border border-slate-200 rounded-xl px-3 py-2 bg-white">
                    <option value="">— player account —</option>
                    {profiles.map(pr => (
                      <option key={pr.id} value={pr.id}>{displayName(pr)}</option>
                    ))}
                  </select>
                  <select value={p.characterId} onChange={e => setPart(i, { characterId: e.target.value })}
                    className="text-xs border border-slate-200 rounded-xl px-3 py-2 bg-white">
                    <option value="">— character (OC) —</option>
                    {allSheets.map(s => (
                      <option key={s.id} value={s.id}>{s.character_name}{s.ninja_rank ? ` (${s.ninja_rank})` : ''}</option>
                    ))}
                  </select>
                </div>
                <TagChips options={TRAINABLE_TAGS} selected={p.claimedTags}
                  onToggle={(t) => setPart(i, {
                    claimedTags: p.claimedTags.includes(t) ? p.claimedTags.filter(x => x !== t) : [...p.claimedTags, t],
                  })} />
                {participants.length > 1 && (
                  <button type="button" onClick={() => setParticipants(ps => ps.filter((_, j) => j !== i))}
                    className="text-[10px] font-bold text-rose-500 hover:text-rose-700">Remove participant</button>
                )}
              </div>
            ))}
            <button type="button" onClick={() => setParticipants(ps => [...ps, emptyParticipant()])}
              className="text-xs font-bold text-indigo-600 hover:text-indigo-800 flex items-center gap-1">
              <Icon n="Plus" size={12} /> Add participant
            </button>
          </div>

          {err && <p className="text-xs text-rose-600 font-semibold">{err}</p>}
          <button type="button" disabled={saving || !valid} onClick={submit}
            className="bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold uppercase tracking-wider px-4 py-2.5 rounded-xl disabled:opacity-50">
            {saving ? 'Submitting…' : 'Submit for grading'}
          </button>
        </div>
      </div>

      <div className="bg-white rounded-3xl border border-slate-200 p-4 space-y-2">
        <h4 className="text-xs font-black uppercase tracking-wider text-slate-500">My RP submissions</h4>
        {mySubmissions.length ? mySubmissions.map(s => (
          <div key={s.id} className="rounded-xl border border-slate-200 px-3 py-2">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <span className="text-xs font-bold text-slate-700">{s.rp_type} · {s.description || 'RP'}</span>
              <div className="flex items-center gap-2">
                {s.sol_only && s.status === 'graded' && (
                  <span className="text-[10px] font-bold uppercase bg-slate-100 text-slate-500 px-2 py-0.5 rounded border border-slate-200">SoL — no credit</span>
                )}
                <StatusBadge status={s.status} />
              </div>
            </div>
            <div className="text-[10px] text-slate-400 mt-0.5 flex items-center gap-2 flex-wrap">
              <span>{(s.participants || []).map(p => p.character?.character_name || '?').join(', ')}</span>
              {s.thread_url && (
                <a href={s.thread_url} target="_blank" rel="noreferrer" className="text-indigo-500 hover:text-indigo-700 inline-flex items-center gap-0.5">
                  thread <Icon n="ExtLink" size={9} />
                </a>
              )}
              <span>{fmtDate(s.created_at)}</span>
            </div>
            {s.grader_notes && s.status !== 'pending' && (
              <div className="text-[10px] text-slate-500 italic mt-0.5">Grader: “{s.grader_notes}”</div>
            )}
            {s.status === 'pending' && s.submitter_id === profile.id && (
              <button type="button" disabled={busyId === s.id} onClick={() => onCancel(s.id)}
                className="mt-1 text-[10px] font-bold text-rose-500 hover:text-rose-700">Retract submission</button>
            )}
          </div>
        )) : <p className="text-xs text-slate-400 italic">Nothing submitted yet.</p>}
      </div>
    </div>
  );
}

/* ── Grading queue (grader+, Gate 1) ─────────────────────────────────────── */

function GradingQueueView({ queue, profile, onGraded, busyId, setBusyId }) {
  if (!queue.length) {
    return (
      <div className="bg-white rounded-3xl border border-slate-200 p-8 text-center text-sm text-slate-500">
        The grading queue is empty. 🎉
      </div>
    );
  }
  return (
    <div className="space-y-4">
      {queue.map(s => (
        <GradeCard key={s.id} submission={s} profile={profile}
          onGraded={onGraded} busy={busyId === s.id}
          setBusy={(b) => setBusyId(b ? s.id : null)} />
      ))}
    </div>
  );
}

function GradeCard({ submission: s, profile, onGraded, busy, setBusy }) {
  const iParticipate = (s.participants || []).some(p =>
    p.user_id === profile.id ||
    (p.discord_user_id && p.discord_user_id === profile.discord_id)
  );
  const [solOnly, setSolOnly] = useState(false);
  const [notes, setNotes] = useState('');
  const [tagsByPart, setTagsByPart] = useState(() =>
    Object.fromEntries((s.participants || []).map(p => [p.id, p.claimed_tags || []]))
  );
  const [checklist, setChecklist] = useState(() => GRADER_CHECKLIST.map(() => false));

  const verdict = async (approve) => {
    setBusy(true);
    try {
      await gradeRpSubmission(s.id, { approve, solOnly, tagsByParticipant: tagsByPart, notes });
      const submitterName = displayName(s.submitter);
      const outcome = !approve ? 'was not approved'
        : solOnly ? 'was graded Slice-of-Life only (no upgrade credit)'
        : 'was approved — credits have been minted';
      dmUser(s.submitter?.discord_id, `📖 Your ${s.rp_type} RP grading submission ("${s.description || 'RP'}") ${outcome}.${notes ? `\nGrader notes: ${notes}` : ''}`);
      onGraded();
    } catch (err) {
      alert('Grading failed: ' + err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={`bg-white rounded-3xl border shadow-xs overflow-hidden ${iParticipate ? 'border-slate-200 opacity-70' : 'border-slate-200'}`}>
      <div className="p-4 border-b border-slate-100 flex flex-wrap items-center gap-2">
        <span className="text-[10px] font-black uppercase tracking-wider bg-slate-900 text-white px-2 py-1 rounded">{s.rp_type}</span>
        <span className="text-sm font-bold text-slate-800">{s.description || 'RP submission'}</span>
        <span className="text-[10px] text-slate-400">by {displayName(s.submitter)} · {fmtDate(s.created_at)}</span>
        {s.thread_url && (
          <a href={s.thread_url} target="_blank" rel="noreferrer"
            className="ml-auto text-xs font-bold text-indigo-600 hover:text-indigo-800 inline-flex items-center gap-1">
            Read the thread <Icon n="ExtLink" size={11} />
          </a>
        )}
      </div>

      {iParticipate ? (
        <div className="p-4 text-xs font-semibold text-amber-700 bg-amber-50 flex items-center gap-2">
          <Icon n="Alert" size={14} /> You participated in this RP — another grader has to take it.
        </div>
      ) : (
        <div className="p-4 space-y-3">
          <div className="space-y-2">
            <label className="text-[10px] font-bold uppercase text-slate-400">
              Per-player upgrade availability — the eligible tags each character's credit may be spent on
            </label>
            {(s.participants || []).map(p => (
              <div key={p.id} className="rounded-2xl border border-slate-200 p-3">
                <div className="text-xs font-bold text-slate-700 mb-1.5">
                  {p.character?.character_name || 'Unknown OC'}
                  <span className="text-slate-400 font-semibold"> · {displayName(p.profile)}</span>
                  {p.character?.ninja_rank && <span className="text-slate-400 font-semibold"> · {p.character.ninja_rank}</span>}
                </div>
                <TagChips options={TRAINABLE_TAGS} selected={tagsByPart[p.id] || []} disabled={solOnly}
                  onToggle={(t) => setTagsByPart(m => ({
                    ...m,
                    [p.id]: (m[p.id] || []).includes(t) ? m[p.id].filter(x => x !== t) : [...(m[p.id] || []), t],
                  }))} />
              </div>
            ))}
          </div>

          <label className="flex items-center gap-2 text-xs font-bold text-slate-700 cursor-pointer">
            <input type="checkbox" checked={solOnly} onChange={e => setSolOnly(e.target.checked)} />
            Slice-of-Life only — mints no upgrade credit (Ryo/None only)
          </label>

          <details className="rounded-xl border border-slate-200 px-3 py-2">
            <summary className="text-[10px] font-bold uppercase text-slate-400 cursor-pointer">
              Grading checklist (guidance only — never blocks)
            </summary>
            <div className="mt-2 space-y-1">
              {GRADER_CHECKLIST.map((item, i) => (
                <label key={i} className="flex items-center gap-2 text-xs text-slate-600 cursor-pointer">
                  <input type="checkbox" checked={checklist[i]}
                    onChange={() => setChecklist(cl => cl.map((c, j) => j === i ? !c : c))} />
                  {item}
                </label>
              ))}
            </div>
          </details>

          <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2}
            placeholder="Grader notes (the reviewer checks upgrade requests against these)"
            className="w-full text-xs border border-slate-200 rounded-xl px-3 py-2" />

          <div className="flex gap-2">
            <button type="button" disabled={busy} onClick={() => verdict(true)}
              className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold uppercase tracking-wider px-4 py-2 rounded-xl disabled:opacity-50">
              {busy ? 'Working…' : solOnly ? 'Approve (SoL — no credit)' : 'Approve & mint credits'}
            </button>
            <button type="button" disabled={busy} onClick={() => verdict(false)}
              className="bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold uppercase tracking-wider px-4 py-2 rounded-xl disabled:opacity-50">
              Reject
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Upgrade queue (reviewer+, Gate 2) ───────────────────────────────────── */

function UpgradeQueueView({ pending, revertable, creditById, cycleUsed, profile, onReviewed, busyId, setBusyId }) {
  return (
    <div className="space-y-4">
      {pending.length ? pending.map(r => (
        <UpgradeReviewCard key={r.id} request={r} creditById={creditById}
          cycleUsed={cycleUsed} profile={profile} onReviewed={onReviewed}
          busy={busyId === r.id} setBusy={(b) => setBusyId(b ? r.id : null)} />
      )) : (
        <div className="bg-white rounded-3xl border border-slate-200 p-8 text-center text-sm text-slate-500">
          The upgrade queue is empty. 🎉
        </div>
      )}

      {revertable.length > 0 && (
        <div className="bg-white rounded-3xl border border-slate-200 p-4 space-y-2">
          <h4 className="text-xs font-black uppercase tracking-wider text-slate-500">Recently applied (revertable)</h4>
          {revertable.map(r => (
            <div key={r.id} className="rounded-xl border border-slate-200 px-3 py-2 flex items-center justify-between gap-2 flex-wrap">
              <div>
                <span className="text-xs font-bold text-slate-700">{r.character?.character_name}: {r.target?.label || r.upgrade_type}</span>
                <span className="text-[10px] text-slate-400 ml-2">
                  approved {fmtDate(r.reviewed_at)} by {displayName(r.reviewer)}
                  {r.override_reason && <span className="text-amber-700"> · override: {r.override_reason}</span>}
                </span>
              </div>
              <button type="button" disabled={busyId === r.id}
                onClick={async () => {
                  if (!window.confirm(`Revert "${r.target?.label}" on ${r.character?.character_name}? The sheet is restored and the credits refunded.`)) return;
                  setBusyId(r.id);
                  try { await revertUpgrade(r.id); onReviewed(); }
                  catch (err) { alert('Revert failed: ' + err.message); }
                  finally { setBusyId(null); }
                }}
                className="text-[10px] font-bold text-rose-500 hover:text-rose-700 border border-rose-200 rounded-lg px-2.5 py-1.5 disabled:opacity-50">
                Revert
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function UpgradeReviewCard({ request: r, creditById, cycleUsed, profile, onReviewed, busy, setBusy }) {
  const isOwnOc = r.character?.owner_id === profile.id;
  const [overrideReason, setOverrideReason] = useState('');
  const [rejectNote, setRejectNote] = useState('');
  const [showReject, setShowReject] = useState(false);

  const sheet = useMemo(() => normalizeSheet(r.character?.data), [r.character?.data]);
  const attachedCredits = (r.attached_credit_ids || []).map(id => creditById[id]).filter(Boolean);

  // Live recompute — the sheet or ledger may have moved since the request.
  const warnings = useMemo(() => computeUpgradeWarnings({
    sheet,
    upgradeType: r.upgrade_type,
    target: { ...(r.target || {}), cost: r.computed_cost },
    attachedCredits,
    approvedThisCycle: cycleUsed[r.character_id] ?? 0,
  }), [sheet, r, attachedCredits, cycleUsed]);

  const needsOverride = warnings.length > 0;

  const approve = async () => {
    if (needsOverride && !overrideReason.trim()) {
      alert('This request has warnings — approving it requires a logged override reason.');
      return;
    }
    setBusy(true);
    try {
      await approveUpgradeRequest(r.id, needsOverride ? overrideReason.trim() : null);
      dmUser(r.requester?.discord_id, `✅ Your upgrade request for **${r.character?.character_name}** (${r.target?.label}) was approved — the sheet has been updated.`);
      onReviewed();
    } catch (err) {
      alert('Approval failed: ' + err.message);
    } finally {
      setBusy(false);
    }
  };

  const reject = async () => {
    setBusy(true);
    try {
      await rejectUpgradeRequest(r.id, rejectNote.trim());
      dmUser(r.requester?.discord_id, `❌ Your upgrade request for **${r.character?.character_name}** (${r.target?.label}) was rejected.${rejectNote.trim() ? `\nReviewer: ${rejectNote.trim()}` : ''}`);
      onReviewed();
    } catch (err) {
      alert('Rejection failed: ' + err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="bg-white rounded-3xl border border-slate-200 shadow-xs overflow-hidden">
      <div className="p-4 border-b border-slate-100 flex flex-wrap items-center gap-2">
        <span className="text-[10px] font-black uppercase tracking-wider bg-indigo-600 text-white px-2 py-1 rounded">{r.upgrade_type.replace('_', ' ')}</span>
        <span className="text-sm font-bold text-slate-800">{r.character?.character_name}: {r.target?.label}</span>
        <span className="ml-auto text-xs font-bold text-indigo-600">{r.computed_cost} credit{r.computed_cost > 1 ? 's' : ''}</span>
      </div>

      <div className="p-4 space-y-3">
        <div className="text-[10px] text-slate-400">
          Requested by {displayName(r.requester)} · {fmtDate(r.created_at)}
          {r.character?.ninja_rank && <> · {r.character.ninja_rank}</>}
          · {cycleUsed[r.character_id] ?? 0} of {WEEKLY_UPGRADE_CAP} grants used this cycle
        </div>

        <div>
          <label className="text-[10px] font-bold uppercase text-slate-400">Attached credits & grader notes</label>
          <div className="mt-1 space-y-1.5">
            {attachedCredits.length
              ? attachedCredits.map(c => <CreditPill key={c.id} credit={c} />)
              : <p className="text-xs text-rose-600 font-semibold">Could not resolve the attached credits — they may have been spent or removed.</p>}
          </div>
        </div>

        <WarningPanel warnings={warnings} />

        {isOwnOc ? (
          <div className="text-xs font-semibold text-amber-700 bg-amber-50 rounded-xl px-3 py-2 flex items-center gap-2">
            <Icon n="Alert" size={14} /> This is your own OC — another reviewer has to take it.
          </div>
        ) : (
          <div className="space-y-2">
            {needsOverride && (
              <input value={overrideReason} onChange={e => setOverrideReason(e.target.value)}
                placeholder="Override reason (required — logged with the approval)"
                className="w-full text-xs border border-amber-300 bg-amber-50 rounded-xl px-3 py-2" />
            )}
            <div className="flex gap-2 flex-wrap">
              <button type="button" disabled={busy} onClick={approve}
                className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold uppercase tracking-wider px-4 py-2 rounded-xl disabled:opacity-50">
                {busy ? 'Working…' : needsOverride ? 'Approve with override' : 'Approve — apply to sheet'}
              </button>
              <button type="button" disabled={busy} onClick={() => setShowReject(v => !v)}
                className="bg-white border border-rose-300 text-rose-600 hover:bg-rose-50 text-xs font-bold uppercase tracking-wider px-4 py-2 rounded-xl disabled:opacity-50">
                Reject…
              </button>
            </div>
            {showReject && (
              <div className="flex gap-2">
                <input value={rejectNote} onChange={e => setRejectNote(e.target.value)}
                  placeholder="Reason shown to the player (optional)"
                  className="flex-1 text-xs border border-slate-200 rounded-xl px-3 py-2" />
                <button type="button" disabled={busy} onClick={reject}
                  className="bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold px-4 py-2 rounded-xl disabled:opacity-50">
                  Confirm reject
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
