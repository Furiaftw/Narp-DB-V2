import { createClient } from '@supabase/supabase-js';

export default async (req) => {
  // Only allow POST requests
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const { provider_token, userId } = await req.json();

    if (!provider_token || !userId) {
      return new Response(JSON.stringify({ error: 'Missing provider_token or userId' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_DATABASE_URL || process.env.VITE_SUPABASE_DATABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const discordGuildId = process.env.VITE_DISCORD_GUILD_ID;

    if (!supabaseUrl || !supabaseServiceKey) {
      return new Response(JSON.stringify({ error: 'Server configuration error: missing Supabase credentials' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    let appRole = 'user';

    if (discordGuildId) {
      const memberResponse = await fetch(`https://discord.com/api/users/@me/guilds/${discordGuildId}/member`, {
        headers: {
          Authorization: `Bearer ${provider_token}`,
        },
      });

      if (memberResponse.ok) {
        const memberData = await memberResponse.json();
        const discordUserId = memberData?.user?.id || '';
        const memberRoles = memberData?.roles || [];

        const ownerUserId = process.env.DISCORD_OWNER_USER_ID;
        const adminRoleId = process.env.DISCORD_ADMIN_ROLE_ID;
        const reviewerRoleId = process.env.DISCORD_REVIEWER_ROLE_ID;

        if (ownerUserId && String(discordUserId) === String(ownerUserId)) {
          appRole = 'owner';
        } else if (adminRoleId && memberRoles.includes(String(adminRoleId))) {
          appRole = 'admin';
        } else if (reviewerRoleId && memberRoles.includes(String(reviewerRoleId))) {
          appRole = 'staff';
        }
      } else {
        const errText = await memberResponse.text();
        console.warn(`Failed to fetch guild member details from Discord: ${errText}. Falling back to 'user' role.`);
      }
    } else {
      console.warn('VITE_DISCORD_GUILD_ID is not configured. Falling back to \'user\' role.');
    }

    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });

    // To be secure and preserve other fields, we check if profile exists.
    // If not, we fetch the base user info from Supabase Auth to populate correctly.
    const { data: existingProfile } = await supabaseAdmin
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .maybeSingle();

    if (existingProfile && existingProfile.role === 'owner') {
      return new Response(
        JSON.stringify({
          id: existingProfile.id,
          email: existingProfile.email,
          username: existingProfile.username,
          avatar_url: existingProfile.avatar_url,
          role: 'owner',
          discord_id: existingProfile.discord_id,
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    let profileToSave;
    if (existingProfile) {
      profileToSave = { ...existingProfile, role: appRole };
    } else {
      const { data: { user }, error: getUserError } = await supabaseAdmin.auth.admin.getUser(userId);
      if (getUserError || !user) {
        return new Response(JSON.stringify({ error: `User not found in auth: ${getUserError?.message || ''}` }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      const meta = user.user_metadata || {};
      profileToSave = {
        id: user.id,
        email: user.email,
        avatar_url: meta.avatar_url || meta.picture || '',
        username: meta.preferred_username || meta.user_name || meta.name || '',
        role: appRole,
      };
    }

    const { data: updatedProfile, error: updateError } = await supabaseAdmin
      .from('profiles')
      .upsert(profileToSave)
      .select('id, email, username, avatar_url, role, discord_id')
      .single();

    if (updateError) {
      return new Response(JSON.stringify({ error: `Failed to update user role in database: ${updateError.message}` }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify(updatedProfile), {
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

export const config = { path: '/.netlify/functions/sync-discord-roles' };
