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

  const { reviewerDiscordId, submitterName, docLink, myCharactersLink, upgradesLink } = body;

  if (!reviewerDiscordId) {
    return new Response(JSON.stringify({ error: 'Missing reviewerDiscordId' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const botToken = process.env.DISCORD_BOT_TOKEN;
  if (!botToken) {
    return new Response(JSON.stringify({ error: 'DISCORD_BOT_TOKEN not configured' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const submitter = submitterName || 'A player';
  let message = `⏰ **${submitter}** has completed their OC submission steps and is waiting for your final approval!`;
  if (docLink) message += `\n📄 Doc: ${docLink}`;
  if (myCharactersLink) message += `\n🔗 My-Characters: ${myCharactersLink}`;
  if (upgradesLink) message += `\n🔗 Upgrades: ${upgradesLink}`;

  try {
    const dmRes = await fetch('https://discord.com/api/v10/users/@me/channels', {
      method: 'POST',
      headers: {
        Authorization: `Bot ${botToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ recipient_id: reviewerDiscordId }),
    });
    if (!dmRes.ok) {
      const errText = await dmRes.text();
      return new Response(JSON.stringify({ error: `Failed to open DM channel: ${errText}` }), {
        status: dmRes.status,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    const { id: channelId } = await dmRes.json();

    const msgRes = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Bot ${botToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ content: message }),
    });
    if (!msgRes.ok) {
      const errText = await msgRes.text();
      return new Response(JSON.stringify({ error: `Failed to send DM: ${errText}` }), {
        status: msgRes.status,
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
