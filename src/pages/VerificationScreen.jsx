import { useState, useEffect, useRef } from 'react';
import {
  fetchMyApplications,
  submitJoinApplication,
  subscribeToApplicationChanges,
  supabase,
} from '../lib/supabase';
import InterviewChat from '../components/features/InterviewChat';
import Icon from '../components/ui/Icon';

/*
 * Full-screen flow for logged-in but unverified users — the only thing they
 * can see until an admin approves them. Mirrors the Discord server's join
 * application, then tracks the application through pending → interview →
 * approved/denied, live.
 */

const QUESTIONS = [
  { key: 'why_join', label: 'Why do you want to join our server?', type: 'long' },
  { key: 'how_found', label: 'How did you find us?', type: 'short' },
  { key: 'most_active_server', label: "What's the Roleplay server you are the most active in right now?", type: 'short' },
  { key: 'rp_server_count', label: 'How many RP servers are you currently in?', type: 'choice', options: ['0', '1', '2', '3+'] },
  { key: 'age', label: 'What is your age?', type: 'short', inputMode: 'numeric' },
];

const emptyAnswers = () => Object.fromEntries(QUESTIONS.map(q => [q.key, '']));

export default function VerificationScreen({ profile, onSignOut, onProfileRefresh }) {
  const [applications, setApplications] = useState(null); // null = still loading
  const [answers, setAnswers] = useState(emptyAnswers);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState(null);
  const [showForm, setShowForm] = useState(false); // re-apply after a denial
  const refreshedRef = useRef(false);

  const loadApplications = async () => {
    try {
      const rows = await fetchMyApplications();
      setApplications(rows);
    } catch (err) {
      console.error('[NARP] Failed to load applications:', err);
      setApplications([]);
    }
  };

  useEffect(() => {
    loadApplications();
  }, []);

  // Live status updates (RLS scopes events to this user's own rows) with a
  // 30s poll backstop in case the tables aren't in the realtime publication.
  useEffect(() => {
    const channel = subscribeToApplicationChanges(() => loadApplications());
    const poll = setInterval(loadApplications, 30000);
    return () => {
      if (channel && supabase) supabase.removeChannel(channel);
      clearInterval(poll);
    };
  }, []);

  const latest = applications?.[0] || null;

  // The moment the application flips to approved, the profile's verified flag
  // is already true in the DB — refresh it so the gate opens without a reload.
  useEffect(() => {
    if (latest?.status === 'approved' && !refreshedRef.current) {
      refreshedRef.current = true;
      onProfileRefresh?.();
    }
  }, [latest?.status]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (submitting) return;
    const missing = QUESTIONS.filter(q => !String(answers[q.key] || '').trim());
    if (missing.length) {
      setFormError('Please answer every question.');
      return;
    }
    setFormError(null);
    setSubmitting(true);
    try {
      await submitJoinApplication(answers);

      // Ping the community admins in Discord — never block the submission on it.
      fetch('/.netlify/functions/reviewer-ping', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          triggerType: 'join_application',
          itemName: profile?.username || 'Unknown',
          itemType: 'Join Application',
          submitterName: profile?.site_nickname || profile?.username || 'Unknown',
        }),
      }).catch((pingErr) => {
        console.warn('[NARP] Join application ping failed:', pingErr);
      });

      setAnswers(emptyAnswers());
      setShowForm(false);
      await loadApplications();
    } catch (err) {
      console.error('[NARP] Failed to submit application:', err);
      setFormError(err.message || 'Failed to submit application.');
    } finally {
      setSubmitting(false);
    }
  };

  const shell = (children) => (
    <div className="w-full min-h-screen bg-black flex flex-col items-center p-4 sm:p-6 font-sans">
      <div className="w-full max-w-xl flex items-center justify-between py-3 mb-2">
        <h1 className="text-sm font-bold tracking-widest uppercase flex items-center gap-2 text-white">
          <Icon n="Book" size={16} className="text-red-500" />
          NARP Database
        </h1>
        <button
          onClick={onSignOut}
          type="button"
          className="text-xs px-3 py-1.5 font-bold rounded-lg bg-slate-800 text-slate-300 hover:bg-slate-700 border border-slate-700 transition-colors"
        >
          Sign out
        </button>
      </div>
      <div className="w-full max-w-xl bg-white rounded-2xl shadow-2xl overflow-hidden flex flex-col">
        {children}
      </div>
    </div>
  );

  if (applications === null) {
    return shell(
      <div className="flex flex-col items-center justify-center gap-4 p-16">
        <div className="w-8 h-8 border-3 border-indigo-500 border-t-transparent rounded-full animate-spin" />
        <p className="text-slate-400 text-sm font-semibold">Loading…</p>
      </div>
    );
  }

  /* --- Interview: chat with the admin ---------------------------------- */
  if (latest?.status === 'interview') {
    return shell(
      <>
        <div className="bg-slate-900 text-white p-5">
          <h2 className="font-bold text-lg font-serif flex items-center gap-2">
            <Icon n="User" size={18} className="text-amber-400" />
            Verification interview
          </h2>
          <p className="text-xs text-slate-400 mt-1 leading-relaxed">
            An admin reviewed your application and opened your interview. Answer
            their questions below — they'll make the final call at the end.
          </p>
        </div>
        <div className="p-4">
          <InterviewChat
            applicationId={latest.id}
            currentUserId={profile?.id}
            placeholder="Reply to the admin…"
          />
        </div>
      </>
    );
  }

  /* --- Pending: waiting for an admin ------------------------------------ */
  if (latest?.status === 'pending') {
    return shell(
      <div className="flex flex-col items-center gap-4 p-10 text-center">
        <Icon n="Clock" size={40} className="text-amber-500" />
        <h2 className="font-bold text-lg font-serif text-slate-900">Application received</h2>
        <p className="text-sm text-slate-600 leading-relaxed max-w-sm">
          Your join application is waiting for an admin to review it. If it's
          approved, an interview chat will open right here — check back soon.
        </p>
        <p className="text-xs text-slate-400">
          Submitted {new Date(latest.created_at).toLocaleString()}
        </p>
      </div>
    );
  }

  /* --- Approved: profile refresh is in flight --------------------------- */
  if (latest?.status === 'approved') {
    return shell(
      <div className="flex flex-col items-center gap-4 p-10 text-center">
        <Icon n="CheckCir" size={40} className="text-emerald-500" />
        <h2 className="font-bold text-lg font-serif text-slate-900">You're verified!</h2>
        <p className="text-sm text-slate-600 leading-relaxed max-w-sm">
          Welcome to the community. Your access is being unlocked now.
        </p>
        <button
          onClick={() => onProfileRefresh?.()}
          type="button"
          className="bg-indigo-600 hover:bg-indigo-700 text-white px-5 py-2.5 rounded-xl text-sm font-bold transition-colors"
        >
          Enter the database
        </button>
      </div>
    );
  }

  /* --- No application yet, or latest was denied: the form ---------------- */
  const wasDenied = latest?.status === 'denied';

  if (wasDenied && !showForm) {
    return shell(
      <div className="flex flex-col items-center gap-4 p-10 text-center">
        <Icon n="Alert" size={40} className="text-rose-500" />
        <h2 className="font-bold text-lg font-serif text-slate-900">Application denied</h2>
        <p className="text-sm text-slate-600 leading-relaxed max-w-sm">
          {latest.denial_reason
            ? <>An admin reviewed your application and denied it with the note: <span className="font-semibold">"{latest.denial_reason}"</span></>
            : 'An admin reviewed your application and denied it.'}
        </p>
        <button
          onClick={() => setShowForm(true)}
          type="button"
          className="bg-indigo-600 hover:bg-indigo-700 text-white px-5 py-2.5 rounded-xl text-sm font-bold transition-colors"
        >
          Apply again
        </button>
      </div>
    );
  }

  return shell(
    <>
      <div className="bg-slate-900 text-white p-5">
        <h2 className="font-bold text-lg font-serif">Join application</h2>
        <p className="text-xs text-slate-400 mt-1 leading-relaxed">
          Hi {profile?.site_nickname || profile?.username || 'there'}! The
          database is for verified community members. Answer these questions and
          an admin will review your application.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="p-5 flex flex-col gap-5">
        {QUESTIONS.map((q) => (
          <div key={q.key} className="flex flex-col gap-1.5">
            <label className="text-sm font-bold text-slate-800">{q.label}</label>
            {q.type === 'choice' ? (
              <div className="flex gap-2">
                {q.options.map((opt) => (
                  <button
                    key={opt}
                    type="button"
                    onClick={() => setAnswers(a => ({ ...a, [q.key]: opt }))}
                    className={`px-4 py-2 rounded-xl text-sm font-bold border transition-colors ${
                      answers[q.key] === opt
                        ? 'bg-indigo-600 text-white border-indigo-600'
                        : 'bg-white text-slate-700 border-slate-300 hover:border-indigo-400'
                    }`}
                  >
                    {opt}
                  </button>
                ))}
              </div>
            ) : q.type === 'long' ? (
              <textarea
                value={answers[q.key]}
                onChange={e => setAnswers(a => ({ ...a, [q.key]: e.target.value }))}
                rows={3}
                className="border border-slate-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400 resize-none"
              />
            ) : (
              <input
                type="text"
                inputMode={q.inputMode}
                value={answers[q.key]}
                onChange={e => setAnswers(a => ({ ...a, [q.key]: e.target.value }))}
                className="border border-slate-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
              />
            )}
          </div>
        ))}

        {formError && (
          <p className="text-sm text-rose-600 font-semibold">{formError}</p>
        )}

        <button
          type="submit"
          disabled={submitting}
          className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 text-white px-5 py-3 rounded-xl text-sm font-bold transition-colors"
        >
          {submitting ? 'Submitting…' : 'Submit application'}
        </button>
      </form>
    </>
  );
}
