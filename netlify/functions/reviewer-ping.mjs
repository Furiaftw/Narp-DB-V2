export default async (req) => {
  // Only allow POST requests
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const { triggerType, itemName, itemType } = await req.json();

    if (!triggerType || !itemName || !itemType) {
      return new Response(JSON.stringify({ error: 'Missing required parameters: triggerType, itemName, itemType' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

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

    const threadId = process.env.DISCORD_PING_THREAD_ID || process.env.DISCORD_JUTSU_THREAD_ID || process.env.VITE_DISCORD_JUTSU_THREAD_ID;
    const webhookUrl = threadId ? `${baseUrl}?thread_id=${threadId}` : baseUrl;

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
      headers: {
        'Content-Type': 'application/json',
      },
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


