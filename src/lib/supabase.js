import { createClient } from '@supabase/supabase-js';

/* ============================================================================
   Supabase client + data layer for the NARP Database app (v2).

   New in this version:
   - 4-tier role helpers (user / staff / admin / owner)
   - Whitelist read/write
   - Pending-jutsus submit/approve/cancel
   - Role change audit log read

   Env-var compatibility (use either pair):
   - VITE_SUPABASE_URL          / VITE_SUPABASE_ANON_KEY  (manual setup)
   - VITE_SUPABASE_DATABASE_URL / VITE_SUPABASE_ANON_KEY  (Netlify extension)
   ============================================================================ */

const runtimeConfig = typeof window !== 'undefined' && window.__SUPABASE_CONFIG__;
const url = import.meta.env.VITE_SUPABASE_URL
         || import.meta.env.VITE_SUPABASE_DATABASE_URL
         || (runtimeConfig && runtimeConfig.url);
const key = import.meta.env.VITE_SUPABASE_ANON_KEY
         || (runtimeConfig && runtimeConfig.key);

export const supabase = url && key ? createClient(url, key, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
}) : null;

export const isSupabaseConfigured = () => Boolean(supabase);

/* --- Auth ------------------------------------------------------------------ */

export const signInWithDiscord = async () => {
  if (!supabase) throw new Error('Supabase is not configured');
  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'discord',
    options: {
      redirectTo: window.location.origin,
      scopes: 'identify email guilds guilds.members.read'
    },
  });
  if (error) throw error;
};

export const signInWithDevAccess = async () => {
  if (!supabase) throw new Error('Supabase is not configured');
  const res = await fetch('/.netlify/functions/dev-login', { method: 'POST' });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `Dev login failed (${res.status})`);
  const { email, password } = body;
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
};

export const signOut = async () => {
  if (!supabase) return;
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
};

export const getCurrentSession = async () => {
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  return data.session;
};

export const onAuthChange = (callback) => {
  if (!supabase) return () => {};
  const { data } = supabase.auth.onAuthStateChange((_event, session) => callback(session));
  return () => data.subscription.unsubscribe();
};

/* --- Profiles -------------------------------------------------------------- */

export const fetchMyProfile = async () => {
  if (!supabase) return null;
  const session = await getCurrentSession();
  if (!session?.user) return null;

  // Only attempt a Discord role sync when we have an explicit provider token.
  // Supabase only exposes `provider_token` immediately after an OAuth sign-in;
  // on a standard page reload the restored session has it as undefined/null.
  // Calling the sync without a valid token would recompute the role from a
  // failed Discord lookup and could downgrade the user, so we skip it entirely.
  if (typeof session.provider_token === 'string' && session.provider_token.length > 0) {
    try {
      const syncRes = await fetch('/.netlify/functions/sync-discord-roles', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          provider_token: session.provider_token,
          userId: session.user.id
        })
      });
      if (!syncRes.ok) {
        throw new Error('Server responded with ' + syncRes.status);
      }
      return await syncRes.json();
    } catch (err) {
      console.warn('[NARP] Role sync failed, falling back to local profile fetch:', err);
    }
  }

  let { data, error } = await supabase
    .from('profiles')
    .select('id, email, username, site_nickname, avatar_url, role, discord_id, work_thread_id, custom_item_thread_id, summon_thread_id, wanderer_ticket')
    .eq('id', session.user.id)
    .maybeSingle();

  if (error && error.code === '42703') {
    // Fallback: work_thread_id column does not exist in profiles table
    const fallback = await supabase
      .from('profiles')
      .select('id, email, username, avatar_url, role, discord_id')
      .eq('id', session.user.id)
      .maybeSingle();
    data = fallback.data;
    error = fallback.error;
  }

  if (error) throw error;
  if (data) return data;

  try {
    const res = await fetch('/.netlify/functions/ensure-profile', {
      method: 'POST',
      headers: { Authorization: `Bearer ${session.access_token}` },
    });
    if (res.ok) return await res.json();
  } catch {}
  return null;
};

/* Sets the current user's chosen username. Usernames are unique, so a
   collision surfaces as a friendly error the caller can show inline. */
export const updateMyUsername = async (username) => {
  if (!supabase) throw new Error('Supabase is not configured');
  const session = await getCurrentSession();
  if (!session?.user?.id) throw new Error('Must be signed in to set a username');

  const clean = (username || '').trim();
  const { data, error } = await supabase
    .from('profiles')
    .update({ username: clean })
    .eq('id', session.user.id)
    .select('id, email, username, avatar_url, role, discord_id')
    .single();

  if (error) {
    if (error.code === '23505') throw new Error('That username is already taken.');
    throw error;
  }
  return data;
};

export const updateMyWorkThreadId = async (threadId) => {
  if (!supabase) throw new Error('Supabase is not configured');
  const session = await getCurrentSession();
  if (!session?.user?.id) throw new Error('Must be signed in to set a work thread ID');

  const clean = (threadId || '').trim();
  const { data, error } = await supabase
    .from('profiles')
    .update({ work_thread_id: clean || null })
    .eq('id', session.user.id)
    .select('id, email, username, avatar_url, role, discord_id, work_thread_id, custom_item_thread_id, summon_thread_id')
    .single();

  if (error) throw error;
  return data;
};

export const updateMyCustomItemThreadId = async (threadId) => {
  if (!supabase) throw new Error('Supabase is not configured');
  const session = await getCurrentSession();
  if (!session?.user?.id) throw new Error('Must be signed in to set a work thread ID');

  const clean = (threadId || '').trim();
  const { data, error } = await supabase
    .from('profiles')
    .update({ custom_item_thread_id: clean || null })
    .eq('id', session.user.id)
    .select('id, email, username, avatar_url, role, discord_id, work_thread_id, custom_item_thread_id, summon_thread_id')
    .single();

  if (error) throw error;
  return data;
};

