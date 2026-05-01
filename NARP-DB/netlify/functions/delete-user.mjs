import { neon } from '@neondatabase/serverless';
import { getAuthUser, SUPER_ADMIN_EMAIL, ensureUsersTable } from './lib/auth.mjs';

export default async (req) => {
  if (req.method !== 'POST') {
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
    const { targetUid } = await req.json();

    if (!targetUid) {
      return new Response(JSON.stringify({ error: 'Missing targetUid' }), { status: 400 });
    }

    // Verify the requester is an admin
    const requesterRows = await sql`SELECT * FROM users WHERE id = ${payload.uid}`;
    if (requesterRows.length === 0 || requesterRows[0].role !== 'admin') {
      return new Response(JSON.stringify({ error: 'Only admins can delete accounts' }), { status: 403 });
    }
    const requester = requesterRows[0];

    // Get the target user
    const targetRows = await sql`SELECT * FROM users WHERE id = ${targetUid}`;
    if (targetRows.length === 0) {
      return new Response(JSON.stringify({ error: 'Target user not found' }), { status: 404 });
    }
    const target = targetRows[0];

    // Super admin cannot be deleted
    if (target.email === SUPER_ADMIN_EMAIL) {
      return new Response(JSON.stringify({ error: 'Cannot delete super admin account' }), { status: 403 });
    }

    // Non-super-admin cannot delete other admins
    if (target.role === 'admin' && requester.email !== SUPER_ADMIN_EMAIL) {
      return new Response(JSON.stringify({ error: 'Only super admin can delete admin accounts' }), { status: 403 });
    }

    // Delete from PostgreSQL
    await sql`DELETE FROM users WHERE id = ${targetUid}`;

    // Also clean up any pending faction access requests for this user
    await sql`DELETE FROM pending_faction_access WHERE target_uid = ${targetUid}`;

    return new Response(JSON.stringify({ success: true, message: 'Account deleted successfully' }), { status: 200 });
  } catch (err) {
    console.error('Delete user error:', err);
    return new Response(JSON.stringify({ error: err.message || 'Internal server error' }), { status: 500 });
  }
};

export const config = {
  path: '/api/delete-user',
};
