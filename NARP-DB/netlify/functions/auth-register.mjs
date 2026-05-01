import { neon } from '@neondatabase/serverless';
import { hashPassword, createToken, randomUUID, SUPER_ADMIN_EMAIL, ensureUsersTable } from './lib/auth.mjs';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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

    if (!EMAIL_RE.test(email)) {
      return new Response(JSON.stringify({ error: 'Invalid email address.' }), { status: 422 });
    }
    if (password.length < 6) {
      return new Response(JSON.stringify({ error: 'Password must be at least 6 characters.' }), { status: 422 });
    }

    const sql = neon(databaseUrl);

    // Auto-create users table if it doesn't exist yet
    await ensureUsersTable(sql);

    const isSuperAdmin = email === SUPER_ADMIN_EMAIL;
    const passwordHash = hashPassword(password);

    // Check if email already exists
    const existing = await sql`SELECT id, password_hash FROM users WHERE LOWER(email) = ${email}`;

    if (existing.length > 0) {
      // If super admin exists but has no password (migrated from old auth system),
      // allow them to set a password and reclaim their account
      if (isSuperAdmin && !existing[0].password_hash) {
        const existingId = existing[0].id;
        await sql`UPDATE users SET password_hash = ${passwordHash}, role = 'admin', status = 'approved' WHERE id = ${existingId}`;
        const user = { id: existingId, email };
        const token = createToken(user);
        return new Response(JSON.stringify({
          status: 'approved',
          message: 'Super admin account recovered. You are now logged in.',
          token,
          user: { id: existingId, email, role: 'admin', status: 'approved', nickname: null, allowed_factions: '[]' },
        }), { status: 200 });
      }
      return new Response(JSON.stringify({ error: 'An account with this email already exists. Try logging in.' }), { status: 409 });
    }

    const id = randomUUID();
    const role = isSuperAdmin ? 'admin' : 'user';
    const status = isSuperAdmin ? 'approved' : 'pending';

    await sql`
      INSERT INTO users (id, email, password_hash, role, status, allowed_factions, created_at)
      VALUES (${id}, ${email}, ${passwordHash}, ${role}, ${status}, '[]', NOW())
    `;

    // Super admin gets auto-logged in
    if (isSuperAdmin) {
      const user = { id, email };
      const token = createToken(user);
      return new Response(JSON.stringify({
        status: 'approved',
        message: 'Admin account created. You are now logged in.',
        token,
        user: { id, email, role, status, nickname: null, allowed_factions: '[]' },
      }), { status: 200 });
    }

    return new Response(JSON.stringify({
      status: 'pending',
      message: 'Account created. An admin must approve your access before you can log in.',
    }), { status: 200 });
  } catch (err) {
    console.error('auth-register error:', err);
    return new Response(JSON.stringify({ error: err.message || 'Internal server error' }), { status: 500 });
  }
};

export const config = {
  path: '/api/auth/register',
};
