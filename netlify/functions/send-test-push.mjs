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

// Sends a confirmation push to the *signed-in user's own* devices. Unlike
// send-chat-push it does NOT exclude the caller — its whole purpose is to let a
// user verify, from a single device, that the full server-side push pipeline
// (VAPID keys + web-push + their subscription) actually works.
export default async (req) => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const authHeader = req.headers.get('authorization');
  if (!authHeader?.startsWith('Bearer ')) return json({ error: 'Missing auth token' }, 401);

  const token = authHeader.slice(7);
  const { data: { user }, error: authError } = await supabase.auth.getUser(token);
  if (authError || !user) return json({ error: 'Invalid token' }, 401);

  const { VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY } = process.env;
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
    return json({ error: 'VAPID not configured', sent: 0 }, 500);
  }
  // web-push requires a mailto:/http(s) subject and throws on a bare email —
  // normalize instead of failing (same logic as send-chat-push).
  const raw = (VAPID_SUBJECT || '').trim();
  const subject = /^(mailto:|https?:\/\/)/i.test(raw) ? raw
    : raw.includes('@') ? `mailto:${raw}`
    : process.env.URL || 'https://narp-db-v2.netlify.app';
  try {
    webpush.setVapidDetails(subject, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
  } catch (e) {
    return json({ error: 'Invalid VAPID config: ' + e.message, sent: 0 }, 500);
  }

  const { data: subs } = await supabase
    .from('push_subscriptions')
    .select('endpoint, p256dh, auth')
    .eq('user_id', user.id);

  if (!subs?.length) return json({ sent: 0, reason: 'no_subscriptions' });

  const payload = JSON.stringify({
    title: '🔔 Notifications are working!',
    body: "You'll get a push like this whenever someone messages you.",
    tag: 'narp-test',
  });

  const results = await Promise.allSettled(
    subs.map(s =>
      webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        payload
      )
    )
  );

  // Prune expired subscriptions (410 Gone).
  const gone = results
    .map((r, i) => ({ r, s: subs[i] }))
    .filter(({ r }) => r.status === 'rejected' && r.reason?.statusCode === 410)
    .map(({ s }) => s.endpoint);
  if (gone.length) {
    await supabase.from('push_subscriptions').delete().in('endpoint', gone);
  }

  const sent = results.filter(r => r.status === 'fulfilled').length;
  const failed = results
    .filter(r => r.status === 'rejected')
    .map(r => r.reason?.statusCode || r.reason?.message || 'unknown');
  console.log(`[send-test-push] user=${user.id} subs=${subs.length} sent=${sent} pruned=${gone.length}` +
    (failed.length ? ` failed=${JSON.stringify(failed)}` : ''));

  return json({ sent, failed });
};