export const updateMySummonThreadId = async (threadId) => {
  if (!supabase) throw new Error('Supabase is not configured');
  const session = await getCurrentSession();
  if (!session?.user?.id) throw new Error('Must be signed in to set a work thread ID');

  const clean = (threadId || '').trim();
  const { data, error } = await supabase
    .from('profiles')
    .update({ summon_thread_id: clean || null })
    .eq('id', session.user.id)
    .select('id, email, username, avatar_url, role, discord_id, work_thread_id, custom_item_thread_id, summon_thread_id')
    .single();

  if (error) throw error;
  return data;
};

export const setUserWorkThreadId = async (userId, threadId) => {
  if (!supabase) return;
  const clean = (threadId || '').trim();
  const { error } = await supabase
    .from('profiles')
    .update({ work_thread_id: clean || null })
    .eq('id', userId);
  if (error) throw error;
};

export const fetchAllProfiles = async () => {
  if (!supabase) return [];
  let { data, error } = await supabase
    .from('profiles')
    .select('id, email, username, avatar_url, role, discord_id, created_at, work_thread_id, custom_item_thread_id, summon_thread_id, wanderer_ticket')
    .order('created_at', { ascending: true });

  if (error && error.code === '42703') {
    // Fallback: work_thread_id column does not exist in profiles table
    const fallback = await supabase
      .from('profiles')
      .select('id, email, username, avatar_url, role, discord_id, created_at')
      .order('created_at', { ascending: true });
    data = fallback.data;
    error = fallback.error;
  }

  if (error) throw error;
  return data || [];
};

export const setUserRole = async (userId, role) => {
  if (!supabase) return;
  if (!['user', 'grader', 'reviewer', 'admin', 'owner'].includes(role)) throw new Error('Invalid role');
  const { error } = await supabase.from('profiles').update({ role }).eq('id', userId);
  if (error) throw error;
};

/* --- Wanderer tickets -------------------------------------------------------
   One-time, admin-granted permission to submit a Wanderer-faction OC. Both
   mutations go through SECURITY DEFINER RPCs (see add-wanderer-ticket.sql)
   so users can't self-grant by writing the column directly. */

export const grantWandererTicket = async (userId) => {
  if (!supabase) return;
  const { error } = await supabase.rpc('grant_wanderer_ticket', { target_user_id: userId });
  if (error) throw error;
};

export const consumeWandererTicket = async () => {
  if (!supabase) return false;
  const { data, error } = await supabase.rpc('consume_wanderer_ticket');
  if (error) throw error;
  return !!data;
};

/* --- Webhook config -------------------------------------------------------- */

export const fetchWebhookConfig = async () => {
  if (!supabase) return {};
  const { data, error } = await supabase
    .from('webhook_config')
    .select('config_key, config_value');
  if (error) throw error;
  return Object.fromEntries((data || []).map(r => [r.config_key, r.config_value]));
};

export const saveWebhookConfig = async (key, value) => {
  if (!supabase) return;
  const session = await getCurrentSession();
  const { error } = await supabase
    .from('webhook_config')
    .upsert(
      { config_key: key, config_value: value, updated_at: new Date().toISOString(), updated_by: session?.user?.id || null },
      { onConflict: 'config_key' }
    );
  if (error) throw error;
};

/* --- Whitelist ------------------------------------------------------------- */

export const fetchWhitelist = async () => {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('whitelist')
    .select('email, role, added_at')
    .order('added_at', { ascending: false });
  if (error) throw error;
  return data || [];
};

export const addToWhitelist = async (email, role) => {
  if (!supabase) return;
  if (!['grader', 'reviewer', 'admin'].includes(role)) throw new Error('Whitelist role must be grader, reviewer, or admin');
  const session = await getCurrentSession();
  const { error } = await supabase
    .from('whitelist')
    .upsert({ email: email.toLowerCase().trim(), role, added_by: session?.user?.id || null });
  if (error) throw error;
};

export const removeFromWhitelist = async (email) => {
  if (!supabase) return;
  const { error } = await supabase
    .from('whitelist')
    .delete()
    .eq('email', email.toLowerCase().trim());
  if (error) throw error;
};

/* --- Pending jutsus -------------------------------------------------------- */

export const fetchPendingJutsus = async () => {
  if (!supabase) return [];
  // Manual join for submitter/reviewer, and select/join assignee.
  const result = await supabase
    .from('pending_jutsus')
    .select('id, operation, target_id, data, submitted_by, submitted_at, status, first_reviewer_id, assigned_to, second_approval_ping_count, last_second_approval_ping_at, assignee:profiles!assigned_to(username, avatar_url)')
    .order('submitted_at', { ascending: false });

  if (result.error) throw result.error;
  const pending = result.data;
  if (!pending?.length) return [];

  const profileIds = [...new Set(pending.flatMap(p => [p.submitted_by, p.first_reviewer_id, p.assigned_to]).filter(Boolean))];
  const { data: profiles } = await supabase
    .from('profiles')
    .select('id, username, email, avatar_url, role, discord_id, work_thread_id, custom_item_thread_id, summon_thread_id')
    .in('id', profileIds);

  const profileById = new Map((profiles || []).map(p => [p.id, p]));
  return pending.map(p => ({
    ...p,
    submitter: profileById.get(p.submitted_by) || null,
    first_reviewer: p.first_reviewer_id ? (profileById.get(p.first_reviewer_id) || null) : null,
    assignee: (p.assigned_to ? profileById.get(p.assigned_to) : null) || p.assignee || null,
  }));
};

export const submitPendingJutsu = async (operation, targetId, data, status = 'pending_approval') => {
  if (!supabase) return;
  if (!['insert', 'update', 'delete'].includes(operation)) throw new Error('Invalid operation');
  const session = await getCurrentSession();
  if (!session?.user?.id) throw new Error('Must be signed in to submit');

  const { error } = await supabase.from('pending_jutsus').insert({
    operation,
    target_id: targetId || null,
    data: operation === 'delete' ? null : data,
    submitted_by: session.user.id,
    status,
  });
  if (error) throw error;
};

