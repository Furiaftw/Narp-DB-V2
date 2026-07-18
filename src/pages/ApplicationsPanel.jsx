import { useState, useEffect } from 'react';
import {
  fetchAllApplications,
  startApplicationInterview,
  denyJoinApplication,
  approveJoinApplication,
  subscribeToApplicationChanges,
  supabase,
} from '../lib/supabase';
import { DISCORD_ROLES, applyDiscordRoles } from '../lib/discordRoles';
import { getNetlifyImageUrl } from '../utils/helpers';
import InterviewChat from '../components/features/InterviewChat';
import ConfirmButton from '../components/ui/ConfirmButton';
import Icon from '../components/ui/Icon';

/*
 * Admin control panel for the community verification system (its own tab,
 * admin/owner only). Three sections: fresh applications, open interviews, and
 * the full decision history. All state transitions go through the
 * SECURITY DEFINER RPCs in add-community-verification.sql.
 */

const nameOf = (p) => p?.site_nickname || p?.username || 'Unknown';

const STATUS_BADGES = {
  pending:   'bg-amber-100 text-amber-800 border-amber-200',
  interview: 'bg-indigo-100 text-indigo-800 border-indigo-200',
  approved:  'bg-emerald-100 text-emerald-800 border-emerald-200',
  denied:    'bg-rose-100 text-rose-800 border-rose-200',
};

const ANSWER_LABELS = {
  why_join: 'Why do you want to join our server?',
  how_found: 'How did you find us?',
  most_active_server: 'Most active RP server right now',
  rp_server_count: 'How many RP servers are they in?',
  age: 'Age',
};

function AnswerList({ answers }) {
  return (
    <dl className="flex flex-col gap-2">
      {Object.entries(ANSWER_LABELS).map(([key, label]) => (
        <div key={key}>
          <dt className="text-[11px] font-bold uppercase tracking-wide text-slate-400">{label}</dt>
          <dd className="text-sm text-slate-800 whitespace-pre-wrap break-words">{String(answers?.[key] ?? '—')}</dd>
        </div>
      ))}
    </dl>
  );
}

function ApplicantHeader({ app, deniedCount }) {
  return (
    <div className="flex items-center gap-3 flex-wrap">
      {app.applicant?.avatar_url && (
        <img
          src={getNetlifyImageUrl(app.applicant.avatar_url, 40)}
          alt={nameOf(app.applicant)}
          className="w-10 h-10 rounded-lg object-cover shrink-0"
          width={40} height={40} loading="lazy"
        />
      )}
      <div className="min-w-0">
        <p className="font-bold text-slate-900 text-sm truncate">{nameOf(app.applicant)}</p>
        <p className="text-xs text-slate-500 truncate">
          {app.applicant?.email || 'no email'}
          {app.applicant?.discord_id ? ` · Discord linked` : ' · no Discord ID'}
        </p>
      </div>
      <div className="ml-auto flex items-center gap-2">
        {deniedCount > 0 && (
          <span className="text-[11px] font-bold text-rose-700 bg-rose-50 border border-rose-200 px-2 py-0.5 rounded-full">
            {deniedCount} prior denied
          </span>
        )}
        <span className={`text-[11px] font-bold uppercase px-2 py-0.5 rounded-full border ${STATUS_BADGES[app.status]}`}>
          {app.status}
        </span>
      </div>
    </div>
  );
}

/* Inline deny flow: arm → reason input → confirm. */
function DenyControl({ onDeny, busy }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={busy}
        className="text-xs font-bold px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 text-white disabled:opacity-60 transition-colors"
      >
        Deny
      </button>
    );
  }
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <input
        type="text"
        value={reason}
        onChange={e => setReason(e.target.value)}
        placeholder="Reason (optional, shown to the user)"
        autoFocus
        className="border border-slate-300 rounded-lg px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-rose-400 w-64 max-w-full"
      />
      <button
        type="button"
        onClick={() => onDeny(reason.trim() || null)}
        disabled={busy}
        className="text-xs font-bold px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-700 text-white disabled:opacity-60 transition-colors"
      >
        {busy ? 'Denying…' : 'Confirm deny'}
      </button>
      <button
        type="button"
        onClick={() => { setOpen(false); setReason(''); }}
        className="text-xs font-bold px-2 py-1.5 text-slate-500 hover:text-slate-700 transition-colors"
      >
        Cancel
      </button>
    </div>
  );
}

