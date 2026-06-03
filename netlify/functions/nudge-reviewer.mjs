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
      pendingId,
      submitterName,
      reviewerDiscordId,
      myCharactersLink,
      upgradesLink,
      docLink
    } = await req.json();

    if (!reviewerDiscordId) {
      return new Response(JSON.stringify({ error: 'Missing reviewer Discord ID' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Attempt to DM the reviewer if a DISCORD_BOT_TOKEN is set.
    // If not, fall back to sending a webhook ping mentioning the reviewer.
    const botToken = Netlify.env.get('DISCORD_BOT_TOKEN');
    let dmSent = false;
    let errorDetail = '';

    if (botToken) {
      try {
        // 1. Create DM channel
        const dmChanRes = await fetch('https://discord.com/api/v10/users/@me/channels', {
          method: 'POST',
          headers: {
            'Authorization': `Bot ${botToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ recipient_id: reviewerDiscordId })
        });

        if (dmChanRes.ok) {
          const dmChanData = await dmChanRes.json();
          const channelId = dmChanData.id;

          // 2. Send message
          const msgRes = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
            method: 'POST',
            headers: {
              'Authorization': `Bot ${botToken}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              content: `🔔 **NARP OC submission nudge** from **${submitterName}**!\n\nBoth my-characters and character-upgrades links have been verified and submitted for review.\n\n📝 **Character Sheet:** ${docLink}\n◈ **My-Characters Thread:** ${myCharactersLink}\n◈ **Upgrades Thread:** ${upgradesLink}\n\nPlease review and approve this submission!`
            })
          });

          if (msgRes.ok) {
            dmSent = true;
          } else {
            errorDetail = `Failed to send DM message: ${await msgRes.text()}`;
          }
        } else {
          errorDetail = `Failed to create DM channel: ${await dmChanRes.text()}`;
        }
      } catch (err) {
        errorDetail = `Error during DM attempt: ${err.message}`;
      }
    }

    // If bot DM fails or isn't configured, fall back to webhook ping
    if (!dmSent) {
      console.warn('[NARP] DM nudge failed or bot token not present, falling back to webhook. Details:', errorDetail);
      const baseUrl = Netlify.env.get('DISCORD_WORK_LOG_WEBHOOK_URL') || Netlify.env.get('VITE_DISCORD_LOG_WEBHOOK_URL');
      if (!baseUrl) {
        return new Response(JSON.stringify({ error: 'No Discord webhook URL or Bot token configured to send ping.' }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      // Check if there's a specific work thread or if we just send to the general webhook
      const threadId = Netlify.env.get('DISCORD_PING_THREAD_ID') || Netlify.env.get('VITE_DISCORD_OC_THREAD_ID');
      const webhookUrl = threadId ? `${baseUrl}?thread_id=${threadId}` : baseUrl;

      const messageContent = `🔔 <@${reviewerDiscordId}> **Nudge Alert!** **${submitterName}** has completed the final step for their OC submission!\n\n📝 **Character Sheet:** ${docLink}\n◈ **My-Characters Thread:** ${myCharactersLink}\n◈ **Upgrades Thread:** ${upgradesLink}\n\nPlease head over to the database to review and approve this character.`;

      const discordResponse = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: messageContent })
      });

      if (!discordResponse.ok) {
        const errText = await discordResponse.text();
        return new Response(JSON.stringify({ error: `Discord webhook nudge delivery failed: ${errText}` }), {
          status: discordResponse.status,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    }

    return new Response(JSON.stringify({ success: true, dm: dmSent }), {
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
