import { neon } from '@neondatabase/serverless';
import { getAuthUser, SUPER_ADMIN_EMAIL, ensureUsersTable } from './lib/auth.mjs';

export default async (req) => {
  try {
    const databaseUrl = process.env.NETLIFY_DATABASE_URL || process.env.DATABASE_URL;
    if (!databaseUrl) {
      return new Response(JSON.stringify({ error: 'Database not configured' }), { status: 500 });
    }

    const payload = getAuthUser(req);
    if (!payload) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
    }

    if (req.method === 'GET') {
      const sql = neon(databaseUrl);
      await ensureUsersTable(sql);
      const isSuperAdmin = payload.email?.toLowerCase() === SUPER_ADMIN_EMAIL;
      const rows = await sql`SELECT * FROM users WHERE id = ${payload.uid}`;
      if (rows.length === 0) {
        return new Response(JSON.stringify({ error: 'User not found' }), { status: 404 });
      }
      // Ensure super admin always has admin role and approved status
      if (isSuperAdmin && (rows[0].status !== 'approved' || rows[0].role !== 'admin')) {
        await sql`UPDATE users SET role = 'admin', status = 'approved' WHERE id = ${payload.uid}`;
        rows[0].role = 'admin';
        rows[0].status = 'approved';
      }
      return new Response(JSON.stringify(rows[0]), { status: 200 });
    }

    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
  } catch (err) {
    console.error('user-profile error:', err);
    return new Response(JSON.stringify({ error: err.message || 'Internal server error' }), { status: 500 });
  }
};

export const config = {
  path: '/api/user-profile',
};
