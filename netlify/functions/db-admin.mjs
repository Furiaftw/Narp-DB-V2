import { neon } from '@neondatabase/serverless';
import { ensureSchema } from './db-ensure-schema.mjs';

const CORS_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: CORS_HEADERS });
}

// Allowed tables and their columns (for validation)
const TABLE_SCHEMA = {
  jutsus: ['name', 'nature', 'rank', 'cost', 'types', 'origin', 'specialization', 'doc_link', 'bloodline', 'conditions', 'secret_faction', 'staff_review', 'slots'],
  battlemodes: ['name', 'category', 'bloodline', 'nature', 'doc_link', 'limited', 'available', 'slots', 'must_learn_ic'],
  clan_slots: ['name', 'available', 'doc_link', 'slots'],
  bloodlines: ['category', 'name', 'doc_link', 'subcategory'],
  factions: ['name'],
  pending_entries: ['table_name', 'entry_data', 'submitted_by_email', 'submitted_by_role', 'status', 'admin_approval_pending', 'approved_by_email', 'approved_by_role'],
  pending_faction_access: ['target_uid', 'target_email', 'faction', 'requested_by_email', 'requested_by_role', 'status', 'approved_by_email', 'approved_by_role'],
};

function sanitizeFields(table, body) {
  const allowed = TABLE_SCHEMA[table];
  if (!allowed) return null;
  const result = {};
  for (const col of allowed) {
    result[col] = body[col] !== undefined && body[col] !== null ? String(body[col]).trim() : '';
  }
  return result;
}

export default async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  const databaseUrl = process.env.NETLIFY_DATABASE_URL || process.env.DATABASE_URL;
  if (!databaseUrl) {
    return json({ error: 'Database URL not configured' }, 500);
  }

  const url = new URL(req.url);
  const table = url.searchParams.get('table');
  const id = url.searchParams.get('id');

  if (!table || !TABLE_SCHEMA[table]) {
    return json({ error: `Invalid table. Allowed: ${Object.keys(TABLE_SCHEMA).join(', ')}` }, 400);
  }

  try {
    const sql = neon(databaseUrl);
    await ensureSchema(sql);
    // GET — list all rows from a table
    if (req.method === 'GET') {
      const rows = await sql.query(`SELECT * FROM ${table} ORDER BY id`);
      return json({ table, rows, count: rows.length });
    }

    // POST — insert a new row
    if (req.method === 'POST') {
      const body = await req.json();
      const fields = sanitizeFields(table, body);
      if (!fields) return json({ error: 'Invalid table' }, 400);

      const cols = Object.keys(fields);
      const vals = Object.values(fields);
      const placeholders = cols.map((_, i) => `$${i + 1}`).join(', ');
      const query = `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${placeholders}) RETURNING *`;
      const rows = await sql.query(query, vals);
      return json({ success: true, row: rows[0] }, 201);
    }

    // PUT — update a row by id
    if (req.method === 'PUT') {
      if (!id) return json({ error: 'Missing id parameter' }, 400);
      const body = await req.json();
      const fields = sanitizeFields(table, body);
      if (!fields) return json({ error: 'Invalid table' }, 400);

      const cols = Object.keys(fields);
      const vals = Object.values(fields);
      const setClauses = cols.map((col, i) => `${col} = $${i + 1}`).join(', ');
      const query = `UPDATE ${table} SET ${setClauses} WHERE id = $${cols.length + 1} RETURNING *`;
      const rows = await sql.query(query, [...vals, Number(id)]);
      if (rows.length === 0) return json({ error: 'Row not found' }, 404);
      return json({ success: true, row: rows[0] });
    }

    // DELETE — delete a row by id
    if (req.method === 'DELETE') {
      if (!id) return json({ error: 'Missing id parameter' }, 400);
      const rows = await sql.query(`DELETE FROM ${table} WHERE id = $1 RETURNING *`, [Number(id)]);
      if (rows.length === 0) return json({ error: 'Row not found' }, 404);
      return json({ success: true, deleted: rows[0] });
    }

    return json({ error: 'Method not allowed' }, 405);
  } catch (error) {
    return json({ error: error.message }, 500);
  }
};

export const config = {
  path: '/api/db-admin',
};
