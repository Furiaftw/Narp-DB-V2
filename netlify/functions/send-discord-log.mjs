import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_DATABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } }
);

export default async (req) => {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Auth check
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

  const { threadId, payload } = body;

  if (!payload) {
    return new Response(JSON.stringify({ error: 'Missing payload' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const { data: controls } = await supabase
    .from('submission_controls').select('discord_notifications_paused').eq('id', 1).maybeSingle();
  if (controls?.discord_notifications_paused) {
    return new Response(JSON.stringify({ messageId: null, threadId: threadId ?? null, skipped: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Build Discord webhook URL
  const webhookBase = process.env.DISCORD_LOG_WEBHOOK_URL || process.env.VITE_DISCORD_LOG_WEBHOOK_URL;
  if (!webhookBase) {
    return new Response(JSON.stringify({ error: 'Webhook URL not configured' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  const webhookUrl = `${webhookBase}${threadId ? `?thread_id=${threadId}&wait=true` : '?wait=true'}`;

  const discordRes = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!discordRes.ok) {
    const errText = await discordRes.text();
    return new Response(JSON.stringify({ error: `Discord returned ${discordRes.status}: ${errText}` }), {
      status: discordRes.status,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const discordData = await discordRes.json();
  return new Response(JSON.stringify({ messageId: discordData?.id, threadId: threadId ?? null }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};
