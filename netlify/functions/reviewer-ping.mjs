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

  let body;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const { triggerType, itemName, itemType, submitterName, pingCount } = body;

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

    // Prefer DB config (editable live from System Tools), fall back to env vars
    let rawRoleId = null;
    let rawThreadId = null;
    let rawCommunityRoleId = null;
    let rawApplicationThreadId = null;
    try {
      const { data: cfgRows } = await supabase
        .from('webhook_config')
        .select('config_key, config_value')
        .in('config_key', ['discord_reviewer_role_id', 'discord_ping_thread_id', 'discord_community_admin_role_id', 'discord_application_thread_id']);
      rawRoleId = cfgRows?.find(r => r.config_key === 'discord_reviewer_role_id')?.config_value || null;
      rawThreadId = cfgRows?.find(r => r.config_key === 'discord_ping_thread_id')?.config_value || null;
      rawCommunityRoleId = cfgRows?.find(r => r.config_key === 'discord_community_admin_role_id')?.config_value || null;
      rawApplicationThreadId = cfgRows?.find(r => r.config_key === 'discord_application_thread_id')?.config_value || null;
    } catch {}
    if (!rawRoleId) {
      rawRoleId = process.env.DISCORD_REVIEWER_ROLE_ID || null;
    }
    if (!rawThreadId) {
      rawThreadId = process.env.DISCORD_PING_THREAD_ID || process.env.DISCORD_JUTSU_THREAD_ID || process.env.VITE_DISCORD_JUTSU_THREAD_ID || null;
    }
    if (!rawCommunityRoleId) {
      rawCommunityRoleId = process.env.DISCORD_COMMUNITY_ADMIN_ROLE_ID || null;
    }
    if (!rawApplicationThreadId) {
      rawApplicationThreadId = process.env.DISCORD_APPLICATION_THREAD_ID || null;
    }

    // Community verification: new join application. Mentions the community
    // admin role when configured, and posts to the application thread if one
    // is set (falling back to the general ping thread, then the bare webhook).
    if (triggerType === 'join_application') {
      const communityRoleId = rawCommunityRoleId && /^\d{17,20}$/.test(rawCommunityRoleId) ? rawCommunityRoleId : null;
      const appThreadId =
        (rawApplicationThreadId && /^\d{17,20}$/.test(rawApplicationThreadId) ? rawApplicationThreadId : null)
        || (rawThreadId && /^\d{17,20}$/.test(rawThreadId) ? rawThreadId : null);
      const appWebhookUrl = appThreadId ? `${baseUrl}?thread_id=${appThreadId}` : baseUrl;
      const mention = communityRoleId ? `<@&${communityRoleId}> ` : '';
      const appMessage = `${mention}New join application from **${submitterName || itemName}**. Review it in the database's Applications tab.`;

      const appResponse = await fetch(appWebhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: appMessage }),
      });
      if (!appResponse.ok) {
        const errText = await appResponse.text();
        return new Response(JSON.stringify({ error: `Discord webhook delivery failed: ${errText}` }), {
          status: appResponse.status,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const roleId = rawRoleId && /^\d{17,20}$/.test(rawRoleId) ? rawRoleId : null;
    if (!roleId) {
      return new Response(JSON.stringify({ error: 'Reviewer role ID not configured' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    const safeThreadId = rawThreadId && /^\d{17,20}$/.test(rawThreadId) ? rawThreadId : null;
    const webhookUrl = safeThreadId ? `${baseUrl}?thread_id=${safeThreadId}` : baseUrl;

    let messageString = '';
    if (triggerType === 'creation') {
      const byLine = submitterName ? ` by ${submitterName}` : '';
      messageString = `A new technique submission entry was uploaded: **${itemName}**${byLine}.`;
    } else if (triggerType === 'retracted') {
      messageString = `Technique submission **${itemName}** was retracted by the player.`;
    } else if (triggerType === 'second_approval') {
      const count = Number.isInteger(pingCount) && pingCount > 0 ? pingCount : 1;
      messageString = `<@&${roleId}> Pending approval request for the ${itemType} entry: **${itemName}**. Second pair of eyes needed! (How many pings has it been requesting a second reviewer: **${count}**)`;
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
