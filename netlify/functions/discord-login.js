import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

export default async (req) => {
  // Only allow POST requests
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const { code } = await req.json();
    if (!code) {
      return new Response(JSON.stringify({ error: 'Missing OAuth code' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const discordClientId = process.env.VITE_DISCORD_CLIENT_ID;
    const discordClientSecret = process.env.DISCORD_CLIENT_SECRET;
    const supabaseUrl = process.env.VITE_SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!discordClientId || !discordClientSecret || !supabaseUrl || !supabaseServiceKey) {
      return new Response(JSON.stringify({ error: 'Server configuration error: missing environment variables' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // 1. Exchange the code for a Discord access token
    const tokenResponse = await fetch('https://discord.com/api/oauth2/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        client_id: discordClientId,
        client_secret: discordClientSecret,
        grant_type: 'authorization_code',
        code: code,
      }),
    });

    if (!tokenResponse.ok) {
      const errText = await tokenResponse.text();
      return new Response(JSON.stringify({ error: `Discord token exchange failed: ${errText}` }), {
        status: tokenResponse.status,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const tokenData = await tokenResponse.json();
    const accessToken = tokenData.access_token;

    // 2. Fetch the user's Discord profile
    const profileResponse = await fetch('https://discord.com/api/users/@me', {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    if (!profileResponse.ok) {
      const errText = await profileResponse.text();
      return new Response(JSON.stringify({ error: `Failed to fetch Discord profile: ${errText}` }), {
        status: profileResponse.status,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const discordUser = await profileResponse.json();
    const email = discordUser.email;

    if (!email) {
      return new Response(JSON.stringify({ error: 'Discord account has no email or email scope was not authorized' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // 3. Initialize Supabase Admin client
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });

    // 4. Generate a highly secure, random 32-character string to serve as session password
    const securePassword = crypto.randomBytes(16).toString('hex');

    // 5. Use Supabase Admin API (admin.listUsers) to check if a user with that Discord email already exists
    const { data: { users }, error: listError } = await supabaseAdmin.auth.admin.listUsers();
    if (listError) {
      return new Response(JSON.stringify({ error: `Supabase listUsers failed: ${listError.message}` }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const existingUser = users.find(
      (u) => u.email && u.email.toLowerCase() === email.toLowerCase()
    );

    if (existingUser) {
      // If YES: Update their password to this new secure string using admin.updateUserById
      const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(
        existingUser.id,
        { password: securePassword }
      );

      if (updateError) {
        return new Response(JSON.stringify({ error: `Failed to update user password: ${updateError.message}` }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    } else {
      // If NO: Create their account using admin.createUser with their email, this secure password, and their Discord metadata mapped
      const avatarUrl = discordUser.avatar
        ? `https://cdn.discordapp.com/avatars/${discordUser.id}/${discordUser.avatar}.png`
        : `https://cdn.discordapp.com/embed/avatars/${(parseInt(discordUser.id.slice(-4)) || 0) % 6}.png`;

      const { error: createError } = await supabaseAdmin.auth.admin.createUser({
        email: email,
        password: securePassword,
        email_confirm: true,
        user_metadata: {
          preferred_username: discordUser.username,
          avatar_url: avatarUrl,
          picture: avatarUrl,
          provider: 'discord',
          providers: ['discord'],
        },
      });

      if (createError) {
        return new Response(JSON.stringify({ error: `Failed to create user account: ${createError.message}` }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    }

    // 6. Return a JSON response containing { email, password }
    return new Response(JSON.stringify({ email, password: securePassword }), {
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

export const config = { path: '/.netlify/functions/discord-login' };
