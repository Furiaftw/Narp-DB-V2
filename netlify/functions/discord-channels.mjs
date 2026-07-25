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

// Text-postable channel types: 0 = GUILD_TEXT, 5 = GUILD_ANNOUNCEMENT.
const TEXT_TYPES = new Set([0, 5]);

/*
 * Lists the guild's text channels for the owner-only Discord chat page.
 * Owner only (stricter than the staff/admin/owner gate used elsewhere,
 * since this exposes every channel the bot can see).
 */
export default async (req) => {
  if (req.method !== 'GET') return json({ error: 'Method not allowed' }, 405);

  const authHeader = req.headers.get('authorization');
  if (!authHeader?.startsWith('Bearer ')) return json({ error: 'Missing auth token' }, 401);
  const { data: { user }, error: authError } = await supabase.auth.getUser(authHeader.slice(7));
  if (authError || !user) return json({ error: 'Invalid token' }, 401);

  const { data: profile } = await supabase
    .from('profiles').select('role').eq('id', user.id).maybeSingle();
  if (profile?.role !== 'owner') return json({ error: 'Owner access required' }, 403);

  const botToken = process.env.DISCORD_BOT_TOKEN;
  if (!botToken) return json({ error: 'DISCORD_BOT_TOKEN not configured' }, 500);
  const guildId = process.env.VITE_DISCORD_GUILD_ID || '1473338897697214584';

  const res = await fetch(`https://discord.com/api/v10/guilds/${guildId}/channels`, {
    headers: { Authorization: `Bot ${botToken}` },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    return json({ error: `Failed to list channels: ${res.status} ${text.slice(0, 200)}` }, res.status);
  }

  const channels = await res.json();
  const categories = new Map(
    channels.filter(c => c.type === 4).map(c => [c.id, { name: c.name, position: c.position }])
  );

  const list = channels
    .filter(c => TEXT_TYPES.has(c.type))
    .map(c => ({
      id: c.id,
      name: c.name,
      type: c.type,
      position: c.position,
      parent_id: c.parent_id || null,
      category_name: c.parent_id ? (categories.get(c.parent_id)?.name || null) : null,
    }))
    .sort((a, b) => {
      const catA = a.parent_id ? (categories.get(a.parent_id)?.position ?? 0) : -1;
      const catB = b.parent_id ? (categories.get(b.parent_id)?.position ?? 0) : -1;
      if (catA !== catB) return catA - catB;
      return a.position - b.position;
    });

  return json({ channels: list });
};