export default function ApplicationsPanel({ profile, webhookConfig }) {
  const [applications, setApplications] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [openChatId, setOpenChatId] = useState(null);
  const [expandedHistoryId, setExpandedHistoryId] = useState(null);
  const [notice, setNotice] = useState(null);

  const loadApplications = async () => {
    try {
      setApplications(await fetchAllApplications());
    } catch (err) {
      console.error('[NARP] Failed to load applications:', err);
      if (applications === null) setApplications([]);
    }
  };

  useEffect(() => {
    loadApplications();
  }, []);

  useEffect(() => {
    const channel = subscribeToApplicationChanges(() => loadApplications());
    const poll = setInterval(loadApplications, 30000);
    return () => {
      if (channel && supabase) supabase.removeChannel(channel);
      clearInterval(poll);
    };
  }, []);

  const deniedCountFor = (userId) =>
    (applications || []).filter(a => a.user_id === userId && a.status === 'denied').length;

  const handleInterview = async (app) => {
    setBusyId(app.id);
    setNotice(null);
    try {
      await startApplicationInterview(app.id);
      await loadApplications();
      setOpenChatId(app.id);
    } catch (err) {
      console.error('[NARP] startApplicationInterview failed:', err);
      alert('Failed to start interview: ' + (err.message || 'unknown error'));
    } finally {
      setBusyId(null);
    }
  };

  const handleDeny = async (app, reason) => {
    setBusyId(app.id);
    setNotice(null);
    try {
      await denyJoinApplication(app.id, reason);
      await loadApplications();
    } catch (err) {
      console.error('[NARP] denyJoinApplication failed:', err);
      alert('Failed to deny application: ' + (err.message || 'unknown error'));
    } finally {
      setBusyId(null);
    }
  };

  const handleApprove = async (app) => {
    setBusyId(app.id);
    setNotice(null);
    try {
      const result = await approveJoinApplication(app.id);
      await loadApplications();

      // Follow up with the Verified Discord role. Site-side verification is
      // already committed by the RPC — a role failure only needs a manual fix.
      const roleId = webhookConfig?.discord_verified_role_id || DISCORD_ROLES.VERIFIED;
      const discordUserId = result?.discord_id || app.applicant?.discord_id;
      if (!roleId) {
        setNotice({
          tone: 'warn',
          text: `${nameOf(app.applicant)} is verified on the site, but no Verified Discord role is configured (set discord_verified_role_id in System Tools) — grant it manually.`,
        });
      } else if (!discordUserId) {
        setNotice({
          tone: 'warn',
          text: `${nameOf(app.applicant)} is verified on the site, but has no linked Discord ID — grant the Verified role manually.`,
        });
      } else {
        try {
          await applyDiscordRoles({
            discordUserId,
            add: [roleId],
            reason: 'Community verification approved',
          });
          setNotice({ tone: 'ok', text: `${nameOf(app.applicant)} is verified and received the Verified Discord role.` });
        } catch (roleErr) {
          console.warn('[NARP] Verified role grant failed:', roleErr);
          setNotice({
            tone: 'warn',
            text: `${nameOf(app.applicant)} is verified on the site, but the Discord role grant failed (${roleErr.message}) — grant it manually.`,
          });
        }
      }
    } catch (err) {
      console.error('[NARP] approveJoinApplication failed:', err);
      alert('Failed to approve application: ' + (err.message || 'unknown error'));
    } finally {
      setBusyId(null);
    }
  };

  if (applications === null) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 py-20">
        <div className="w-8 h-8 border-3 border-indigo-500 border-t-transparent rounded-full animate-spin" />
        <p className="text-slate-400 text-sm font-semibold">Loading applications…</p>
      </div>
    );
  }

  const pending = applications.filter(a => a.status === 'pending');
  const interviews = applications.filter(a => a.status === 'interview');
  const history = applications.filter(a => a.status === 'approved' || a.status === 'denied');

  return (
    <div className="w-full max-w-3xl mx-auto flex flex-col gap-6 p-4">
      {notice && (
        <div className={`rounded-xl border p-3 text-sm font-semibold flex items-start gap-2 ${
          notice.tone === 'ok'
            ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
            : 'bg-amber-50 border-amber-200 text-amber-800'
        }`}>
          <Icon n={notice.tone === 'ok' ? 'CheckCir' : 'Alert'} size={16} className="mt-0.5 shrink-0" />
          <span>{notice.text}</span>
          <button type="button" onClick={() => setNotice(null)} className="ml-auto shrink-0 opacity-60 hover:opacity-100">
            <Icon n="X" size={14} />
          </button>
        </div>
      )}

      {/* --- Fresh applications ------------------------------------------- */}
      <section>
        <h2 className="text-sm font-bold uppercase tracking-widest text-slate-500 mb-3 flex items-center gap-2">
          🟡 New applications
          <span className="text-slate-400 font-semibold normal-case tracking-normal">({pending.length})</span>
        </h2>
        {pending.length === 0 ? (
          <p className="text-sm text-slate-400 bg-white rounded-xl border border-slate-200 p-4">No applications waiting for review.</p>
        ) : (
          <div className="flex flex-col gap-3">
            {pending.map(app => (
              <div key={app.id} className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 flex flex-col gap-3">
                <ApplicantHeader app={app} deniedCount={deniedCountFor(app.user_id)} />
                <AnswerList answers={app.answers} />
                <p className="text-xs text-slate-400">Submitted {new Date(app.created_at).toLocaleString()}</p>
                <div className="flex items-center gap-2 flex-wrap pt-1 border-t border-slate-100">
                  <ConfirmButton
                    onConfirm={() => handleInterview(app)}
                    disabled={busyId === app.id}
                    className="text-xs font-bold px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white disabled:opacity-60 transition-colors"
                    armedLabel="Approve & open interview?"
                  >
                    Interview
                  </ConfirmButton>
                  <DenyControl onDeny={(reason) => handleDeny(app, reason)} busy={busyId === app.id} />
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* --- Open interviews ---------------------------------------------- */}
      <section>
        <h2 className="text-sm font-bold uppercase tracking-widest text-slate-500 mb-3 flex items-center gap-2">
          🔵 In interview
          <span className="text-slate-400 font-semibold normal-case tracking-normal">({interviews.length})</span>
        </h2>
        {interviews.length === 0 ? (
          <p className="text-sm text-slate-400 bg-white rounded-xl border border-slate-200 p-4">No interviews in progress.</p>
        ) : (
          <div className="flex flex-col gap-3">
            {interviews.map(app => (
              <div key={app.id} className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 flex flex-col gap-3">
                <ApplicantHeader app={app} deniedCount={deniedCountFor(app.user_id)} />
                <p className="text-xs text-slate-500">
                  Interviewer: <span className="font-bold">{nameOf(app.reviewer) || 'Unknown'}</span>
                  {' · '}started {new Date(app.updated_at).toLocaleString()}
                </p>
                <button
                  type="button"
                  onClick={() => setOpenChatId(openChatId === app.id ? null : app.id)}
                  className="self-start text-xs font-bold px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-white transition-colors"
                >
                  {openChatId === app.id ? 'Hide chat' : 'Open chat'}
                </button>
                {openChatId === app.id && (
                  <>
                    <details className="bg-slate-50 rounded-xl border border-slate-200 p-3">
                      <summary className="text-xs font-bold text-slate-500 cursor-pointer">Application answers</summary>
                      <div className="pt-3"><AnswerList answers={app.answers} /></div>
                    </details>
                    <InterviewChat
                      applicationId={app.id}
                      currentUserId={profile?.id}
                      placeholder="Message the applicant…"
                    />
                  </>
                )}
                <div className="flex items-center gap-2 flex-wrap pt-1 border-t border-slate-100">
                  <ConfirmButton
                    onConfirm={() => handleApprove(app)}
                    disabled={busyId === app.id}
                    className="text-xs font-bold px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white disabled:opacity-60 transition-colors"
                    armedLabel="Verify this member?"
                  >
                    Approve
                  </ConfirmButton>
                  <DenyControl onDeny={(reason) => handleDeny(app, reason)} busy={busyId === app.id} />
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* --- History ------------------------------------------------------- */}
      <section>
        <h2 className="text-sm font-bold uppercase tracking-widest text-slate-500 mb-3 flex items-center gap-2">
          📜 History
          <span className="text-slate-400 font-semibold normal-case tracking-normal">({history.length})</span>
        </h2>
        {history.length === 0 ? (
          <p className="text-sm text-slate-400 bg-white rounded-xl border border-slate-200 p-4">No decided applications yet.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {history.map(app => (
              <div key={app.id} className="bg-white rounded-xl border border-slate-200 p-3 flex flex-col gap-2">
                <button
                  type="button"
                  onClick={() => setExpandedHistoryId(expandedHistoryId === app.id ? null : app.id)}
                  className="text-left"
                >
                  <ApplicantHeader app={app} deniedCount={0} />
                </button>
                <p className="text-xs text-slate-400">
                  Decided {app.decided_at ? new Date(app.decided_at).toLocaleString() : '—'}
                  {app.reviewer ? <> by <span className="font-bold">{nameOf(app.reviewer)}</span></> : null}
                  {app.denial_reason ? <> · Reason: {app.denial_reason}</> : null}
                </p>
                {expandedHistoryId === app.id && (
                  <div className="pt-2 border-t border-slate-100 flex flex-col gap-3">
                    <AnswerList answers={app.answers} />
                    <details className="bg-slate-50 rounded-xl border border-slate-200 p-3">
                      <summary className="text-xs font-bold text-slate-500 cursor-pointer">Interview transcript</summary>
                      <div className="pt-3">
                        <InterviewChat applicationId={app.id} currentUserId={profile?.id} readOnly />
                      </div>
                    </details>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
