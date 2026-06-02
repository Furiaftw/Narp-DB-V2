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
        headers: { 'Content-Type': 'application/json' },
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

  const { data, error } = await supabase
    .from('profiles')
    .select('id, email, username, avatar_url, role, discord_id')
    .eq('id', session.user.id)
    .maybeSingle();
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

export const fetchAllProfiles = async () => {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('profiles')
    .select('id, email, username, avatar_url, role, discord_id, created_at')
    .order('created_at', { ascending: true });
  if (error) throw error;
  return data || [];
};

export const setUserRole = async (userId, role) => {
  if (!supabase) return;
  if (!['user', 'staff', 'admin', 'owner'].includes(role)) throw new Error('Invalid role');
  const { error } = await supabase.from('profiles').update({ role }).eq('id', userId);
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
  if (!['staff', 'admin'].includes(role)) throw new Error('Whitelist role must be staff or admin');
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
  // Manual join — simpler than configuring a foreign-key relationship.
  const { data: pending, error } = await supabase
    .from('pending_jutsus')
    .select('id, operation, target_id, data, submitted_by, submitted_at, status, first_reviewer_id')
    .order('submitted_at', { ascending: false });
  if (error) throw error;
  if (!pending?.length) return [];

  const profileIds = [...new Set(pending.flatMap(p => [p.submitted_by, p.first_reviewer_id]).filter(Boolean))];
  const { data: profiles } = await supabase
    .from('profiles')
    .select('id, username, email, avatar_url, role, discord_id')
    .in('id', profileIds);

  const profileById = new Map((profiles || []).map(p => [p.id, p]));
  return pending.map(p => ({
    ...p,
    submitter: profileById.get(p.submitted_by) || null,
    first_reviewer: p.first_reviewer_id ? (profileById.get(p.first_reviewer_id) || null) : null,
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
  origin:      row.origin || '',
  spec:        row.spec || [],
  link:        row.link || '',
  bloodline:   row.bloodline || '',
  custom_tags: row.custom_tags || [],
  limited:     !!row.limited,
  locked:      !!row.locked,
  multiRank:   !!row.multi_rank,
  bm_tier:     row.bm_tier || '',
  slots:       parseSlots(row.slots),
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
    origin:      j.origin || null,
    spec:        j.spec || [],
    link:        j.link || null,
    bloodline:   j.bloodline || null,
    custom_tags: j.custom_tags || [],
    limited:     !!j.limited,
    locked:      !!j.locked,
    multi_rank:  !!j.multiRank,
    bm_tier:     j.bm_tier || null,
    slots:       stringifySlotsForDb(j.slots),
  };
  if (withId && j._id) row.id = j._id;
  return row;
};

const fromRowBloodline = (row) => ({
  _id:         row.id,
  _createdAt:  row.created_at,
  _createdBy:  row.created_by,
  _modifiedBy: row.last_modified_by,
  name:        row.name || '',
  category:    row.category || 'Custom',
  subcategory: row.subcategory || 'Other',
  custom_tags: row.custom_tags || [],
  link:        row.link || '',
});

const toRowBloodline = (b) => ({
  id:          b._id,
  name:        b.name || '',
  category:    b.category || null,
  subcategory: b.subcategory || null,
  custom_tags: b.custom_tags || [],
  link:        b.link || null,
});

// Exposed so the App can build the JSON payload for pending submissions.
// Strips the id when building a "data" blob for an insert pending (a fresh
// id will be generated server-side at approval time).
export const buildJutsuPayload = (j, includeId = false) => toRowJutsu(j, includeId);

/* --- Catalog read --------------------------------------------------------- */

export const fetchAllFromSupabase = async () => {
  if (!supabase) return null;

  const [jRes, bRes, sRes] = await Promise.all([
    supabase.from('jutsus').select('*').order('created_at', { ascending: false }),
    supabase.from('bloodlines').select('*').order('created_at', { ascending: false }),
    supabase.from('specializations').select('*').order('created_at', { ascending: true }),
  ]);

  const errs = [jRes, bRes, sRes].filter(r => r.error).map(r => r.error.message);
  if (errs.length) throw new Error('Supabase fetch failed: ' + errs.join('; '));

  return {
    jutsus:          (jRes.data || []).map(fromRowJutsu),
    bloodlines:      (bRes.data || []).map(fromRowBloodline),
    specializations: (sRes.data || []).map(s => s.name),
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
