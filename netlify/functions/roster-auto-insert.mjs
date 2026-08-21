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

const VILLAGE_IDS = {
  konohagakure: 'konoha',
  kumogakure: 'kumo',
  kirigakure: 'kiri',
};

/*
 * Automated roster insertion for an approved OC submission. Reads the pending
 * entry server-side (so the payload can't be spoofed) and inserts approved
 * roster rows, bypassing RLS:
 *   Genin  → roster_squads role 'genin' in the chosen squad (new squads get a
 *            captainless sentinel row, matching the manual create-squad flow)
 *   Chūnin → roster_squads role 'member', same squad logic
 *   Jōnin / Special Jōnin → roster_entries in the village's elite sections;
 *            councilors also get a Village Council entry, and an optional
 *            mentor assignment makes them captain of a captainless genin squad
 *
 * Must be called BEFORE the pending row is deleted. Staff/admin/owner only.
 */
export default async (req) => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const authHeader = req.headers.get('authorization');
  if (!authHeader?.startsWith('Bearer ')) return json({ error: 'Missing auth token' }, 401);
  const { data: { user }, error: authError } = await supabase.auth.getUser(authHeader.slice(7));
  if (authError || !user) return json({ error: 'Invalid token' }, 401);

  const { data: profile } = await supabase
    .from('profiles').select('role').eq('id', user.id).maybeSingle();
  if (!['grader', 'reviewer', 'admin', 'owner'].includes(profile?.role)) {
    return json({ error: 'Reviewer access required' }, 403);
  }

  let body;
  try { body = await req.json(); } catch { return json({ error: 'Invalid JSON body' }, 400); }
  const { pendingId } = body || {};
  if (!pendingId) return json({ error: 'Missing pendingId' }, 400);

  const { data: pendingRow, error: pendErr } = await supabase
    .from('pending_jutsus').select('id, data, submitted_by').eq('id', pendingId).maybeSingle();
  if (pendErr) return json({ error: 'Pending lookup failed: ' + pendErr.message }, 500);
  if (!pendingRow) return json({ error: 'Pending entry not found' }, 404);

  const d = pendingRow.data || {};
  if (d.type !== 'Character') return json({ ok: true, skipped: true, reason: 'not_a_character' });

  const villageId = VILLAGE_IDS[(d.village || '').trim().toLowerCase()];
  const rank = d.ninja_rank;
  const name = d.name || 'OC';
  const link = d.myCharactersLink || null;
  const isWanderer = (d.village || '').trim().toLowerCase() === 'wanderer';
  if ((!villageId && !isWanderer) || !rank) return json({ ok: true, skipped: true, reason: 'missing_village_or_rank' });

  const warnings = [];
  const stamp = {
    created_by: user.id,
    updated_by: user.id,
    status: 'approved',
    approved_by: user.id,
  };
  // The actual OC owner (original submitter), not the reviewer running this
  // approval. Only applied to rows that represent a real character below --
  // never to the captainless sentinel placeholder rows.
  const owner = { owner_id: pendingRow.submitted_by || null };

  // Wanderers live outside the village system: one entry in the Wanderer
  // roster section, no squads/elite/council rows.
  if (isWanderer) {
    try {
      const { error: wErr } = await supabase.from('roster_entries').insert({
        roster_type: 'wanderer', name, discord_link: link, meta: {}, ...stamp, ...owner,
      });
      if (wErr) throw wErr;
      return json({ ok: true, inserted: 'wanderer', warnings });
    } catch (err) {
      return json({ error: 'Roster insert failed: ' + (err.message || String(err)) }, 500);
    }
  }

  try {
    if (rank === 'Genin' || rank === 'Chūnin') {
      const squadType = rank === 'Genin' ? 'genin' : 'chunin';
      const memberRole = rank === 'Genin' ? 'genin' : 'member';

      const { data: squads, error: sqErr } = await supabase
        .from('roster_squads')
        .select('squad_number')
        .eq('village', villageId).eq('squad_type', squadType);
      if (sqErr) throw sqErr;

      const numbers = [...new Set((squads || []).map(s => s.squad_number))];
      const nextNum = numbers.length ? Math.max(...numbers) + 1 : 1;
      let num = Number(d.squad_number) || 0;
      // "Start my own squad": if the chosen number was taken in the meantime,
      // allocate the next free one instead of silently joining someone else's.
      if (!num) num = nextNum;
      else if (d.squad_is_new && numbers.includes(num)) num = nextNum;
      const squadExists = numbers.includes(num);

      const rows = [];
      if (!squadExists) {
        // New squad: captainless placeholder row, same as the manual flow.
        rows.push({ village: villageId, squad_type: squadType, squad_number: num, role: 'sentinel', name: '', ...stamp });
      }
      rows.push({ village: villageId, squad_type: squadType, squad_number: num, role: memberRole, name, discord_link: link, ...stamp, ...owner });

      const { error: insErr } = await supabase.from('roster_squads').insert(rows);
      if (insErr) throw insErr;

      return json({ ok: true, inserted: 'squad_member', squad_number: num, new_squad: !squadExists, warnings });
    }

    if (rank === 'Jōnin' || rank === 'Special Jōnin') {
      const rosterType = rank === 'Jōnin' ? `${villageId}_jonin` : `${villageId}_special_jonin`;
      const entryRows = [
        { roster_type: rosterType, name, discord_link: link, meta: {}, ...stamp, ...owner },
      ];
      // Councilor is a symbolic rank: the character stays a Jōnin and is
      // additionally listed in the Village Council section.
      if (rank === 'Jōnin' && d.councilor) {
        entryRows.push({ roster_type: `${villageId}_council`, name, discord_link: link, meta: {}, ...stamp, ...owner });
      }
      const { error: entErr } = await supabase.from('roster_entries').insert(entryRows);
      if (entErr) throw entErr;

      // Optional: mentor (captain) a genin squad, if it is still captainless.
      const mentorNum = Number(d.mentor_squad_number) || 0;
      if (mentorNum > 0) {
        const { data: squadRows, error: mErr } = await supabase
          .from('roster_squads')
          .select('id, role')
          .eq('village', villageId).eq('squad_type', 'genin').eq('squad_number', mentorNum);
        if (mErr) throw mErr;

        const hasCaptain = (squadRows || []).some(r => r.role === 'captain');
        if (hasCaptain) {
          warnings.push(`Genin Squad ${mentorNum} already has a captain — mentor assignment skipped.`);
        } else {
          const { error: capErr } = await supabase.from('roster_squads').insert({
            village: villageId, squad_type: 'genin', squad_number: mentorNum,
            role: 'captain', name, discord_link: link, ...stamp, ...owner,
          });
          if (capErr) throw capErr;
          // Remove the captainless placeholder, mirroring the manual flow.
          await supabase.from('roster_squads')
            .delete()
            .eq('village', villageId).eq('squad_type', 'genin')
            .eq('squad_number', mentorNum).eq('role', 'sentinel');
        }
      }

      return json({ ok: true, inserted: rosterType, councilor: !!(rank === 'Jōnin' && d.councilor), warnings });
    }

    return json({ ok: true, skipped: true, reason: 'unknown_rank' });
  } catch (err) {
    return json({ error: 'Roster insert failed: ' + (err.message || String(err)) }, 500);
  }
};
