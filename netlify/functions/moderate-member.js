import { createClient } from '@supabase/supabase-js';

// Site-level moderation for the Member Board: remove (delete the account
// outright) and ban/unban (block sign-in via the Supabase Admin API).
// Runs entirely on the service role key, so every check below is load-bearing
// -- there is no RLS backstop for auth.users deletion or bans.

const json = (body, status) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

// Higher number outranks lower. Mirrors the tier order in CLAUDE.md.
const ROLE_RANK = { user: 0, grader: 1, reviewer: 2, admin: 3, owner: 4 };

// A permanent ban, expressed the way Supabase's own docs do it: there is no
// literal "forever" duration, so this uses a 100-year ban as the convention.
const PERMANENT_BAN_DURATION = '876000h';

export default async (req) => {
  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405);
  }

  try {
    const { action, targetUserId } = await req.json();
    if (!['remove', 'ban', 'unban'].includes(action)) {
      return json({ error: 'Invalid action' }, 400);
    }
    if (!targetUserId) {
      return json({ error: 'Missing targetUserId' }, 400);
    }

    const supabaseUrl = Netlify.env.get('VITE_SUPABASE_URL') || process.env.VITE_SUPABASE_URL || Netlify.env.get('SUPABASE_DATABASE_URL') || process.env.SUPABASE_DATABASE_URL || Netlify.env.get('VITE_SUPABASE_DATABASE_URL') || process.env.VITE_SUPABASE_DATABASE_URL;
    const supabaseServiceKey = Netlify.env.get('SUPABASE_SERVICE_ROLE_KEY') || process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseServiceKey) {
      return json({ error: 'Server configuration error: missing Supabase credentials' }, 500);
    }

    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // ---- Authenticate the caller ----------------------------------------
    const authHeader = req.headers.get('authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return json({ error: 'Missing auth token' }, 401);
    }
    const { data: { user: callerUser }, error: callerAuthError } =
      await supabaseAdmin.auth.getUser(authHeader.slice(7));
    if (callerAuthError || !callerUser) {
      return json({ error: 'Invalid token' }, 401);
    }
    if (callerUser.id === targetUserId) {
      return json({ error: 'You cannot moderate your own account' }, 403);
    }

    // ---- Authorize: caller must be admin+ and must outrank the target ---
    const { data: callerProfile, error: callerProfileError } = await supabaseAdmin
      .from('profiles')
      .select('role')
      .eq('id', callerUser.id)
      .maybeSingle();
    if (callerProfileError || !callerProfile) {
      return json({ error: 'Could not verify your permissions' }, 500);
    }
    const callerRank = ROLE_RANK[callerProfile.role] ?? -1;
    if (callerRank < ROLE_RANK.admin) {
      return json({ error: 'Forbidden: admin role required' }, 403);
    }

    const { data: targetProfile, error: targetProfileError } = await supabaseAdmin
      .from('profiles')
      .select('id, role, username')
      .eq('id', targetUserId)
      .maybeSingle();
    if (targetProfileError) {
      return json({ error: 'Could not read target profile' }, 500);
    }
    if (!targetProfile) {
      return json({ error: 'Member not found' }, 404);
    }
    const targetRank = ROLE_RANK[targetProfile.role] ?? -1;
    if (targetRank >= callerRank) {
      return json({ error: 'You cannot moderate a member with an equal or higher role' }, 403);
    }

    // ---- Perform the action ----------------------------------------------
    if (action === 'remove') {
      // Delete the profile row first: if the auth user delete below fails
      // partway (or the auth.users FK is already ON DELETE CASCADE and beats
      // us to it), this is a no-op the second time rather than a partial state.
      await supabaseAdmin.from('profiles').delete().eq('id', targetUserId);
      const { error: deleteError } = await supabaseAdmin.auth.admin.deleteUser(targetUserId);
      if (deleteError && deleteError.status !== 404) {
        console.error('[moderate-member] deleteUser failed:', deleteError);
        return json({ error: 'Profile removed, but the login account could not be deleted: ' + deleteError.message }, 500);
      }
      return json({ ok: true, action, targetUserId });
    }

    if (action === 'ban' || action === 'unban') {
      const ban_duration = action === 'ban' ? PERMANENT_BAN_DURATION : 'none';
      const { error: banError } = await supabaseAdmin.auth.admin.updateUserById(targetUserId, { ban_duration });
      if (banError) {
        console.error('[moderate-member] updateUserById failed:', banError);
        return json({ error: 'Failed to update login access: ' + banError.message }, 500);
      }
      const { error: profileError } = await supabaseAdmin
        .from('profiles')
        .update({ banned_at: action === 'ban' ? new Date().toISOString() : null })
        .eq('id', targetUserId);
      if (profileError) {
        console.error('[moderate-member] banned_at update failed:', profileError);
      }
      return json({ ok: true, action, targetUserId });
    }

    return json({ error: 'Unhandled action' }, 400);
  } catch (err) {
    console.error('[moderate-member] Unexpected error:', err);
    return json({ error: 'Unexpected server error' }, 500);
  }
};
