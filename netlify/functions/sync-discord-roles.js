import { createClient } from '@supabase/supabase-js';

const json = (body, status) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

export default async (req) => {
  // Only allow POST requests
  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405);
  }

  try {
    const { provider_token, userId } = await req.json();

    if (!provider_token || !userId) {
      return json({ error: 'Missing provider_token or userId' }, 400);
    }

    const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_DATABASE_URL || process.env.VITE_SUPABASE_DATABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const discordGuildId = process.env.VITE_DISCORD_GUILD_ID;

    if (!supabaseUrl || !supabaseServiceKey) {
      return json({ error: 'Server configuration error: missing Supabase credentials' }, 500);
    }

    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });

    /* ------------------------------------------------------------------
       STEP 1 — Read the current profile BEFORE making any change.
       If we cannot read the profile we have no idea whether this user is
       the owner, so we must abort rather than risk an unsafe write.
       ------------------------------------------------------------------ */
    const { data: existingProfile, error: fetchError } = await supabaseAdmin
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .maybeSingle();

    if (fetchError) {
      console.error('[sync-discord-roles] Could not read existing profile; aborting without changes.', fetchError);
      return json({ error: 'Failed to read existing profile; no changes made' }, 500);
    }

    /* ------------------------------------------------------------------
       STEP 1.5 — Immediately confirm the user's account so no Supabase
       "pending approval" or email-confirmation gate can block login.
       Discord has already verified the user's identity; we don't need
       any additional Supabase-side approval step.
       ------------------------------------------------------------------ */
    await supabaseAdmin.auth.admin.updateUserById(userId, {
      email_confirm: true,
      ban_duration: 'none',
    }).catch((e) => console.warn('[sync-discord-roles] Could not auto-confirm user:', e.message));

    /* ------------------------------------------------------------------
       STEP 2 — CRITICAL owner safeguard.
       The owner must NEVER be downgraded. If the database already records
       this user as the owner, return immediately and leave the row alone.
       ------------------------------------------------------------------ */
    if (existingProfile && existingProfile.role === 'owner') {
      return json({
        id: existingProfile.id,
        email: existingProfile.email,
        username: existingProfile.username,
        avatar_url: existingProfile.avatar_url,
        role: 'owner',
        discord_id: existingProfile.discord_id,
      }, 200);
    }

    /* ------------------------------------------------------------------
       STEP 3 — A role may only be derived from a definitive Discord
       success. Without a configured guild we cannot obtain one, so we
       abort instead of defaulting anyone to 'user'.
       ------------------------------------------------------------------ */
    if (!discordGuildId) {
      console.error('[sync-discord-roles] VITE_DISCORD_GUILD_ID is not configured; aborting without changes.');
      return json({ error: 'Discord guild is not configured; no changes made' }, 500);
    }

    /* ------------------------------------------------------------------
       STEP 4 — Fetch the Discord guild membership.
       The request is wrapped in try/catch for transport failures, and the
       response status is checked explicitly. ONLY a definitive 200 OK is
       allowed to drive a database write. Any error (401, 404, network
       failure, unparseable body, ...) aborts the operation and leaves the
       database completely untouched — we never fall back to 'user'.
       ------------------------------------------------------------------ */
    let discordResponse;
    try {
      discordResponse = await fetch(`https://discord.com/api/users/@me/guilds/${discordGuildId}/member`, {
        headers: {
          Authorization: `Bearer ${provider_token}`,
        },
      });
    } catch (discordErr) {
      console.error('[sync-discord-roles] Discord API request threw; aborting without changes.', discordErr);
      return json({ error: "Failed to sync roles", details: discordErr.message }, 502);
    }

    if (!discordResponse.ok) {
      let errText = '';
      try { errText = await discordResponse.text(); } catch { /* ignore */ }
      console.error(`[sync-discord-roles] Discord API returned status ${discordResponse.status}; aborting without changes. ${errText}`);
      const status = discordResponse.status === 429 ? 429 : 500;
      return json({ error: "Failed to sync roles", details: `Discord API returned status ${discordResponse.status}: ${errText}` }, status);
    }

    let memberData;
    try {
      memberData = await discordResponse.json();
    } catch (parseErr) {
      console.error('[sync-discord-roles] Could not parse Discord response body; aborting without changes.', parseErr);
      return json({ error: "Failed to sync roles", details: parseErr.message }, 502);
    }

    /* ------------------------------------------------------------------
       STEP 5 — Derive the application role from the verified Discord data.
       ------------------------------------------------------------------ */
    const discordUserId = memberData?.user?.id || '';
    const memberRoles = memberData?.roles || [];

    const ownerUserId = process.env.DISCORD_OWNER_USER_ID;
    const adminRoleId = process.env.DISCORD_ADMIN_ROLE_ID;
    const reviewerRoleId = process.env.DISCORD_REVIEWER_ROLE_ID;

    let appRole = 'user';
    if (ownerUserId && String(discordUserId) === String(ownerUserId)) {
      appRole = 'owner';
    } else if (adminRoleId && memberRoles.includes(String(adminRoleId))) {
      appRole = 'admin';
    } else if (reviewerRoleId && memberRoles.includes(String(reviewerRoleId))) {
      appRole = 'staff';
    }

    /* ------------------------------------------------------------------
       STEP 6 — Persist the verified role.
       Discord role is only written on the very first login (when
       discord_role_synced_at is NULL). After that the column is set and
       subsequent logins leave the DB role untouched, preserving any
       manual assignment made via the member board.
       Owner is always protected regardless of sync status (Step 2 above).
       ------------------------------------------------------------------ */
    const alreadySynced = Boolean(existingProfile?.discord_role_synced_at);
    let profileToSave;
    if (existingProfile) {
      profileToSave = {
        ...existingProfile,
        role: alreadySynced ? existingProfile.role : appRole,
        discord_role_synced_at: existingProfile.discord_role_synced_at ?? new Date().toISOString(),
      };
    } else {
      const { data: { user }, error: getUserError } = await supabaseAdmin.auth.admin.getUser(userId);
      if (getUserError || !user) {
        return json({ error: `User not found in auth: ${getUserError?.message || ''}` }, 404);
      }
      const meta = user.user_metadata || {};
      profileToSave = {
        id: user.id,
        email: user.email,
        avatar_url: meta.avatar_url || meta.picture || '',
        username: meta.preferred_username || meta.user_name || meta.name || '',
        role: appRole,
        discord_role_synced_at: new Date().toISOString(),
      };
    }

    const { data: updatedProfile, error: updateError } = await supabaseAdmin
      .from('profiles')
      .upsert(profileToSave)
      .select('id, email, username, avatar_url, role, discord_id')
      .single();

    if (updateError) {
      return json({ error: `Failed to update user role in database: ${updateError.message}` }, 500);
    }

    return json(updatedProfile, 200);

  } catch (err) {
    return json({ error: `Internal server error: ${err.message}` }, 500);
  }
};

export const config = { path: '/.netlify/functions/sync-discord-roles' };
