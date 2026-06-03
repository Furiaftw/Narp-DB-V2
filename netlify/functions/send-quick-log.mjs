export default async (req) => {
  // Only allow POST requests
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const {
      type,
      link,
      reviewerId,
      myCharactersLink,
      upgradesLink
    } = await req.json();

    const baseUrl = process.env.VITE_DISCORD_LOG_WEBHOOK_URL;
    if (!baseUrl) {
      return new Response(JSON.stringify({ error: 'VITE_DISCORD_LOG_WEBHOOK_URL not configured' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Map type to thread ID
    let threadId = '';
    if (type === 'Character') {
      threadId = process.env.VITE_DISCORD_OC_THREAD_ID;
    } else if (type === 'Summon') {
      threadId = process.env.VITE_DISCORD_SUMMON_THREAD_ID;
    } else if (type === 'Custom Item') {
      threadId = process.env.VITE_DISCORD_ITEM_THREAD_ID;
    }

    if (!threadId) {
      return new Response(JSON.stringify({ error: `Discord thread ID for type '${type}' not configured` }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const webhookUrl = `${baseUrl}?thread_id=${threadId}`;

    // Format the message
    let formattedMessage = `Name Reviewer: <@${reviewerId}>\nType of Submission: ${type}\nDecision: Approved\n\nLinks:\nSheet: ${link}\n`;
    if (myCharactersLink) {
      formattedMessage += `My-Characters: ${myCharactersLink}\n`;
    }
    if (upgradesLink) {
      formattedMessage += `Upgrades: ${upgradesLink}\n`;
    }

    const discordResponse = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        content: formattedMessage.trim()
      }),
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
