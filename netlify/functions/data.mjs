import { getStore } from '@netlify/blobs';
import { neon } from '@neondatabase/serverless';

const BLOB_STORE = 'data-cache';
const BLOB_KEY = 'latest';

export default async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
    });
  }

  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
  };

  try {
    // Try to serve from Netlify Blobs cache first
    const store = getStore(BLOB_STORE);
    const cached = await store.get(BLOB_KEY);
    if (cached) {
      return new Response(cached, { status: 200, headers });
    }
  } catch (e) {
    console.log('[data] Blob cache miss or error:', e.message);
  }

  // No cache exists — fall back to direct DB query so initial setup works
  const databaseUrl = process.env.NETLIFY_DATABASE_URL || process.env.DATABASE_URL;
  if (!databaseUrl) {
    return new Response(JSON.stringify({ error: 'Database URL not configured' }), {
      status: 500, headers,
    });
  }

  const sql = neon(databaseUrl);

  try {
    const safeQuery = async (query) => {
      try { return await query; }
      catch (e) {
        if (e.message && (e.message.includes('does not exist') || e.message.includes('relation'))) return [];
        throw e;
      }
    };

    const [jutsus, battlemodes, clanSlots, bloodlineRows, factionRows] = await Promise.all([
      safeQuery(sql`SELECT * FROM jutsus ORDER BY id`),
      safeQuery(sql`SELECT * FROM battlemodes ORDER BY id`),
      safeQuery(sql`SELECT * FROM clan_slots ORDER BY id`),
      safeQuery(sql`SELECT * FROM bloodlines ORDER BY category, id`),
      safeQuery(sql`SELECT * FROM factions ORDER BY id`),
    ]);

    const bloodlines = {};
    for (const row of bloodlineRows) {
      if (!bloodlines[row.category]) bloodlines[row.category] = [];
      bloodlines[row.category].push(row.name);
    }

    const factions = factionRows.map(r => r.name);

    const jutsusData = jutsus.map(row => ({
      'Ability Name': row.name,
      'Nature Type': row.nature,
      'Rank': row.rank,
      'Cost': row.cost,
      'Jutsu Types': row.types,
      'Origin': row.origin,
      'Specialization': row.specialization,
      'Doc Link': row.doc_link,
      'Bloodline': row.bloodline,
      'Conditions': row.conditions,
      'Secret Faction': row.secret_faction,
      'Staff Review': row.staff_review || '',
      'Slots': row.slots || '',
    }));

    const battlemodesData = battlemodes.map(row => ({
      'Name': row.name,
      'Type': row.category,
      'Bloodline/Hidden': row.bloodline,
      'Nature(s)': row.nature,
      'Doc': row.doc_link,
      'Limited': row.limited,
      'Available': row.available,
      'Slots': row.slots || '',
      'Must Learn IC': row.must_learn_ic || '',
    }));

    const clanSlotsData = clanSlots.map(row => ({
      'Name': row.name,
      'Available': row.available,
      'Link': row.doc_link,
      'Slots': row.slots || '',
    }));

    const bloodlinesList = bloodlineRows.map(row => ({
      id: row.id,
      category: row.category,
      name: row.name,
      doc_link: row.doc_link || '',
      subcategory: row.subcategory || '',
    }));

    const response = {
      jutsus: jutsusData,
      battlemodes: battlemodesData,
      clanSlots: clanSlotsData,
      bloodlines,
      bloodlinesList,
      factions,
      _source: 'neon',
      _timestamp: new Date().toISOString(),
    };

    return new Response(JSON.stringify(response), { status: 200, headers });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message, hint: 'Tables are auto-created on first use via ensureSchema.' }), {
      status: 500, headers,
    });
  }
};

export const config = {
  path: '/api/data',
};
