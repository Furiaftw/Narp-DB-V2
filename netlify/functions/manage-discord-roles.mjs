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
 * Adds/removes Discord guild roles on a member, for the OC-submission role
 * automation (Has Character at final step; village/rank/councilor/OC-count
 * at approval). Staff/admin/owner only. The bot needs Manage Roles and its
 * highest role must sit above every role it manages.
 */
export default async (req) => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const authHeader = req.headers.get('authorization');
  if (!authHeader?.startsWith('Bearer ')) return json({ error: 'Missing auth token' }, 401);
  const { data: { user }, error: authError } = await supabase.auth.getUser(authHeader.slice(7));
  if (authError || !user) return json({ error: 'Invalid token' }, 401);

  const { data: profile } = await supabase
    .from('profiles').select('role').eq('id', user.id).maybeSingle();
  if (!['staff', 'admin', 'owner'].includes(profile?.role)) {
    return json({ error: 'Staff access required' }, 403);
  }

  let body;
  try { body = await req.json(); } catch { return json({ error: 'Invalid JSON body' }, 400); }
  const { discordUserId, add = [], remove = [], reason = '' } = body || {};

  if (!SNOWFLAKE.test(discordUserId || '')) return json({ error: 'Invalid discordUserId' }, 400);
  const addIds = [...new Set(add)].filter(id => SNOWFLAKE.test(id));
  const removeIds = [...new Set(remove)].filter(id => SNOWFLAKE.test(id));
  if (!addIds.length && !removeIds.length) return json({ error: 'Nothing to do' }, 400);

  const botToken = process.env.DISCORD_BOT_TOKEN;
  if (!botToken) return json({ error: 'DISCORD_BOT_TOKEN not configured' }, 500);
  const guildId = process.env.VITE_DISCORD_GUILD_ID || '1473338897697214584';

  const headers = {
    Authorization: `Bot ${botToken}`,
    'X-Audit-Log-Reason': (reason || 'NARP DB OC submission role automation').slice(0, 100),
  };

  const failures = [];
  const call = async (method, roleId) => {
    const res = await fetch(
      `https://discord.com/api/v10/guilds/${guildId}/members/${discordUserId}/roles/${roleId}`,
      { method, headers }
    );
    // 204 = success; DELETE of a role the member lacks is also 204 (no-op).
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      failures.push(`${method === 'PUT' ? 'add' : 'remove'} ${roleId}: ${res.status} ${text.slice(0, 120)}`);
    }
  };

  for (const roleId of removeIds) await call('DELETE', roleId);
  for (const roleId of addIds) await call('PUT', roleId);

  return json({ ok: failures.length === 0, added: addIds, removed: removeIds, failures });
};
