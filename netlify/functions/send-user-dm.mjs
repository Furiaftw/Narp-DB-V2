export default async (req) => {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const { discordId, actionType, itemName } = await req.json();

    if (!discordId || !actionType || !itemName) {
      return new Response(JSON.stringify({ error: 'Missing required parameters: discordId, actionType, itemName' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const messageTemplates = {
      claim: "Hello! Your submission [itemName] is under review. Hear nothing from us after 24 hours? You can request an update and the review team will prioritize your submission!.",
      handoff: "Your submission [itemName] is looking good! A 2nd review is incoming.",
      nudge: "Friendly Reminder: We need your response on [itemName] to continue the review! Or we will need to delete this submission to free up space.",
      approve: "Great news! Your submission [itemName] has been approved."
    };

    const template = messageTemplates[actionType];
    if (!template) {
      return new Response(JSON.stringify({ error: `Invalid actionType: ${actionType}` }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const messageText = template.replace('[itemName]', itemName);

    const botToken = process.env.DISCORD_BOT_TOKEN;
    if (!botToken) {
      console.error('[send-user-dm] DISCORD_BOT_TOKEN is not configured in environment variables');
      return new Response(JSON.stringify({ error: 'DISCORD_BOT_TOKEN not configured' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Wrap the entire Discord API call in a try/catch as a failsafe
    try {
      // 1. Open DM channel
      console.log(`[send-user-dm] Attempting to open DM channel with user ${discordId}`);
      const openDmResponse = await fetch('https://discord.com/api/v10/users/@me/channels', {
        method: 'POST',
        headers: {
          'Authorization': `Bot ${botToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ recipient_id: discordId })
      });

      if (!openDmResponse.ok) {
        const errorText = await openDmResponse.text();
        throw new Error(`Failed to open DM channel: ${openDmResponse.status} - ${errorText}`);
      }

      const dmChannel = await openDmResponse.json();
      const channelId = dmChannel.id;
      if (!channelId) {
        throw new Error(`No channel ID returned from Discord API: ${JSON.stringify(dmChannel)}`);
      }

      // 2. Send the message
      console.log(`[send-user-dm] Attempting to send message to channel ${channelId}`);
      const sendMessageResponse = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
        method: 'POST',
        headers: {
          'Authorization': `Bot ${botToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ content: messageText })
      });

      if (!sendMessageResponse.ok) {
        const errorText = await sendMessageResponse.text();
        throw new Error(`Failed to send message: ${sendMessageResponse.status} - ${errorText}`);
      }

      console.log(`[send-user-dm] Successfully sent DM to user ${discordId}`);
    } catch (discordError) {
      // Failsafe (Crucial): Wrap the entire Discord API call in a try/catch.
      // If the Discord API returns an error (e.g., 403 Forbidden because the user has DMs closed),
      // log it to the console, but return a 200 OK status to the frontend.
      console.error('[send-user-dm] Failsafe caught Discord API error:', discordError.message || discordError);
      return new Response(JSON.stringify({ success: false, error: 'Discord API error occurred, returned 200 via failsafe' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (err) {
    console.error('[send-user-dm] Unhandled internal function error:', err);
    return new Response(JSON.stringify({ error: `Internal server error: ${err.message}` }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};

export const config = { path: '/.netlify/functions/send-user-dm' };