export const reviewPendingJutsu = async (id, reviewerId) => {
  if (!supabase) return;
  const { error } = await supabase
    .from('pending_jutsus')
    .update({
      status: 'pending_approval',
      first_reviewer_id: reviewerId,
    })
    .eq('id', id);
  if (error) throw error;
};

export const recordSecondApprovalPing = async (id, count) => {
  if (!supabase) return;
  const { error } = await supabase
    .from('pending_jutsus')
    .update({ second_approval_ping_count: count, last_second_approval_ping_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw error;
};

export const claimPendingSubmission = async (pendingId, userId) => {
  if (!supabase) throw new Error('Supabase is not initialized');
  const { data, error } = await supabase
    .from('pending_jutsus')
    .update({ assigned_to: userId })
    .eq('id', pendingId)
    .select();
  if (error) throw error;
  return data;
};

export const updatePendingJutsuData = async (id, newData) => {
  if (!supabase) return;
  const { data, error } = await supabase
    .from('pending_jutsus')
    .update({ data: newData })
    .eq('id', id)
    .select();
  if (error) throw error;
  if (!data || data.length === 0) throw new Error('Edit blocked by database security or row not found.');
};

export const markSubmissionAsRead = async (pendingId) => {
  // Safe no-op since bell notifications/unread states have been removed
  return;
};

export const fetchReviewChats = async (pendingId) => {
  if (!supabase) return null;
  if (!pendingId || typeof pendingId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(pendingId)) {
    console.warn('[NARP] fetchReviewChats called with invalid pendingId (not a valid UUID):', pendingId);
    return [];
  }
  try {
    const { data, error } = await supabase
      .from('pending_chats')
      .select('*, profiles(username, site_nickname, avatar_url, role, discord_id)')
      .eq('pending_id', pendingId)
      .order('created_at', { ascending: true });

    if (error) {
      console.error('[NARP] Error fetching review chats:', error);
      return null;
    }
    return data;
  } catch (error) {
    console.error('[NARP] Error in fetchReviewChats:', error);
    return null;
  }
};

export const sendReviewChat = async (pendingId, message, isStaffOnly = false) => {
  if (!supabase) throw new Error('Supabase is not initialized');
  if (!pendingId || typeof pendingId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(pendingId)) {
    const errorMsg = `Invalid submission ID format. Expected a valid UUID, but received: "${pendingId}"`;
    console.error('[NARP] Validation Error:', errorMsg);
    throw new Error(errorMsg);
  }
  try {
    const session = await getCurrentSession();
    if (!session?.user?.id) {
      throw new Error('No authenticated user session found');
    }
    const payload = {
      pending_id: pendingId,
      message: message,
      sender_id: session.user.id,
      is_staff_only: isStaffOnly
    };
    const { data, error } = await supabase
      .from('pending_chats')
      .insert(payload)
      .select();

    if (error) {
      console.error('[NARP] Error sending review chat. Payload:', payload);
      console.error('[NARP] Supabase Error Detail:', error);
      throw error;
    }
    return data;
  } catch (error) {
    console.error('[NARP] Error in sendReviewChat:', error);
    throw error;
  }
};

export const subscribeToDatabaseChanges = (onTableChange) => {
  if (!supabase) return null;
  const channel = supabase
    .channel('schema-db-changes')
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'jutsus' },
      (payload) => onTableChange(payload)
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'bloodlines' },
      (payload) => onTableChange(payload)
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'pending_jutsus' },
      (payload) => onTableChange(payload)
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'pending_chats' },
      (payload) => onTableChange(payload)
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'roster_entries' },
      (payload) => onTableChange(payload)
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'roster_squads' },
      (payload) => onTableChange(payload)
    )
    .subscribe();

  return channel;
};

export const approvePendingJutsu = async (id) => {
  if (!supabase) return;
  const { error } = await supabase.rpc('approve_pending_jutsu', { pending_id: id });
  if (error) throw error;
};

export const cancelPendingJutsu = async (id) => {
  if (!supabase) return;
  const { error } = await supabase.from('pending_jutsus').delete().eq('id', id);
  if (error) throw error;
};

export const updateMySiteNickname = async (nickname) => {
  if (!supabase) throw new Error('Supabase is not configured');
  const session = await getCurrentSession();
  if (!session?.user?.id) throw new Error('Must be signed in');
  const clean = (nickname || '').trim() || null;
  const { data, error } = await supabase
    .from('profiles')
    .update({ site_nickname: clean })
    .eq('id', session.user.id)
    .select('id, email, username, site_nickname, avatar_url, role, discord_id, work_thread_id, custom_item_thread_id, summon_thread_id')
    .single();
  if (error) throw error;
  return data;
};

export const editChatMessage = async (messageId, newMessage) => {
  if (!supabase) throw new Error('Supabase is not configured');
  const { data: existing, error: fetchErr } = await supabase
    .from('pending_chats')
    .select('message, original_message')
    .eq('id', messageId)
    .single();
  if (fetchErr) throw fetchErr;
  const { data, error } = await supabase
    .from('pending_chats')
    .update({
      message: newMessage.trim(),
      is_edited: true,
      original_message: existing.original_message ?? existing.message,
    })
    .eq('id', messageId)
    .select()
    .single();
  if (error) throw error;
  return data;
};

export const deleteChatMessage = async (messageId) => {
  if (!supabase) throw new Error('Supabase is not configured');
  const { error } = await supabase
    .from('pending_chats')
    .update({ is_deleted: true })
    .eq('id', messageId);
  if (error) throw error;
};

export const fetchMyParticipatingChatIds = async (userId) => {
  if (!supabase || !userId) return new Set();
  try {
    const { data, error } = await supabase
      .from('pending_chats')
      .select('pending_id')
      .eq('sender_id', userId);
    if (error) return new Set();
    return new Set((data || []).map(r => r.pending_id));
  } catch { return new Set(); }
};

