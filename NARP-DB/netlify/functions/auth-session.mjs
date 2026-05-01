import { neon } from '@neondatabase/serverless';
import { getAuthUser, SUPER_ADMIN_EMAIL, ensureUsersTable } from './lib/auth.mjs';

export default async (req) => {
  if (req.method !== 'GET') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
  }

  const databaseUrl = process.env.NETLIFY_DATABASE_URL || process.env.DATABASE_URL;
  if (!databaseUrl) {
    return new Response(JSON.stringify({ error: 'Database not configured' }), { status: 500 });
  }

  try {
    const payload = getAuthUser(req);
    if (!payload) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
    }

    const sql = neon(databaseUrl);
    await ensureUsersTable(sql);
    const rows = await sql`SELECT * FROM users WHERE id = ${payload.uid}`;

    if (rows.length === 0) {
      return new Response(JSON.stringify({ error: 'User not found' }), { status: 404 });
    }

    const user = rows[0];

    // Ensure super admin always has correct role/status
    if (user.email?.toLowerCase() === SUPER_ADMIN_EMAIL && (user.role !== 'admin' || user.status !== 'approved')) {
      await sql`UPDATE users SET role = 'admin', status = 'approved' WHERE id = ${user.id}`;
      user.role = 'admin';
      user.status = 'approved';
    }

    return new Response(JSON.stringify(user), { status: 200 });
  } catch (err) {
    console.error('auth-session error:', err);
    return new Response(JSON.stringify({ error: err.message || 'Internal server error' }), { status: 500 });
  }
};

export const config = {
  path: '/api/auth/session',
};
