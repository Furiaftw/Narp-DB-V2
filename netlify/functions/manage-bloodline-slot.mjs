import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_DATABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } }
);

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

// Clanless (or any bloodline with max_slots = -1) has unlimited capacity.
const isUnlimited = (row) =>
  Number(row.max_slots) === -1 || (row.name || '').trim().toLowerCase() === 'clanless';

const parseSlots = (raw) => {
  if (!raw) return [];
  let arr = raw;
  if (typeof raw === 'string') {
    try { arr = JSON.parse(raw); } catch { return []; }
  }
  if (!Array.isArray(arr)) return [];
  return arr.map(s => (s && typeof s === 'object') ? { ...s } : { username: '' });
};

/*
 * Slot management for bloodline rosters, bypassing RLS (staff can't write to
 * bloodlines directly). Actions:
 *   reserve — hold a slot for a pending "Réservation Request" OC entry
 *   fill    — write an approved OC's name + character-area link into a slot
 *             (converts a reservation held for the same pending entry if any)
 *   release — free a reserved slot (reservation cancelled / entry denied)
 *
 * Staff/admin/owner may do anything; the submitter of the pending entry may
 * release their own reservation (used when they retract the submission).
 */
export default async (req) => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const authHeader = req.headers.get('authorization');
  if (!authHeader?.startsWith('Bearer ')) return json({ error: 'Missing auth token' }, 401);
  const { data: { user }, error: authError } = await supabase.auth.getUser(authHeader.slice(7));
  if (authError || !user) return json({ error: 'Invalid token' }, 401);

  let body;
  try { body = await req.json(); } catch { return json({ error: 'Invalid JSON body' }, 400); }

  const { action, bloodline, pendingId, name, link, label } = body || {};
  if (!['reserve', 'fill', 'release'].includes(action)) return json({ error: 'Invalid action' }, 400);
  if (!bloodline || typeof bloodline !== 'string') return json({ error: 'Missing bloodline' }, 400);
  if (!pendingId) return json({ error: 'Missing pendingId' }, 400);

  // Permission: reviewer+ for everything; the entry's own submitter for release.
  const { data: profile } = await supabase
    .from('profiles').select('role').eq('id', user.id).maybeSingle();
  const isReviewer = ['reviewer', 'admin', 'owner'].includes(profile?.role);
  if (!isReviewer) {
    if (action !== 'release') return json({ error: 'Reviewer access required' }, 403);
    const { data: pendingRow } = await supabase
      .from('pending_jutsus').select('submitted_by').eq('id', pendingId).maybeSingle();
    if (!pendingRow || pendingRow.submitted_by !== user.id) {
      return json({ error: 'Reviewer access required' }, 403);
    }
  }

  const { data: rows, error: blError } = await supabase
    .from('bloodlines').select('*').ilike('name', bloodline).limit(1);
  if (blError) return json({ error: 'Bloodline lookup failed: ' + blError.message }, 500);
  const row = rows?.[0];
  // No matching bloodline row (e.g. Clanless not registered) — nothing to track.
  if (!row) return json({ ok: true, skipped: true, reason: 'bloodline_not_found' });

  const unlimited = isUnlimited(row);
  const maxSlots = Number(row.max_slots ?? 5);
  let slots = parseSlots(row.slots);

  // Finite bloodlines: pad the array out to capacity so array length always
  // equals total capacity (the UI derives capacity from slots.length when set).
  if (!unlimited && maxSlots > 0) {
    while (slots.length < maxSlots) slots.push({ username: '' });
  }

  const reservedIdx = slots.findIndex(s => s?.reserved && s?.pending_id === pendingId);
  const emptyIdx = slots.findIndex(s => !s?.username);

  if (action === 'reserve') {
    if (reservedIdx !== -1) return json({ ok: true, alreadyReserved: true }); // idempotent
    const entry = { username: label || 'Reserved', reserved: true, pending_id: pendingId };
    if (emptyIdx !== -1) slots[emptyIdx] = entry;
    else if (unlimited) slots.push(entry);
    else return json({ error: 'Bloodline is full — no slot available to reserve.' }, 409);
  }

  if (action === 'fill') {
    const entry = { username: name || 'OC', discord_link: link || '' };
    if (reservedIdx !== -1) slots[reservedIdx] = entry;
    else if (emptyIdx !== -1) slots[emptyIdx] = entry;
    else if (unlimited) slots.push(entry);
    else return json({ error: 'Bloodline is full — no open slot for this character.' }, 409);
  }

  if (action === 'release') {
    if (reservedIdx === -1) return json({ ok: true, skipped: true, reason: 'no_reservation' });
    if (unlimited) slots.splice(reservedIdx, 1);
    else slots[reservedIdx] = { username: '' };
  }

  const { error: updError } = await supabase
    .from('bloodlines').update({ slots }).eq('id', row.id);
  if (updError) return json({ error: 'Slot update failed: ' + updError.message }, 500);

  return json({ ok: true, action, bloodline: row.name });
};
