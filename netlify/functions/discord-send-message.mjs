import { createClient } from '@supabase/supabase-js';

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

const SNOWFLAKE = /^\d{17,20}$/;

/*
 * Sends a message into a guild channel as the bot, for the owner-only
 * Discord chat page. Owner only.
 */
export default async (req) => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const authHeader = req.headers.get('authorization');
  if (!authHeader?.startsWith('Bearer ')) return json({ error: 'Missing auth token' }, 401);
  const { data: { user }, error: authError } = await supabase.auth.getUser(authHeader.slice(7));
  if (authError || !user) return json({ error: 'Invalid token' }, 401);

  const { data: profile } = await supabase
    .from('profiles').select('role').eq('id', user.id).maybeSingle();
  if (profile?.role !== 'owner') return json({ error: 'Owner access required' }, 403);

  let body;
  try { body = await req.json(); } catch { return json({ error: 'Invalid JSON body' }, 400); }
  const { channelId, content } = body || {};

  if (!SNOWFLAKE.test(channelId || '')) return json({ error: 'Invalid channelId' }, 400);
  const trimmed = typeof content === 'string' ? content.trim() : '';
  if (!trimmed) return json({ error: 'Message content is required' }, 400);
  if (trimmed.length > 2000) return json({ error: 'Message exceeds 2000 characters' }, 400);

  const botToken = process.env.DISCORD_BOT_TOKEN;
  if (!botToken) return json({ error: 'DISCORD_BOT_TOKEN not configured' }, 500);

  const res = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Bot ${botToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ content: trimmed }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    return json({ error: `Failed to send message: ${res.status} ${text.slice(0, 200)}` }, res.status);
  }

  const m = await res.json();
  return json({
    message: {
      id: m.id,
      author: {
        id: m.author?.id,
        username: m.author?.global_name || m.author?.username || 'Unknown',
        avatar: m.author?.avatar
          ? `https://cdn.discordapp.com/avatars/${m.author.id}/${m.author.avatar}.png`
          : null,
        bot: !!m.author?.bot,
      },
      content: m.content,
      timestamp: m.timestamp,
      edited_timestamp: m.edited_timestamp,
    },
  });
};
