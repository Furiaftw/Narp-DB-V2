import { createClient } from '@supabase/supabase-js';

// Lists the current Discord server's roles so System Tools can offer them in
// a dropdown instead of an operator hand-typing a role snowflake. Admin+
// only -- runs on the service role key, so the role check here is the only
// gate. Requires the bot (DISCORD_BOT_TOKEN) to actually be a member of the
// guild named by VITE_DISCORD_GUILD_ID; until both are set up for the new
// server this reports a clear "not configured" error rather than failing
// silently.

const json = (body, status) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

const ROLE_RANK = { user: 0, grader: 1, reviewer: 2, admin: 3, owner: 4 };

export default async (req) => {
  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405);
  }

  const supabaseUrl = Netlify.env.get('VITE_SUPABASE_URL') || process.env.VITE_SUPABASE_URL || Netlify.env.get('SUPABASE_DATABASE_URL') || process.env.SUPABASE_DATABASE_URL || Netlify.env.get('VITE_SUPABASE_DATABASE_URL') || process.env.VITE_SUPABASE_DATABASE_URL;
  const supabaseServiceKey = Netlify.env.get('SUPABASE_SERVICE_ROLE_KEY') || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseServiceKey) {
    return json({ error: 'Server configuration error: missing Supabase credentials' }, 500);
  }

  const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // ---- Authenticate + authorize the caller (admin+ only) -------------------
  const authHeader = req.headers.get('authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return json({ error: 'Missing auth token' }, 401);
  }
  const { data: { user: callerUser }, error: callerAuthError } =
    await supabaseAdmin.auth.getUser(authHeader.slice(7));
  if (callerAuthError || !callerUser) {
    return json({ error: 'Invalid token' }, 401);
  }
  const { data: callerProfile, error: callerProfileError } = await supabaseAdmin
    .from('profiles')
    .select('role')
    .eq('id', callerUser.id)
    .maybeSingle();
  if (callerProfileError || !callerProfile) {
    return json({ error: 'Could not verify your permissions' }, 500);
  }
  if ((ROLE_RANK[callerProfile.role] ?? -1) < ROLE_RANK.admin) {
    return json({ error: 'Forbidden: admin role required' }, 403);
  }

  // ---- Fetch the guild's roles from Discord --------------------------------
  const guildId = Netlify.env.get('VITE_DISCORD_GUILD_ID') || process.env.VITE_DISCORD_GUILD_ID;
  const botToken = Netlify.env.get('DISCORD_BOT_TOKEN') || process.env.DISCORD_BOT_TOKEN;
  if (!guildId || !botToken) {
    return json({ error: 'Discord guild/bot is not configured yet (VITE_DISCORD_GUILD_ID / DISCORD_BOT_TOKEN)' }, 500);
  }

  try {
    const res = await fetch(`https://discord.com/api/v10/guilds/${guildId}/roles`, {
      headers: { Authorization: `Bot ${botToken}` },
    });
    if (!res.ok) {
      const errText = await res.text();
      return json({ error: `Discord API returned ${res.status}: ${errText}` }, res.status === 404 ? 404 : 502);
    }
    const roles = await res.json();
    // Drop the implicit @everyone role (its id === the guild id) and sort
    // highest-in-the-hierarchy first, matching how Discord's own UI orders them.
    const filtered = (roles || [])
      .filter(r => r.id !== guildId)
      .sort((a, b) => b.position - a.position)
      .map(r => ({ id: r.id, name: r.name, color: r.color }));
    return json({ roles: filtered }, 200);
  } catch (err) {
    return json({ error: `Internal server error: ${err.message}` }, 500);
  }
};
