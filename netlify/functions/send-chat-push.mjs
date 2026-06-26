import { createClient } from '@supabase/supabase-js';
import webpush from 'web-push';

const supabase = createClient(
  process.env.SUPABASE_DATABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } }
);

webpush.setVapidDetails(
  process.env.VAPID_SUBJECT,
  process.env.VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY,
);

export default async (req) => {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const authHeader = req.headers.get('authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return new Response(JSON.stringify({ error: 'Missing auth token' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const token = authHeader.slice(7);
  const { data: { user }, error: authError } = await supabase.auth.getUser(token);
  if (authError || !user) {
    return new Response(JSON.stringify({ error: 'Invalid token' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const { pending_id, message } = body;
  if (!pending_id) {
    return new Response(JSON.stringify({ error: 'Missing pending_id' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (!process.env.VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY || !process.env.VAPID_SUBJECT) {
    return new Response(JSON.stringify({ error: 'VAPID not configured' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const { data: submission } = await supabase
    .from('pending_jutsus')
    .select('submitted_by, assigned_to, data')
    .eq('id', pending_id)
    .single();

  if (!submission) {
    return new Response(JSON.stringify({ sent: 0 }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const assignedId = typeof submission.assigned_to === 'object'
    ? submission.assigned_to?.id
    : submission.assigned_to;

  const recipientIds = [submission.submitted_by, assignedId]
    .filter(Boolean)
    .filter(id => id !== user.id);

  if (!recipientIds.length) {
    return new Response(JSON.stringify({ sent: 0 }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const { data: pushSubs } = await supabase
    .from('push_subscriptions')
    .select('endpoint, p256dh, auth')
    .in('user_id', recipientIds);

  if (!pushSubs?.length) {
    return new Response(JSON.stringify({ sent: 0 }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const subName = submission.data?.name || 'a submission';
  const payload = JSON.stringify({
    title: `New message — ${subName}`,
    body: (message || '').slice(0, 80),
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
  return new Response(JSON.stringify({ sent }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};
