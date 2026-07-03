import { createClient } from '@supabase/supabase-js';
import webpush from 'web-push';

const supabase = createClient(
  process.env.SUPABASE_DATABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } }
);

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

// web-push requires the VAPID subject to be a mailto: or http(s): URL and
// throws otherwise. A bare email pasted into the Netlify env var must not
// take down the whole function — normalize it instead.
const resolveVapidSubject = () => {
  const raw = (process.env.VAPID_SUBJECT || '').trim();
  if (/^(mailto:|https?:\/\/)/i.test(raw)) return raw;
  if (raw.includes('@')) return `mailto:${raw}`;
  return process.env.URL || 'https://narp-db-v2.netlify.app';
};

export default async (req) => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const authHeader = req.headers.get('authorization');
  if (!authHeader?.startsWith('Bearer ')) return json({ error: 'Missing auth token' }, 401);

  const token = authHeader.slice(7);
  const { data: { user }, error: authError } = await supabase.auth.getUser(token);
  if (authError || !user) return json({ error: 'Invalid token' }, 401);

  let body;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  const { pending_id, message } = body;
  if (!pending_id) return json({ error: 'Missing pending_id' }, 400);

  if (!process.env.VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY) {
    console.error('[send-chat-push] VAPID keys missing from environment');
    return json({ error: 'VAPID not configured', sent: 0 }, 500);
  }
  try {
    webpush.setVapidDetails(
      resolveVapidSubject(),
      process.env.VAPID_PUBLIC_KEY,
      process.env.VAPID_PRIVATE_KEY,
    );
  } catch (e) {
    console.error('[send-chat-push] Invalid VAPID config:', e.message);
    return json({ error: 'Invalid VAPID config: ' + e.message, sent: 0 }, 500);
  }

  const { data: submission } = await supabase
    .from('pending_jutsus')
    .select('submitted_by, assigned_to, data')
    .eq('id', pending_id)
    .single();

  if (!submission) return json({ sent: 0, reason: 'submission_not_found' });

  const assignedId = typeof submission.assigned_to === 'object'
    ? submission.assigned_to?.id
    : submission.assigned_to;

  // Notify everyone involved in this submission's conversation: the submitter,
  // the assigned reviewer, and anyone who has already posted a (non-staff-only)
  // message — not just submitter/assignee, so unassigned reviewers aren't missed.
  const { data: participants } = await supabase
    .from('pending_chats')
    .select('sender_id')
    .eq('pending_id', pending_id)
    .eq('is_staff_only', false);

  const recipientIds = [...new Set([
    submission.submitted_by,
    assignedId,
    ...(participants || []).map(p => p.sender_id),
  ])]
    .filter(Boolean)
    .filter(id => id !== user.id);

  if (!recipientIds.length) return json({ sent: 0, reason: 'no_recipients' });

  const { data: pushSubs } = await supabase
    .from('push_subscriptions')
    .select('endpoint, p256dh, auth')
    .in('user_id', recipientIds);

  if (!pushSubs?.length) return json({ sent: 0, reason: 'no_subscriptions' });

  const { data: senderProfile } = await supabase
    .from('profiles')
    .select('username')
    .eq('id', user.id)
    .single();

  const senderName = senderProfile?.username || 'Someone';
  const subName = submission.data?.name || 'a submission';
  const payload = JSON.stringify({
    title: `${senderName} — ${subName}`,
    body: (message || '').slice(0, 140),
    tag: `pending-${pending_id}`,
  });

  const results = await Promise.allSettled(
    pushSubs.map(s =>
      webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        payload
      )
    )
  );

  // Remove expired/invalid subscriptions (410 Gone)
  const gone = results
    .map((r, i) => ({ r, s: pushSubs[i] }))
    .filter(({ r }) => r.status === 'rejected' && r.reason?.statusCode === 410)
    .map(({ s }) => s.endpoint);

  if (gone.length) {
    await supabase.from('push_subscriptions').delete().in('endpoint', gone);
  }

  const sent = results.filter(r => r.status === 'fulfilled').length;
  const failed = results
    .filter(r => r.status === 'rejected')
    .map(r => r.reason?.statusCode || r.reason?.message || 'unknown');
  console.log(
    `[send-chat-push] pending=${pending_id} recipients=${recipientIds.length} subs=${pushSubs.length} sent=${sent} pruned=${gone.length}` +
    (failed.length ? ` failed=${JSON.stringify(failed)}` : '')
  );
  return json({ sent, failed });
};
