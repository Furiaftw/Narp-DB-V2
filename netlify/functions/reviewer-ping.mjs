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

  const { triggerType, itemName, itemType } = body;

  if (!triggerType || !itemName || !itemType) {
    return new Response(JSON.stringify({ error: 'Missing required parameters: triggerType, itemName, itemType' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const baseUrl = process.env.DISCORD_LOG_WEBHOOK_URL || process.env.VITE_DISCORD_LOG_WEBHOOK_URL;
    if (!baseUrl) {
      return new Response(JSON.stringify({ error: 'Webhook URL not configured' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const roleId = process.env.DISCORD_REVIEWER_ROLE_ID;
    if (!roleId) {
      return new Response(JSON.stringify({ error: 'Reviewer role ID not configured' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Prefer DB config, fall back to env vars
    let rawThreadId = null;
    try {
      const { data: cfgRow } = await supabase
        .from('webhook_config')
        .select('config_value')
        .eq('config_key', 'discord_ping_thread_id')
        .maybeSingle();
      rawThreadId = cfgRow?.config_value || null;
    } catch {}
    if (!rawThreadId) {
      rawThreadId = process.env.DISCORD_PING_THREAD_ID || process.env.DISCORD_JUTSU_THREAD_ID || process.env.VITE_DISCORD_JUTSU_THREAD_ID || null;
    }
    const safeThreadId = rawThreadId && /^\d{17,20}$/.test(rawThreadId) ? rawThreadId : null;
    const webhookUrl = safeThreadId ? `${baseUrl}?thread_id=${safeThreadId}` : baseUrl;

    let messageString = '';
    if (triggerType === 'creation') {
      messageString = `A new ${itemType} entry was created: **${itemName}**.`;
    } else if (triggerType === 'second_approval') {
      messageString = `<@&${roleId}> Pending approval request for the ${itemType} entry: **${itemName}**. Second pair of eyes needed!`;
    } else {
      return new Response(JSON.stringify({ error: 'Invalid triggerType' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const discordResponse = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: messageString }),
    });

    if (!discordResponse.ok) {
      const errText = await discordResponse.text();
      return new Response(JSON.stringify({ error: `Discord webhook delivery failed: ${errText}` }), {
        status: discordResponse.status,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: `Internal server error: ${err.message}` }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
