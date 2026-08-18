/*
 * Combat Tracker — manual, turn-by-turn combat for text roleplay (Phase 1).
 *
 * Players declare each action explicitly; nothing here parses RP text. The
 * only automated output is the turn log posted after each resolved turn.
 * Mechanics come from the chakra system rules already documented for this
 * community — this page implements the lifecycle (create/join/lock a fixed
 * turn order) and 1-post technique turns (live CU lookup from the acting
 * character's own sheet, base rank cost, straight deduction).
 *
 * Deliberately NOT here yet — later phases, once this foundation holds up:
 * multi-post Battery techniques, continuous per-turn cost, the defensive
 * resolution engine (so Defend/Assault aren't declarable actions yet),
 * genjutsu's cost-flip-to-target rule, zero/negative-CU unconsciousness,
 * and the Discord slash-command shortcut layer.
 *
 * Three views: Lobbies (open drafts anyone can join + your own battles),
 * a Create form, and the Active Battle view (turn-order strip, CU per
 * participant, and the action form that only appears when it's your turn).
 */

import { useState, useEffect, useMemo, useCallback } from 'react';
import { Icon } from '../components/ui/Icon';
import {
  isSupabaseConfigured,
  fetchMyCharacterSheets, fetchCharacterSheetIndex, fetchAllProfiles,
  fetchBattles, fetchBattle, fetchBattleTurnLog,
  createBattle, joinBattle, inviteToBattle, acceptBattleInvite,
  removeBattleParticipant, lockBattle, declareTurn, endBattle, forceAdvanceTurn,
} from '../lib/supabase';
import { normalizeSheet } from '../constants/characterSheet';
import { TECHNIQUE_BASE_COST } from '../constants/combatRules';

const displayName = (p) => p?.site_nickname || p?.username || 'Unknown';
const fmtTime = (ts) => ts ? new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';

