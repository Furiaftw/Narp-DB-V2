import { neon } from '@neondatabase/serverless';
import { verifyPassword, createToken, SUPER_ADMIN_EMAIL, ensureUsersTable } from './lib/auth.mjs';

export default async (req) => {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
  }

  const databaseUrl = process.env.NETLIFY_DATABASE_URL || process.env.DATABASE_URL;
  if (!databaseUrl) {
    return new Response(JSON.stringify({ error: 'Database not configured' }), { status: 500 });
  }

  try {
    const body = await req.json();
    const email = String(body?.email || '').trim().toLowerCase();
    const password = String(body?.password || '');

    if (!email || !password) {
      return new Response(JSON.stringify({ error: 'Email and password are required.' }), { status: 422 });
    }

    const sql = neon(databaseUrl);

    // Auto-create users table if it doesn't exist yet
    await ensureUsersTable(sql);

    const rows = await sql`SELECT * FROM users WHERE LOWER(email) = ${email}`;

    if (rows.length === 0) {
      return new Response(JSON.stringify({ error: 'Invalid email or password.' }), { status: 401 });
    }

    const user = rows[0];

    if (!user.password_hash) {
      const hint = email === SUPER_ADMIN_EMAIL
        ? 'This account was migrated from the old auth system. Please use the "Need access? Register" option to set a new password — your super admin status will be restored automatically.'
        : 'Account requires password reset. Please register again or contact admin.';
      return new Response(JSON.stringify({ error: hint }), { status: 401 });
    }

    if (!verifyPassword(password, user.password_hash)) {
      return new Response(JSON.stringify({ error: 'Invalid email or password.' }), { status: 401 });
    }

    // Ensure super admin always has correct role/status
    const isSuperAdmin = email === SUPER_ADMIN_EMAIL;
    if (isSuperAdmin && (user.role !== 'admin' || user.status !== 'approved')) {
      await sql`UPDATE users SET role = 'admin', status = 'approved' WHERE id = ${user.id}`;
      user.role = 'admin';
      user.status = 'approved';
    }

    if (user.status === 'pending') {
      return new Response(JSON.stringify({
        error: 'Account is pending admin approval.',
        status: 'pending',
      }), { status: 403 });
    }

    if (user.status === 'denied') {
      return new Response(JSON.stringify({
        error: 'Access request was denied by admin.',
        status: 'denied',
      }), { status: 403 });
    }

    const token = createToken(user);

    return new Response(JSON.stringify({
      token,
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        status: user.status,
        nickname: user.nickname || null,
        allowed_factions: user.allowed_factions || '[]',
        created_at: user.created_at,
      },
    }), { status: 200 });
  } catch (err) {
    console.error('auth-login error:', err);
    return new Response(JSON.stringify({ error: err.message || 'Internal server error' }), { status: 500 });
  }
};

export const config = {
  path: '/api/auth/login',
};