export const fetchRecentChats = async (limit = 20) => {
  if (!supabase) return [];
  try {
    const { data, error } = await supabase
      .from('pending_chats')
      .select('id, pending_id, message, created_at, is_staff_only, sender_id, profiles(username, avatar_url, role)')
      .eq('is_staff_only', false)
      .order('created_at', { ascending: false })
      .limit(100);
    if (error) return [];
    // Deduplicate: keep the most recent public message per pending_id
    const seen = new Set();
    const recent = [];
    for (const msg of data) {
      if (msg.message?.startsWith('[SYSTEM_JOIN]')) continue;
      if (!seen.has(msg.pending_id)) {
        seen.add(msg.pending_id);
        recent.push(msg);
        if (recent.length >= limit) break;
      }
    }
    return recent;
  } catch {
    return [];
  }
};

/*
 * Chat overview for the Messages inbox. Scans the most recent public messages
 * and groups them per pending submission, keeping up to `perThread` of the
 * newest messages for each thread so the UI can show previews and unread
 * counts without a query per submission. RLS limits players to threads on
 * their own submissions.
 */
export const fetchChatOverview = async (scanLimit = 300, perThread = 5) => {
  if (!supabase) return [];
  try {
    const { data, error } = await supabase
      .from('pending_chats')
      .select('id, pending_id, message, created_at, is_staff_only, sender_id, is_deleted, profiles(username, site_nickname, avatar_url, role)')
      .eq('is_staff_only', false)
      .order('created_at', { ascending: false })
      .limit(scanLimit);
    if (error) return [];
    const byThread = new Map();
    for (const msg of data || []) {
      if (msg.is_deleted) continue;
      // Join markers are presentation-only; keeping them out of the overview
      // stops them from flipping turn state or triggering unread badges.
      if (msg.message?.startsWith('[SYSTEM_JOIN]')) continue;
      let thread = byThread.get(msg.pending_id);
      if (!thread) {
        thread = { pending_id: msg.pending_id, messages: [] };
        byThread.set(msg.pending_id, thread);
      }
      if (thread.messages.length < perThread) thread.messages.push(msg);
    }
    // messages are newest-first; lastMessage is the most recent public message
    return [...byThread.values()].map(t => ({ ...t, lastMessage: t.messages[0] || null }));
  } catch {
    return [];
  }
};

/* --- Role change audit log ------------------------------------------------- */