function StatusBadge({ status }) {
  const map = {
    draft: 'bg-amber-100 text-amber-800 border-amber-200',
    active: 'bg-emerald-100 text-emerald-800 border-emerald-200',
    completed: 'bg-slate-200 text-slate-600 border-slate-300',
    voided: 'bg-rose-100 text-rose-800 border-rose-200',
  };
  return (
    <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded border ${map[status] || map.draft}`}>
      {status}
    </span>
  );
}

/* ── The page ────────────────────────────────────────────────────────────── */

export default function CombatPage({ profile, role }) {
  const supabaseReady = isSupabaseConfigured();
  const isReviewer = ['reviewer', 'admin', 'owner'].includes(role);

  const [view, setView] = useState('lobbies');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const [myChars, setMyChars] = useState([]);
  const [allSheets, setAllSheets] = useState([]);
  const [allProfiles, setAllProfiles] = useState([]);
  const [battles, setBattles] = useState([]);
  const [openBattleId, setOpenBattleId] = useState(null);
  const [openBattle, setOpenBattle] = useState(null);
  const [turnLog, setTurnLog] = useState([]);

  const reloadList = useCallback(async () => {
    if (!supabaseReady || !profile?.id) { setLoading(false); return; }
    setLoading(true);
    setError('');
    try {
      const [chars, sheetIndex, profiles, list] = await Promise.all([
        fetchMyCharacterSheets(), fetchCharacterSheetIndex(), fetchAllProfiles().catch(() => []), fetchBattles(),
      ]);
      setMyChars(chars);
      setAllSheets(Object.values(sheetIndex));
      setAllProfiles(profiles);
      setBattles(list);
    } catch (err) {
      console.warn('[NARP] Combat page load failed:', err);
      setError(err.message || 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [supabaseReady, profile?.id]);

  useEffect(() => { reloadList(); }, [reloadList]);

  const reloadOpenBattle = useCallback(async (id) => {
    if (!id) return;
    try {
      const [b, log] = await Promise.all([fetchBattle(id), fetchBattleTurnLog(id)]);
      setOpenBattle(b);
      setTurnLog(log);
    } catch (err) {
      setError(err.message || 'Failed to load battle');
    }
  }, []);

  useEffect(() => {
    if (openBattleId) { setView('battle'); reloadOpenBattle(openBattleId); }
  }, [openBattleId, reloadOpenBattle]);

  const openLobbies = useMemo(() => battles.filter(b => b.status === 'draft' && b.visibility_mode === 'open'), [battles]);
  const myBattles = useMemo(
    () => battles.filter(b =>
      b.host_id === profile?.id || (b.participants || []).some(p => p.user_id === profile?.id)
    ),
    [battles, profile?.id]
  );

  const run = async (fn, ...args) => {
    setBusy(true);
    setError('');
    try {
      await fn(...args);
      await reloadList();
      if (openBattleId) await reloadOpenBattle(openBattleId);
    } catch (err) {
      setError(err.message || 'Action failed');
    } finally {
      setBusy(false);
    }
  };

  if (!supabaseReady) {
    return (
      <div className="max-w-3xl mx-auto bg-white rounded-3xl border border-slate-200 p-8 text-center text-sm text-slate-500">
        The combat tracker needs the Supabase backend — it isn't available in local dev mode.
      </div>
    );
  }
  if (!profile) {
    return (
      <div className="max-w-3xl mx-auto bg-white rounded-3xl border border-slate-200 p-8 text-center text-sm text-slate-500">
        Sign in with Discord to use the combat tracker.
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {[
          { id: 'lobbies', label: 'Battles' },
          { id: 'create', label: 'Create Battle' },
        ].map(v => (
          <button key={v.id} type="button"
            onClick={() => { setView(v.id); setOpenBattleId(null); }}
            className={`text-xs font-bold uppercase tracking-wider px-3.5 py-2 rounded-xl border transition-colors ${
              view === v.id ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-600 border-slate-200 hover:border-slate-400'
            }`}>
            {v.label}
          </button>
        ))}
        <button type="button" onClick={() => { reloadList(); if (openBattleId) reloadOpenBattle(openBattleId); }} disabled={loading}
          className="ml-auto text-xs font-bold text-slate-500 hover:text-slate-800 flex items-center gap-1.5 px-2 py-2">
          <Icon n="Refresh" size={13} className={loading ? 'animate-spin' : ''} /> Refresh
        </button>
      </div>

      {error && <div className="bg-rose-50 border border-rose-200 text-rose-800 text-xs font-semibold rounded-xl px-3 py-2">{error}</div>}

      {loading ? (
        <div className="bg-white rounded-3xl border border-slate-200 p-10 text-center">
          <div className="w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin mx-auto" />
        </div>
      ) : (
        <>
          {view === 'lobbies' && (
            <LobbiesView openLobbies={openLobbies} myBattles={myBattles} profile={profile}
              onOpen={setOpenBattleId} />
          )}
          {view === 'create' && (
            <CreateBattleView profile={profile}
              onCreated={(id) => { setOpenBattleId(id); }} />
          )}
          {view === 'battle' && openBattle && (
            <BattleView battle={openBattle} turnLog={turnLog} myChars={myChars}
              allSheets={allSheets} allProfiles={allProfiles} profile={profile}
              isReviewer={isReviewer} busy={busy} run={run}
              onBack={() => { setOpenBattleId(null); setView('lobbies'); }}
              joinBattle={joinBattle} inviteToBattle={inviteToBattle} acceptBattleInvite={acceptBattleInvite}
              removeBattleParticipant={removeBattleParticipant} lockBattle={lockBattle}
              declareTurn={declareTurn} endBattle={endBattle} forceAdvanceTurn={forceAdvanceTurn} />
          )}
        </>
      )}
    </div>
  );
}

/* ── Lobbies / my battles list ───────────────────────────────────────────── */

function BattleRow({ b, profile, onOpen }) {
  const mine = (b.participants || []).find(p => p.user_id === profile?.id);
  return (
    <button type="button" onClick={() => onOpen(b.id)}
      className="w-full text-left rounded-2xl border border-slate-200 bg-white px-4 py-3 hover:border-indigo-300 transition-colors">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <span className="text-sm font-bold text-slate-800">
          {b.visibility_mode === 'open' ? 'Open lobby' : 'Invite-only'} · hosted by {displayName(b.host)}
        </span>
        <StatusBadge status={b.status} />
      </div>
      <div className="text-[10px] text-slate-400 mt-1 flex items-center gap-2 flex-wrap">
        <a href={b.thread_url} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()}
          className="text-indigo-500 hover:text-indigo-700 inline-flex items-center gap-0.5">
          thread <Icon n="ExtLink" size={9} />
        </a>
        <span>{(b.participants || []).length} joined</span>
        {b.status === 'active' && <span>round {b.round_number}</span>}
        {mine && <span className="text-emerald-600 font-semibold">you're in this one</span>}
      </div>
    </button>
  );
}

function LobbiesView({ openLobbies, myBattles, profile, onOpen }) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <div className="bg-white rounded-3xl border border-slate-200 p-4 space-y-2">
        <h4 className="text-xs font-black uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
          <Icon n="Grid" size={13} /> Open lobbies
        </h4>
        {openLobbies.length
          ? openLobbies.map(b => <BattleRow key={b.id} b={b} profile={profile} onOpen={onOpen} />)
          : <p className="text-xs text-slate-400 italic">No open lobbies right now — start one from Create Battle.</p>}
      </div>
      <div className="bg-white rounded-3xl border border-slate-200 p-4 space-y-2">
        <h4 className="text-xs font-black uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
          <Icon n="Shield" size={13} /> Your battles
        </h4>
        {myBattles.length
          ? myBattles.map(b => <BattleRow key={b.id} b={b} profile={profile} onOpen={onOpen} />)
          : <p className="text-xs text-slate-400 italic">You're not hosting or in any battle yet.</p>}
      </div>
    </div>
  );
}

/* ── Create battle ────────────────────────────────────────────────────────── */

function CreateBattleView({ onCreated }) {
  const [threadUrl, setThreadUrl] = useState('');
  const [visibility, setVisibility] = useState('open');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  const submit = async () => {
    if (!threadUrl.trim()) { setErr('A thread link is required.'); return; }
    setSaving(true);
    setErr('');
    try {
      const id = await createBattle(threadUrl.trim(), visibility);
      onCreated(id);
    } catch (e) {
      setErr(e.message || 'Failed to create battle');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-xl bg-white rounded-3xl border border-slate-200 shadow-xs overflow-hidden">
      <div className="bg-slate-900 text-white p-4 flex items-center gap-2">
        <Icon n="Plus" size={16} className="text-indigo-400" />
        <h3 className="font-bold font-serif">Create a battle</h3>
      </div>
      <div className="p-4 space-y-3">
        <input value={threadUrl} onChange={e => setThreadUrl(e.target.value)}
          placeholder="Discord thread link this battle is bound to"
          className="w-full text-xs border border-slate-200 rounded-xl px-3 py-2" />
        <div className="flex gap-1.5">
          {[
            { id: 'open', label: 'Open lobby', desc: 'Anyone can join until you lock it' },
            { id: 'invite', label: 'Invite-only', desc: 'You tag specific players' },
          ].map(v => (
            <button key={v.id} type="button" onClick={() => setVisibility(v.id)}
              className={`flex-1 text-left rounded-xl border px-3 py-2 ${visibility === v.id ? 'border-indigo-400 bg-indigo-50' : 'border-slate-200 bg-white'}`}>
              <div className="text-xs font-bold text-slate-700">{v.label}</div>
              <div className="text-[10px] text-slate-400">{v.desc}</div>
            </button>
          ))}
        </div>
        {err && <p className="text-xs text-rose-600 font-semibold">{err}</p>}
        <button type="button" disabled={saving} onClick={submit}
          className="bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold uppercase tracking-wider px-4 py-2.5 rounded-xl disabled:opacity-50">
          {saving ? 'Creating…' : 'Create battle'}
        </button>
      </div>
    </div>
  );
}

/* ── Active battle view ──────────────────────────────────────────────────── */

function BattleView({
  battle: b, turnLog, myChars, allSheets, allProfiles, profile, isReviewer, busy, run, onBack,
  joinBattle, inviteToBattle, acceptBattleInvite, removeBattleParticipant,
  lockBattle, declareTurn, endBattle, forceAdvanceTurn,
}) {
  const isHost = b.host_id === profile.id;
  const myParticipant = (b.participants || []).find(p => p.user_id === profile.id);
  const joined = (b.participants || []).filter(p => p.invite_status === 'joined');
  const invited = (b.participants || []).filter(p => p.invite_status === 'invited');

  const [joinCharId, setJoinCharId] = useState('');
  const [order, setOrder] = useState(() => joined.map(p => p.character_id));
  useEffect(() => { setOrder(joined.map(p => p.character_id)); }, [b.id, joined.length]);

  const availableChars = myChars.filter(c => !(b.participants || []).some(p => p.character_id === c.id));

  const currentActorId = b.status === 'active' ? b.turn_order?.[b.current_turn_index] : null;
  const currentActor = (b.participants || []).find(p => p.character_id === currentActorId);
  const isMyTurn = currentActor?.user_id === profile.id;

  return (
    <div className="space-y-4">
      <button type="button" onClick={onBack} className="text-xs font-bold text-slate-500 hover:text-slate-800 flex items-center gap-1">
        <Icon n="Up" size={12} className="-rotate-90" /> Back to battles
      </button>

      <div className="bg-white rounded-3xl border border-slate-200 shadow-xs overflow-hidden">
        <div className="bg-slate-900 text-white p-4 flex flex-wrap items-center gap-2">
          <StatusBadge status={b.status} />
          <span className="text-sm font-bold">hosted by {displayName(b.host)}</span>
          <a href={b.thread_url} target="_blank" rel="noreferrer" className="text-indigo-300 hover:text-indigo-200 text-xs inline-flex items-center gap-1 ml-1">
            thread <Icon n="ExtLink" size={10} />
          </a>
          {b.status === 'active' && <span className="ml-auto text-xs font-bold">Round {b.round_number}</span>}
          {(isHost || isReviewer) && (b.status === 'draft' || b.status === 'active') && (
            <button type="button" disabled={busy}
              onClick={() => run(endBattle, b.id, 'voided')}
              className="text-[10px] font-bold uppercase text-rose-300 hover:text-rose-100 ml-2">
              Void
            </button>
          )}
          {isHost && b.status === 'active' && (
            <button type="button" disabled={busy}
              onClick={() => run(endBattle, b.id, 'completed')}
              className="text-[10px] font-bold uppercase text-emerald-300 hover:text-emerald-100 ml-2">
              End battle
            </button>
          )}
        </div>

        {b.status === 'active' && (
          <div className="p-4 border-b border-slate-100">
            <div className="flex flex-wrap gap-2">
              {b.turn_order.map((charId, i) => {
                const p = (b.participants || []).find(pp => pp.character_id === charId);
                const up = i === b.current_turn_index;
                return (
                  <div key={charId} className={`rounded-2xl border px-3 py-2 min-w-[9rem] ${up ? 'border-indigo-400 bg-indigo-50' : 'border-slate-200 bg-white'}`}>
                    <div className="flex items-center gap-1.5">
                      {up && <Icon n="PlusCir" size={11} className="text-indigo-500" />}
                      <span className={`text-xs font-bold ${up ? 'text-indigo-700' : 'text-slate-700'}`}>{p?.character?.character_name || '?'}</span>
                    </div>
                    <div className="text-[10px] text-slate-400">{displayName(p?.profile)}</div>
                    <div className="text-[10px] font-bold text-slate-600 mt-0.5">{p?.current_cu ?? '—'} / {p?.max_cu ?? '—'} CU</div>
                  </div>
                );
              })}
            </div>
            {isReviewer && (
              <button type="button" disabled={busy} onClick={() => run(forceAdvanceTurn, b.id)}
                className="mt-2 text-[10px] font-bold text-amber-600 hover:text-amber-800 flex items-center gap-1">
                <Icon n="Clock" size={11} /> Force-skip stalled turn (staff)
              </button>
            )}
          </div>
        )}

        {b.status === 'draft' && (
          <div className="p-4 border-b border-slate-100 space-y-3">
            <div>
              <label className="text-[10px] font-bold uppercase text-slate-400">Joined</label>
              <div className="mt-1 space-y-1.5">
                {joined.length ? joined.map(p => (
                  <div key={p.id} className="flex items-center justify-between gap-2 rounded-xl border border-slate-200 px-3 py-2">
                    <span className="text-xs font-bold text-slate-700">{p.character?.character_name} <span className="text-slate-400 font-semibold">· {displayName(p.profile)}</span></span>
                    {(isHost || p.user_id === profile.id) && (
                      <button type="button" disabled={busy} onClick={() => run(removeBattleParticipant, b.id, p.character_id)}
                        className="text-[10px] font-bold text-rose-500 hover:text-rose-700">Remove</button>
                    )}
                  </div>
                )) : <p className="text-xs text-slate-400 italic">Nobody has joined yet.</p>}
              </div>
            </div>

            {invited.length > 0 && (
              <div>
                <label className="text-[10px] font-bold uppercase text-slate-400">Invited (awaiting accept)</label>
                <div className="mt-1 space-y-1.5">
                  {invited.map(p => (
                    <div key={p.id} className="flex items-center justify-between gap-2 rounded-xl border border-dashed border-slate-200 px-3 py-2">
                      <span className="text-xs font-semibold text-slate-500">{p.character?.character_name} · {displayName(p.profile)}</span>
                      {p.user_id === profile.id && (
                        <button type="button" disabled={busy} onClick={() => run(acceptBattleInvite, b.id, p.character_id)}
                          className="text-[10px] font-bold text-emerald-600 hover:text-emerald-800">Accept</button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {b.visibility_mode === 'open' && !myParticipant && availableChars.length > 0 && (
              <div className="flex gap-2">
                <select value={joinCharId} onChange={e => setJoinCharId(e.target.value)}
                  className="flex-1 text-xs border border-slate-200 rounded-xl px-3 py-2 bg-white">
                  <option value="">— pick your character —</option>
                  {availableChars.map(c => <option key={c.id} value={c.id}>{c.character_name}</option>)}
                </select>
                <button type="button" disabled={busy || !joinCharId}
                  onClick={() => run(joinBattle, b.id, joinCharId)}
                  className="bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold px-4 py-2 rounded-xl disabled:opacity-50">
                  Join
                </button>
              </div>
            )}

            {isHost && b.visibility_mode === 'invite' && (
              <InvitePicker battleId={b.id} allProfiles={allProfiles} allSheets={allSheets}
                alreadyIn={b.participants || []} busy={busy} run={run} inviteToBattle={inviteToBattle} />
            )}

            {isHost && (
              <div>
                <label className="text-[10px] font-bold uppercase text-slate-400">Turn order (drag not yet wired — reorder by re-picking)</label>
                <div className="mt-1 space-y-1">
                  {order.map((charId, i) => {
                    const p = joined.find(pp => pp.character_id === charId);
                    return (
                      <div key={charId} className="flex items-center gap-2 text-xs bg-slate-50 border border-slate-200 rounded-lg px-3 py-1.5">
                        <span className="font-bold text-slate-400 w-5">{i + 1}.</span>
                        <span className="flex-1 font-semibold text-slate-700">{p?.character?.character_name}</span>
                        <button type="button" disabled={i === 0} onClick={() => setOrder(o => { const n = [...o]; [n[i - 1], n[i]] = [n[i], n[i - 1]]; return n; })}
                          className="text-slate-400 hover:text-slate-700 disabled:opacity-30"><Icon n="Up" size={12} /></button>
                        <button type="button" disabled={i === order.length - 1} onClick={() => setOrder(o => { const n = [...o]; [n[i + 1], n[i]] = [n[i], n[i + 1]]; return n; })}
                          className="text-slate-400 hover:text-slate-700 disabled:opacity-30"><Icon n="Down" size={12} /></button>
                      </div>
                    );
                  })}
                </div>
                <button type="button" disabled={busy || order.length < 2} onClick={() => run(lockBattle, b.id, order)}
                  className="mt-2 bg-slate-900 hover:bg-slate-700 text-white text-xs font-bold uppercase tracking-wider px-4 py-2.5 rounded-xl disabled:opacity-50">
                  Lock roster & start battle
                </button>
              </div>
            )}
          </div>
        )}

        {b.status === 'active' && isMyTurn && (
          <TurnForm battleId={b.id} character={currentActor.character} busy={busy} run={run} declareTurn={declareTurn} />
        )}
        {b.status === 'active' && !isMyTurn && currentActor && (
          <div className="p-4 text-xs font-semibold text-slate-500 flex items-center gap-2">
            <Icon n="Clock" size={14} /> Waiting on {currentActor.character?.character_name} ({displayName(currentActor.profile)}).
          </div>
        )}
      </div>

      <div className="bg-white rounded-3xl border border-slate-200 p-4 space-y-1.5">
        <h4 className="text-xs font-black uppercase tracking-wider text-slate-500">Turn log</h4>
        {turnLog.length ? turnLog.map(t => (
          <div key={t.id} className="text-xs text-slate-600 flex items-start gap-2 border-b border-slate-50 last:border-0 py-1.5">
            <span className="text-[10px] text-slate-400 font-mono shrink-0 w-14">R{t.round_number} · {fmtTime(t.created_at)}</span>
            <span>{t.resolution_summary}</span>
          </div>
        )) : <p className="text-xs text-slate-400 italic">No turns declared yet.</p>}
      </div>
    </div>
  );
}

function InvitePicker({ battleId, allProfiles, allSheets, alreadyIn, busy, run, inviteToBattle }) {
  const [userId, setUserId] = useState('');
  const [charId, setCharId] = useState('');

  const invitedOrJoinedIds = new Set(alreadyIn.map(p => p.character_id));
  const candidateProfiles = allProfiles.filter(p => allSheets.some(s => s.owner_id === p.id));
  const theirChars = allSheets.filter(s => s.owner_id === userId && !invitedOrJoinedIds.has(s.id));

  return (
    <div className="flex flex-col sm:flex-row gap-2">
      <select value={userId} onChange={e => { setUserId(e.target.value); setCharId(''); }}
        className="flex-1 text-xs border border-slate-200 rounded-xl px-3 py-2 bg-white">
        <option value="">— pick a player to invite —</option>
        {candidateProfiles.map(p => <option key={p.id} value={p.id}>{displayName(p)}</option>)}
      </select>
      <select value={charId} onChange={e => setCharId(e.target.value)} disabled={!userId}
        className="flex-1 text-xs border border-slate-200 rounded-xl px-3 py-2 bg-white disabled:opacity-50">
        <option value="">— their character —</option>
        {theirChars.map(s => <option key={s.id} value={s.id}>{s.character_name}</option>)}
      </select>
      <button type="button" disabled={busy || !userId || !charId}
        onClick={() => run(inviteToBattle, battleId, charId, userId)}
        className="bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold px-4 py-2 rounded-xl disabled:opacity-50">
        Invite
      </button>
    </div>
  );
}

function TurnForm({ battleId, character, busy, run, declareTurn }) {
  const sheet = useMemo(() => normalizeSheet(character?.data), [character?.data]);
  const knownJutsu = (sheet.techniques.jutsu || []).filter(j => j.name && j.approved === 'Yes');
  const [jutsuName, setJutsuName] = useState('');

  const selected = knownJutsu.find(j => j.name === jutsuName);
  const cost = selected ? TECHNIQUE_BASE_COST[selected.rank] : null;

  return (
    <div className="p-4 bg-indigo-50 border-t border-indigo-100 space-y-2">
      <div className="text-xs font-bold text-indigo-800 flex items-center gap-1.5">
        <Icon n="PlusCir" size={13} /> It's your turn — {character?.character_name}
      </div>
      <div className="flex flex-col sm:flex-row gap-2">
        <select value={jutsuName} onChange={e => setJutsuName(e.target.value)}
          className="flex-1 text-xs border border-slate-200 rounded-xl px-3 py-2 bg-white">
          <option value="">— use a technique —</option>
          {knownJutsu.map(j => (
            <option key={j.name} value={j.name}>{j.name} ({j.rank}-rank, {TECHNIQUE_BASE_COST[j.rank] ?? '?'} CU)</option>
          ))}
        </select>
        <button type="button" disabled={busy || !jutsuName}
          onClick={() => run(declareTurn, battleId, 'use_technique', jutsuName)}
          className="bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold px-4 py-2 rounded-xl disabled:opacity-50">
          {cost !== null ? `Use (${cost} CU)` : 'Use'}
        </button>
        <button type="button" disabled={busy}
          onClick={() => run(declareTurn, battleId, 'pass', null)}
          className="bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 text-xs font-bold px-4 py-2 rounded-xl disabled:opacity-50">
          Pass
        </button>
      </div>
      {!knownJutsu.length && (
        <p className="text-[10px] text-indigo-700">No Approved 1-post techniques found on this sheet — you can still Pass.</p>
      )}
    </div>
  );
}
