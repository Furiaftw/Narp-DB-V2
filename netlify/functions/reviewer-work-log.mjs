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
      threadId,
      reviewerId,
      reviewerName,
      actionType,
      itemName,
      docLink,
      mainLogUrl
    } = await req.json();

    if (!threadId) {
      return new Response(JSON.stringify({ error: 'Missing threadId' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const baseUrl = process.env.DISCORD_WORK_LOG_WEBHOOK_URL;
    if (!baseUrl) {
      return new Response(JSON.stringify({ error: 'DISCORD_WORK_LOG_WEBHOOK_URL not configured' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const webhookUrl = `${baseUrl}?thread_id=${threadId}`;

    const isNegative = /den|reject|delet|cancel/i.test(actionType || '');
    const color = isNegative ? 15158332 : 3066993;

    const description = [
      `**Reviewer:** <@${reviewerId}>`,
      `**Action Type:** ${actionType}`,
      `**Document Link:** ${docLink}`
    ].join('\n');

    const embed = {
      title: `${actionType}: ${itemName}`,
      description,
      color,
    };

    if (mainLogUrl) {
      embed.fields = [{
        name: 'Logs',
        value: `[Jump to Main Log](${mainLogUrl})`,
        inline: false
      }];
    }

    const discordResponse = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        embeds: [embed]
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
