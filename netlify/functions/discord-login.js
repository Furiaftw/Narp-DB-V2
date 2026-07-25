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

    const discordClientId = Netlify.env.get('VITE_DISCORD_CLIENT_ID') || process.env.VITE_DISCORD_CLIENT_ID;
    const discordClientSecret = Netlify.env.get('DISCORD_CLIENT_SECRET') || process.env.DISCORD_CLIENT_SECRET;
    const discordGuildId = Netlify.env.get('VITE_DISCORD_GUILD_ID') || process.env.VITE_DISCORD_GUILD_ID;
    const envAdminRoleId = Netlify.env.get('DISCORD_ADMIN_ROLE_ID') || process.env.DISCORD_ADMIN_ROLE_ID;
    const envReviewerRoleId = Netlify.env.get('DISCORD_REVIEWER_ROLE_ID') || process.env.DISCORD_REVIEWER_ROLE_ID;

    const supabaseUrl = Netlify.env.get('VITE_SUPABASE_URL') || process.env.VITE_SUPABASE_URL || Netlify.env.get('SUPABASE_DATABASE_URL') || process.env.SUPABASE_DATABASE_URL || Netlify.env.get('VITE_SUPABASE_DATABASE_URL') || process.env.VITE_SUPABASE_DATABASE_URL;
    const supabaseServiceKey = Netlify.env.get('SUPABASE_SERVICE_ROLE_KEY') || process.env.SUPABASE_SERVICE_ROLE_KEY;

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

    // 2. Fetch the base profile via https://discord.com/api/users/@me
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

    // 3. Fetch the server-specific member profile to get their roles via https://discord.com/api/users/@me/guilds/${discordGuildId}/member
    let memberRoles = [];
    if (discordGuildId) {
      const memberResponse = await fetch(`https://discord.com/api/users/@me/guilds/${discordGuildId}/member`, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });

      if (memberResponse.ok) {
        const memberData = await memberResponse.json();
        memberRoles = memberData.roles || [];
      } else {
        const errText = await memberResponse.text();
        console.warn(`Failed to fetch guild member roles: ${errText}`);
      }
    } else {
      console.warn('VITE_DISCORD_GUILD_ID is not set, skipping roles fetch');
    }

    // 4. Supabase Admin client — created early so role sync (below) can read
    // the live DB config for role IDs before Discord login/DB sync (step 5).
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });

    // 4b. Role Sync Logic
    // Determine the user's application role (appRole) based on exact hierarchy:
    // - IF the member's roles array includes the admin role ID, set appRole = 'admin'.
    // - ELSE IF the member's roles array includes the reviewer role ID, set appRole = 'staff'. (NOTE: Keep the database value as 'staff', do not use 'reviewer').
    // - ELSE IF the member's roles array includes the OC staff role ID, set appRole = 'oc_staff' ("Staff" — OC-only reviewer).
    // - ELSE, set appRole = 'user'.
    // 'owner' is never auto-derived here — it is only ever set by a direct
    // database edit (see STEP 6 below, which also never downgrades an
    // existing owner regardless of what this hierarchy computes).
    // Role IDs prefer the live DB config (System Tools) over the env vars, since
    // env vars are frozen at deploy time and the operator panel edits the DB.
    let adminRoleId = envAdminRoleId;
    let reviewerRoleId = envReviewerRoleId;
    let ocStaffRoleId = process.env.DISCORD_OC_STAFF_ROLE_ID;
    try {
      const { data: cfgRows } = await supabaseAdmin
        .from('webhook_config')
        .select('config_key, config_value')
        .in('config_key', ['discord_admin_role_id', 'discord_reviewer_role_id', 'discord_oc_staff_role_id']);
      adminRoleId = cfgRows?.find(r => r.config_key === 'discord_admin_role_id')?.config_value || adminRoleId;
      reviewerRoleId = cfgRows?.find(r => r.config_key === 'discord_reviewer_role_id')?.config_value || reviewerRoleId;
      ocStaffRoleId = cfgRows?.find(r => r.config_key === 'discord_oc_staff_role_id')?.config_value || ocStaffRoleId;
    } catch { /* fall through to env vars already read above */ }

    let appRole = 'user';
    if (adminRoleId && memberRoles.includes(String(adminRoleId))) {
      appRole = 'admin';
    } else if (reviewerRoleId && memberRoles.includes(String(reviewerRoleId))) {
      appRole = 'staff';
    } else if (ocStaffRoleId && memberRoles.includes(String(ocStaffRoleId))) {
      appRole = 'oc_staff';
    }

    // Generate a highly secure, random 32-character string to serve as session password
    const securePassword = crypto.randomBytes(16).toString('hex');

    // Check if the user exists via admin.listUsers()
    const { data: { users }, error: listError } = await supabaseAdmin.auth.admin.listUsers({ perPage: 1000, page: 1 });
    if (listError) {
      return new Response(JSON.stringify({ error: `Supabase listUsers failed: ${listError.message}` }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const existingUser = users.find(
      (u) => u.email && u.email.toLowerCase() === email.toLowerCase()
    );

    let targetUserId;

    if (existingUser) {
      targetUserId = existingUser.id;
      // Update their password and explicitly confirm the account to clear any "pending approval" state
      const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(
        existingUser.id,
        { password: securePassword, email_confirm: true, ban_duration: 'none' }
      );

      if (updateError) {
        return new Response(JSON.stringify({ error: `Failed to update user password: ${updateError.message}` }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    } else {
      // Create the user via admin.createUser(), passing their discord metadata
      const avatarUrl = discordUser.avatar
        ? `https://cdn.discordapp.com/avatars/${discordUser.id}/${discordUser.avatar}.png`
        : `https://cdn.discordapp.com/embed/avatars/${(parseInt(discordUser.id.slice(-4)) || 0) % 6}.png`;

      const { data: createdUser, error: createError } = await supabaseAdmin.auth.admin.createUser({
        email: email,
        password: securePassword,
        email_confirm: true,
        ban_duration: 'none',
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

      targetUserId = createdUser?.user?.id;
    }

    // Wait briefly for the Postgres trigger to create the profile row, then apply the Discord-derived role.
    // Discord role is only written on the first login (discord_role_synced_at IS NULL).
    // Owner role is never overwritten. Manual member-board assignments are preserved after first sync.
    await new Promise((resolve) => setTimeout(resolve, 1000));

    const { data: existingProfile, error: fetchError } = await supabaseAdmin
      .from('profiles')
      .select('role, discord_role_synced_at')
      .eq('email', email)
      .maybeSingle();

    if (fetchError) {
      console.warn(`[discord-login] Failed to fetch existing profile for ${email}: ${fetchError.message}`);
    }

    if (existingProfile?.role === 'owner') {
      console.log(`[discord-login] User is owner — role preserved.`);
    } else if (!existingProfile?.discord_role_synced_at) {
      // First login — apply Discord-derived role and mark as synced
      const { error: dbError } = await supabaseAdmin
        .from('profiles')
        .update({ role: appRole, discord_role_synced_at: new Date().toISOString() })
        .eq('email', email);

      if (dbError) {
        console.warn(`Failed to update user profile role in database: ${dbError.message}`);
      }
    } else {
      console.log(`[discord-login] Role already synced for ${email} — preserving DB role.`);
    }

    // Return { email, password } to the frontend
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