export const fetchRoleChangeLog = async (limit = 100) => {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('role_change_log')
    .select('id, target_email, old_role, new_role, changed_by_email, changed_at')
    .order('changed_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data || [];
};

/* --- Work log stats (in-app monthly totals; separate from the Discord
   reviewer-work-log system, which keeps logging the detailed per-item
   narrative unchanged) ------------------------------------------------------- */

// Increments a counter for this month/actionType by 1. Defaults to the
// current user; pass targetUserId to credit another reviewer instead (e.g.
// the final approver crediting the first reviewer at approval time) — the
// RPC only allows that when the caller is staff+, enforced server-side.
export const logWorkAction = async (actionType, targetUserId) => {
  if (!supabase) return;
  const { error } = await supabase.rpc('increment_work_log', {
    p_action_type: actionType,
    p_target_user_id: targetUserId || null,
  });
  if (error) throw error;
};

// monthStart: 'YYYY-MM-01'. Pass all=true (admin/owner) to fetch everyone's
// rows for that month; otherwise rows are scoped to userId. RLS enforces the
// same restriction server-side regardless of what the client asks for.
export const fetchWorkLogMonthly = async (monthStart, { all = false, userId } = {}) => {
  if (!supabase) return [];
  let q = supabase.from('work_log_monthly').select('*').eq('month_start', monthStart);
  if (!all) q = q.eq('user_id', userId);
  const { data, error } = await q;
  if (error) throw error;
  return data || [];
};

/* --- Row ↔ App-shape converters ------------------------------------------- */

const parseSlots = (s) => {
  if (s == null) return '';
  if (typeof s === 'string') return s;
  try { return JSON.stringify(s); } catch { return ''; }
};

const stringifySlotsForDb = (s) => {
  if (!s) return null;
  if (typeof s !== 'string') return s;
  try { return JSON.parse(s); } catch { return null; }
};

export const fromRowJutsu = (row) => ({
  _id:         row.id,
  _createdAt:  row.created_at,
  _createdBy:  row.created_by,
  _modifiedBy: row.last_modified_by,
  name:        row.name || '',
  nature:      row.nature || '',
  rank:        row.rank || [],
  cost:        row.cost || '',
  types:       row.types || [],
  jutsu_type:  row.jutsu_type || [],
  origin:      row.origin || '',
  spec:        row.spec || [],
  link:        row.link || '',
  bloodline:   row.bloodline || '',
  custom_tags: row.custom_tags || [],
  limited:     !!row.limited,
  locked:      !!row.locked,
  pve:         !!row.pve,
  multiRank:   !!row.multi_rank,
  bm_tier:     row.bm_tier || '',
  slots:       parseSlots(row.slots),
  sheet:       row.sheet || {},
});

// Returns the wire-format row for INSERT/UPDATE.
// Pass `withId=true` to include `id` in the payload (for upserts when caller
// has chosen the id client-side); leave false when relying on DB defaults.
const toRowJutsu = (j, withId = true) => {
  const row = {
    name:        j.name || '',
    nature:      j.nature || null,
    rank:        j.rank || [],
    cost:        j.cost || null,
    types:       j.types || [],
    jutsu_type:  j.jutsu_type || [],
    origin:      j.origin || null,
    spec:        j.spec || [],
    link:        j.link || null,
    bloodline:   j.bloodline || null,
    custom_tags: j.custom_tags || [],
    limited:     !!j.limited,
    locked:      !!j.locked,
    pve:         !!j.pve,
    multi_rank:  !!j.multiRank,
    bm_tier:     j.bm_tier || null,
    slots:       stringifySlotsForDb(j.slots),
    sheet:       j.sheet || {},
  };
  if (withId && j._id) row.id = j._id;
  return row;
};

const fromRowBloodline = (row) => ({
  _id:                      row.id,
  _createdAt:               row.created_at,
  _createdBy:               row.created_by,
  _modifiedBy:              row.last_modified_by,
  name:                     row.name || '',
  category:                 row.category || 'Custom',
  subcategory:              row.subcategory || 'Other',
  custom_tags:              row.custom_tags || [],
  link:                     row.link || '',
  proprietary_ability_link: row.proprietary_ability_link || '',
  max_slots:                row.max_slots ?? 5,
  slots:                    row.slots ? (typeof row.slots === 'string' ? row.slots : JSON.stringify(row.slots)) : '',
});

const toRowBloodline = (b) => ({
  id:                       b._id,
  name:                     b.name || '',
  category:                 b.category || null,
  subcategory:              b.subcategory || null,
  custom_tags:              b.custom_tags || [],
  link:                     b.link || null,
  proprietary_ability_link: b.proprietary_ability_link || null,
  max_slots:                b.max_slots != null ? Number(b.max_slots) : 5,
  slots:                    b.slots ? (typeof b.slots === 'string' ? JSON.parse(b.slots) : b.slots) : null,
});

// Exposed so the App can build the JSON payload for pending submissions.
// Strips the id when building a "data" blob for an insert pending (a fresh
// id will be generated server-side at approval time).
export const buildJutsuPayload = (j, includeId = false) => toRowJutsu(j, includeId);

/* --- Jutsu review history -------------------------------------------------
 * The review chat transcript, saved at approval time instead of being sent
 * to Discord as a .txt attachment. Reviewer+ only (RLS on the table itself
 * gates this — see supabase/add-jutsu-sheet-and-review-history.sql).
 */
export const saveJutsuReviewHistory = async ({ jutsuId, itemName, operation, transcript, submittedBy, reviewedBy }) => {
  if (!supabase || !jutsuId || !transcript) return;
  const { error } = await supabase.from('jutsu_review_history').insert({
    jutsu_id: jutsuId,
    item_name: itemName || null,
    operation: operation || null,
    transcript,
    submitted_by: submittedBy || null,
    reviewed_by: reviewedBy || null,
  });
  if (error) throw error;
};

export const fetchJutsuReviewHistory = async (jutsuId) => {
  if (!supabase || !jutsuId) return [];
  const { data, error } = await supabase
    .from('jutsu_review_history')
    .select('id, transcript, operation, item_name, created_at, submitted_by, reviewed_by')
    .eq('jutsu_id', jutsuId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  const rows = data || [];
  const profileIds = [...new Set(rows.flatMap(r => [r.submitted_by, r.reviewed_by]).filter(Boolean))];
  if (!profileIds.length) return rows;
  const { data: profiles } = await supabase
    .from('profiles').select('id, username, site_nickname').in('id', profileIds);
  const byId = new Map((profiles || []).map(p => [p.id, p]));
  return rows.map(r => ({
    ...r,
    submitted_by_profile: byId.get(r.submitted_by) || null,
    reviewed_by_profile: byId.get(r.reviewed_by) || null,
  }));
};

/* --- Catalog read --------------------------------------------------------- */

export const fetchAllFromSupabase = async () => {
  if (!supabase) return null;

  const [jRes, bRes, sRes, ttRes] = await Promise.all([
    supabase.from('jutsus').select('*').order('created_at', { ascending: false }),
    supabase.from('bloodlines').select('*').order('created_at', { ascending: false }),
    supabase.from('specializations').select('*').order('created_at', { ascending: true }),
    supabase.from('jutsu_type_tags').select('*').order('created_at', { ascending: true }),
  ]);

  // The core catalog tables are required — without them there is nothing to show.
  const errs = [jRes, bRes].filter(r => r.error).map(r => r.error.message);
  if (errs.length) throw new Error('Supabase fetch failed: ' + errs.join('; '));

  // The tag catalogs are optional: if one is missing (e.g. its migration hasn't
  // been applied yet) return null for it so normalizeDB falls back to the
  // built-in defaults instead of the whole site dropping to the local cache.
  if (sRes.error) console.warn('[NARP] Could not load specializations; using built-in defaults.', sRes.error.message);
  if (ttRes.error) console.warn('[NARP] Could not load jutsu_type_tags; using built-in defaults.', ttRes.error.message);

  return {
    jutsus:          (jRes.data || []).map(fromRowJutsu),
    bloodlines:      (bRes.data || []).map(fromRowBloodline),
    specializations: sRes.error ? null : (sRes.data || []).map(s => s.name),
    jutsuTypeTags:   ttRes.error ? null : (ttRes.data || []).map(t => t.name),
  };
};

/* --- Catalog write (admin direct path) ----------------------------------- */

export const upsertJutsu = async (j) => {
  if (!supabase) return;
  const { error } = await supabase.from('jutsus').upsert(toRowJutsu(j, true));
  if (error) throw error;
};

export const deleteJutsu = async (id) => {
  if (!supabase) return;
  const { error } = await supabase.from('jutsus').delete().eq('id', id);
  if (error) throw error;
};

export const upsertBloodline = async (b) => {
  if (!supabase) return;
  const { error } = await supabase.from('bloodlines').upsert(toRowBloodline(b));
  if (error) throw error;
};

export const deleteBloodline = async (id) => {
  if (!supabase) return;
  const { error } = await supabase.from('bloodlines').delete().eq('id', id);
  if (error) throw error;
};

export const setSpecializations = async (names) => {
  if (!supabase) return;
  const { error: delError } = await supabase.from('specializations').delete().neq('name', '___never___');
  if (delError) throw delError;
  if (names.length === 0) return;
  const { error } = await supabase.from('specializations').insert(names.map(name => ({ name })));
  if (error) throw error;
};

export const setJutsuTypeTags = async (names) => {
  if (!supabase) return;
  const { error: delError } = await supabase.from('jutsu_type_tags').delete().neq('name', '___never___');
  if (delError) throw delError;
  if (names.length === 0) return;
  const { error } = await supabase.from('jutsu_type_tags').insert(names.map(name => ({ name })));
  if (error) throw error;
};

/* --- Submission controls -------------------------------------------------- */

export const fetchSubmissionControls = async () => {
  if (!supabase) return { jutsu_paused: false, custom_item_paused: false, summon_paused: false, character_paused: false, discord_notifications_paused: false };
  const { data, error } = await supabase.from('submission_controls').select('*').eq('id', 1).single();
  if (error) throw error;
  return data;
};

export const updateSubmissionControl = async (key, value, userId) => {
  if (!supabase) return;
  const { error } = await supabase.from('submission_controls').update({
    [key]: value,
    updated_by: userId,
    updated_at: new Date().toISOString(),
  }).eq('id', 1);
  if (error) throw error;
};

/* ── Character sheets ────────────────────────────────────────────────────────
 * The in-database OC sheet (supabase/add-character-sheets.sql). Sheets are
 * public reference material; writing is gated by RLS to the owner and staff+.
 * Roster rows are matched to a sheet by character name, which the table keeps
 * unique case-insensitively.
 */

const SHEET_COLUMNS = 'id, owner_id, character_name, village, ninja_rank, bloodline, data, created_at, updated_at';

// Index of every sheet, keyed by lowercased name — what the roster needs to
// know which rows are clickable. `data` is left out so the payload stays small.
export const fetchCharacterSheetIndex = async () => {
  if (!supabase) return {};
  const { data, error } = await supabase
    .from('character_sheets')
    .select('id, owner_id, character_name, village, ninja_rank, bloodline, updated_at');
  // The table may not exist yet on a deploy that hasn't run the migration.
  if (error) {
    if (error.code === '42P01') return {};
    throw error;
  }
  const index = {};
  for (const row of data || []) {
    index[(row.character_name || '').trim().toLowerCase()] = row;
  }
  return index;
};

// Every approved OC name on the roster (flat entries + squad members),
// regardless of whether that character has filled in a character sheet yet.
// Used to populate "pick an OC" pickers elsewhere — a character sheet is a
// separate, opt-in record, so most roster names won't have one yet.
export const fetchRosterCharacterNames = async () => {
  if (!supabase) return [];
  const [entries, squads] = await Promise.all([
    supabase.from('roster_entries').select('name').eq('status', 'approved'),
    supabase.from('roster_squads').select('name').eq('status', 'approved'),
  ]);
  if (entries.error) throw entries.error;
  if (squads.error) throw squads.error;
  const seen = new Set();
  const names = [];
  for (const row of [...(entries.data || []), ...(squads.data || [])]) {
    const name = (row.name || '').trim();
    const key = name.toLowerCase();
    if (!name || seen.has(key)) continue;
    seen.add(key);
    names.push(name);
  }
  return names.sort((a, b) => a.localeCompare(b));
};

export const fetchCharacterSheetById = async (id) => {
  if (!supabase || !id) return null;
  const { data, error } = await supabase
    .from('character_sheets').select(SHEET_COLUMNS).eq('id', id).maybeSingle();
  if (error) throw error;
  return data;
};

export const fetchCharacterSheetByName = async (name) => {
  if (!supabase || !name?.trim()) return null;
  const { data, error } = await supabase
    .from('character_sheets').select(SHEET_COLUMNS)
    .ilike('character_name', name.trim())
    .maybeSingle();
  if (error) {
    if (error.code === '42P01') return null;
    throw error;
  }
  return data;
};

export const fetchMyCharacterSheets = async () => {
  if (!supabase) return [];
  const { data: { user } } = await supabase.auth.getUser();
  if (!user?.id) return [];
  const { data, error } = await supabase
    .from('character_sheets').select(SHEET_COLUMNS)
    .eq('owner_id', user.id).order('created_at');
  if (error) {
    if (error.code === '42P01') return [];
    throw error;
  }
  return data || [];
};

// Insert or update. `id` absent = create, and the creator becomes the owner
// unless an explicit ownerId is passed (staff filing a sheet for a player).
export const saveCharacterSheet = async ({ id, characterName, village, ninjaRank, bloodline, data, ownerId }) => {
  if (!supabase) throw new Error('Supabase is not configured');
  const { data: { user } } = await supabase.auth.getUser();
  if (!user?.id) throw new Error('You must be signed in to save a character sheet');

  const payload = {
    character_name: (characterName || '').trim(),
    village: village || null,
    ninja_rank: ninjaRank || null,
    bloodline: bloodline || null,
    data: data || {},
    updated_by: user.id,
  };
  if (!payload.character_name) throw new Error('The sheet needs a character name');

  if (id) {
    if (ownerId !== undefined) payload.owner_id = ownerId;
    const { data: row, error } = await supabase
      .from('character_sheets').update(payload).eq('id', id).select(SHEET_COLUMNS).single();
    if (error) throw error;
    return row;
  }

  const { data: row, error } = await supabase
    .from('character_sheets')
    .insert({ ...payload, owner_id: ownerId !== undefined ? ownerId : user.id })
    .select(SHEET_COLUMNS).single();
  if (error) {
    // Unique index on lower(btrim(character_name)).
    if (error.code === '23505') throw new Error('A character sheet with that name already exists');
    throw error;
  }
  return row;
};

export const deleteCharacterSheet = async (id) => {
  if (!supabase || !id) return;
  const { error } = await supabase.from('character_sheets').delete().eq('id', id);
  if (error) throw error;
};

/* --- RP grading & upgrade credits (Phase 1) ---------------------------------
   The two-gate pipeline: players submit RPs, a grader approves them (minting
   one single-use credit per participating character), players spend credits
   on upgrade requests, a reviewer approves those (auto-updating the sheet).
   All state transitions run through SECURITY DEFINER RPCs — see
   supabase/add-rp-grading-upgrades.sql. RLS scopes reads: players see their
   own rows, grader+ sees the grading queue, reviewer+ the upgrade queue. */

const RP_SUBMISSION_COLUMNS = `
  id, submitter_id, rp_type, description, thread_url, status, grader_id,
  sol_only, grader_notes, created_at, graded_at,
  submitter:profiles!rp_submissions_submitter_id_fkey (id, username, site_nickname, avatar_url, discord_id),
  grader:profiles!rp_submissions_grader_id_fkey (id, username, site_nickname, avatar_url),
  participants:rp_participants (
    id, user_id, discord_user_id, character_id, claimed_tags,
    profile:profiles!rp_participants_user_id_fkey (id, username, site_nickname, avatar_url, discord_id),
    character:character_sheets!rp_participants_character_id_fkey (id, character_name, ninja_rank, owner_id)
  )
`;

export const submitRpSubmission = async ({ rpType, description, threadUrl, participants }) => {
  if (!supabase) throw new Error('Supabase is not configured');
  const { data: { user } } = await supabase.auth.getUser();
  if (!user?.id) throw new Error('You must be signed in to submit an RP');

  const { data: submission, error } = await supabase
    .from('rp_submissions')
    .insert({
      submitter_id: user.id,
      rp_type: rpType,
      description: (description || '').trim(),
      thread_url: (threadUrl || '').trim(),
    })
    .select('id')
    .single();
  if (error) throw error;

  const rows = (participants || []).map(p => ({
    submission_id: submission.id,
    user_id: p.userId,
    discord_user_id: p.discordUserId || '',
    character_id: p.characterId,
    claimed_tags: p.claimedTags || [],
  }));
  const { error: pErr } = await supabase.from('rp_participants').insert(rows);
  if (pErr) {
    // Participants failed — don't leave a participant-less submission behind.
    await supabase.from('rp_submissions').delete().eq('id', submission.id);
    throw pErr;
  }
  return submission.id;
};

// RLS already scopes this: players get their own submissions (plus ones
// they participate in), grader+ gets everything.
export const fetchRpSubmissions = async () => {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('rp_submissions')
    .select(RP_SUBMISSION_COLUMNS)
    .order('created_at', { ascending: false });
  if (error) {
    if (error.code === '42P01') return []; // migration not run yet
    throw error;
  }
  return data || [];
};

export const cancelRpSubmission = async (id) => {
  if (!supabase || !id) return;
  const { error } = await supabase.from('rp_submissions').delete().eq('id', id);
  if (error) throw error;
};

// Gate 1 verdict. tagsByParticipant: { [participantRowId]: string[] } — the
// eligible tags the grader approved for each participant's credit.
export const gradeRpSubmission = async (id, { approve, solOnly, tagsByParticipant, notes }) => {
  if (!supabase) throw new Error('Supabase is not configured');
  const { error } = await supabase.rpc('grade_rp_submission', {
    p_submission_id: id,
    p_approve: !!approve,
    p_sol_only: !!solOnly,
    p_participant_tags: tagsByParticipant || {},
    p_notes: notes || '',
  });
  if (error) throw error;
};

export const fetchCreditsForCharacters = async (characterIds) => {
  if (!supabase || !characterIds?.length) return [];
  const { data, error } = await supabase
    .from('rp_credits')
    .select(`
      id, submission_id, character_id, eligible_tags, status,
      spent_on_upgrade_id, credit_value, created_at,
      submission:rp_submissions!rp_credits_submission_id_fkey (
        id, rp_type, description, thread_url, grader_notes, graded_at,
        grader:profiles!rp_submissions_grader_id_fkey (username, site_nickname)
      )
    `)
    .in('character_id', characterIds)
    .order('created_at', { ascending: false });
  if (error) {
    if (error.code === '42P01') return [];
    throw error;
  }
  return data || [];
};

export const submitUpgradeRequest = async ({ characterId, upgradeType, target, computedCost, attachedCreditIds, warnings }) => {
  if (!supabase) throw new Error('Supabase is not configured');
  const { data: { user } } = await supabase.auth.getUser();
  if (!user?.id) throw new Error('You must be signed in to request an upgrade');
  const { data, error } = await supabase
    .from('upgrade_requests')
    .insert({
      character_id: characterId,
      requester_id: user.id,
      upgrade_type: upgradeType,
      target,
      computed_cost: computedCost,
      attached_credit_ids: attachedCreditIds || [],
      warnings: warnings || [],
    })
    .select('id')
    .single();
  if (error) throw error;
  return data.id;
};

// RLS-scoped like submissions: requester/owner sees their own, reviewer+ all.
// The joined sheet `data` feeds the reviewer's live warning recompute.
export const fetchUpgradeRequests = async () => {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('upgrade_requests')
    .select(`
      id, character_id, requester_id, upgrade_type, target, computed_cost,
      attached_credit_ids, warnings, status, reviewer_id, override_reason,
      review_note, before_value, cycle_key, created_at, reviewed_at,
      reverted_by, reverted_at,
      character:character_sheets!upgrade_requests_character_id_fkey (id, character_name, ninja_rank, owner_id, data),
      requester:profiles!upgrade_requests_requester_id_fkey (id, username, site_nickname, avatar_url, discord_id),
      reviewer:profiles!upgrade_requests_reviewer_id_fkey (id, username, site_nickname)
    `)
    .order('created_at', { ascending: false });
  if (error) {
    if (error.code === '42P01') return [];
    throw error;
  }
  return data || [];
};

export const cancelUpgradeRequest = async (id) => {
  if (!supabase || !id) return;
  const { error } = await supabase.from('upgrade_requests').delete().eq('id', id);
  if (error) throw error;
};

export const approveUpgradeRequest = async (id, overrideReason) => {
  if (!supabase) throw new Error('Supabase is not configured');
  const { error } = await supabase.rpc('approve_upgrade_request', {
    p_request_id: id,
    p_override_reason: overrideReason || null,
  });
  if (error) throw error;
};

export const rejectUpgradeRequest = async (id, reason) => {
  if (!supabase) throw new Error('Supabase is not configured');
  const { error } = await supabase.rpc('reject_upgrade_request', {
    p_request_id: id,
    p_reason: reason || null,
  });
  if (error) throw error;
};

export const revertUpgrade = async (id) => {
  if (!supabase) throw new Error('Supabase is not configured');
  const { error } = await supabase.rpc('revert_upgrade', { p_request_id: id });
  if (error) throw error;
};

export const fetchApprovedThisCycle = async (characterId) => {
  if (!supabase || !characterId) return 0;
  const { data, error } = await supabase.rpc('approved_upgrades_this_cycle', {
    p_character_id: characterId,
  });
  if (error) return 0;
  return data || 0;
};

/* --- Combat tracker (Phase 1: lifecycle + basic 1-post turns) --------------
   A battle is one combat instance bound to an RP thread. CU pool and jutsu
   list are read live from character_sheets — this layer never re-enters
   cost data, it only spends/logs against it via SECURITY DEFINER RPCs. See
   supabase/add-combat-tracker.sql. RLS scopes reads: open-lobby drafts are
   public, everything else is host/participant/reviewer+ only. */

const BATTLE_COLUMNS = `
  id, thread_url, host_id, visibility_mode, status, turn_order,
  current_turn_index, round_number, created_at, locked_at, ended_at,
  host:profiles!battles_host_id_fkey (id, username, site_nickname, avatar_url),
  participants:battle_participants (
    id, character_id, user_id, invite_status, max_cu, current_cu, joined_at,
    character:character_sheets!battle_participants_character_id_fkey (id, character_name, ninja_rank, owner_id),
    profile:profiles!battle_participants_user_id_fkey (id, username, site_nickname, avatar_url)
  )
`;

export const fetchBattles = async () => {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('battles')
    .select(BATTLE_COLUMNS)
    .order('created_at', { ascending: false });
  if (error) {
    if (error.code === '42P01') return []; // migration not run yet
    throw error;
  }
  return data || [];
};

export const fetchBattle = async (id) => {
  if (!supabase || !id) return null;
  const { data, error } = await supabase
    .from('battles')
    .select(BATTLE_COLUMNS)
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  return data;
};

export const fetchBattleTurnLog = async (battleId) => {
  if (!supabase || !battleId) return [];
  const { data, error } = await supabase
    .from('battle_turn_log')
    .select(`
      id, round_number, turn_index, actor_character_id, actor_user_id,
      action_type, jutsu_name, jutsu_rank, jutsu_nature, cu_cost,
      cu_remaining_after, resolution_summary, created_at,
      actor:character_sheets!battle_turn_log_actor_character_id_fkey (character_name)
    `)
    .eq('battle_id', battleId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return data || [];
};

export const createBattle = async (threadUrl, visibilityMode) => {
  if (!supabase) throw new Error('Supabase is not configured');
  const { data, error } = await supabase.rpc('create_battle', {
    p_thread_url: threadUrl, p_visibility_mode: visibilityMode,
  });
  if (error) throw error;
  return data;
};

export const joinBattle = async (battleId, characterId) => {
  if (!supabase) throw new Error('Supabase is not configured');
  const { error } = await supabase.rpc('join_battle', { p_battle_id: battleId, p_character_id: characterId });
  if (error) throw error;
};

export const inviteToBattle = async (battleId, characterId, userId) => {
  if (!supabase) throw new Error('Supabase is not configured');
  const { error } = await supabase.rpc('invite_to_battle', {
    p_battle_id: battleId, p_character_id: characterId, p_user_id: userId,
  });
  if (error) throw error;
};

export const acceptBattleInvite = async (battleId, characterId) => {
  if (!supabase) throw new Error('Supabase is not configured');
  const { error } = await supabase.rpc('accept_battle_invite', { p_battle_id: battleId, p_character_id: characterId });
  if (error) throw error;
};

export const removeBattleParticipant = async (battleId, characterId) => {
  if (!supabase) throw new Error('Supabase is not configured');
  const { error } = await supabase.rpc('remove_participant', { p_battle_id: battleId, p_character_id: characterId });
  if (error) throw error;
};

export const lockBattle = async (battleId, turnOrder) => {
  if (!supabase) throw new Error('Supabase is not configured');
  const { error } = await supabase.rpc('lock_battle', { p_battle_id: battleId, p_turn_order: turnOrder });
  if (error) throw error;
};

export const declareTurn = async (battleId, actionType, jutsuName) => {
  if (!supabase) throw new Error('Supabase is not configured');
  const { error } = await supabase.rpc('declare_turn', {
    p_battle_id: battleId, p_action_type: actionType, p_jutsu_name: jutsuName || null,
  });
  if (error) throw error;
};

export const endBattle = async (battleId, status) => {
  if (!supabase) throw new Error('Supabase is not configured');
  const { error } = await supabase.rpc('end_battle', { p_battle_id: battleId, p_status: status });
  if (error) throw error;
};

export const forceAdvanceTurn = async (battleId) => {
  if (!supabase) throw new Error('Supabase is not configured');
  const { error } = await supabase.rpc('force_advance_turn', { p_battle_id: battleId });
  if (error) throw error;
};

export const savePushSubscription = async (sub) => {
  if (!supabase) return;
  const { data: { user } } = await supabase.auth.getUser();
  if (!user?.id) return;
  const json = sub.toJSON();
  await supabase.from('push_subscriptions').upsert({
    user_id: user.id,
    endpoint: json.endpoint,
    p256dh: json.keys.p256dh,
    auth: json.keys.auth,
  }, { onConflict: 'endpoint' });
};

export const deletePushSubscription = async (endpoint) => {
  if (!supabase || !endpoint) return;
  await supabase.from('push_subscriptions').delete().eq('endpoint', endpoint);
};
