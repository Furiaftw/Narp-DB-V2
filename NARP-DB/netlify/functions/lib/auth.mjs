import { randomBytes, scryptSync, createHmac, randomUUID } from 'crypto';

const SUPER_ADMIN_EMAIL = 'grisales4000@gmail.com';
const TOKEN_EXPIRY_SECONDS = 7 * 24 * 60 * 60; // 7 days

function getSecret() {
  return process.env.AUTH_SECRET || process.env.NETLIFY_DATABASE_URL || process.env.DATABASE_URL || 'fallback-dev-secret';
}

// ── Password Hashing ──────────────────────────────────────────────
export function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

export function verifyPassword(password, stored) {
  const [salt, hash] = stored.split(':');
  const test = scryptSync(password, salt, 64).toString('hex');
  return test === hash;
}

// ── Token Management ──────────────────────────────────────────────
export function createToken(user) {
  const payload = JSON.stringify({
    uid: user.id,
    email: user.email,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + TOKEN_EXPIRY_SECONDS,
  });
  const encoded = Buffer.from(payload).toString('base64url');
  const sig = createHmac('sha256', getSecret()).update(encoded).digest('hex');
  return `${encoded}.${sig}`;
}

export function verifyToken(token) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [encoded, sig] = parts;
  const expected = createHmac('sha256', getSecret()).update(encoded).digest('hex');
  if (sig !== expected) return null;
  try {
    const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString());
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

// ── Request Helpers ───────────────────────────────────────────────
export function getTokenFromRequest(req) {
  const authHeader = req.headers.get?.('authorization') || req.headers?.['authorization'] || '';
  if (authHeader.startsWith('Bearer ')) return authHeader.slice(7);
  return null;
}

export function getAuthUser(req) {
  const token = getTokenFromRequest(req);
  return verifyToken(token);
}

export async function getDbUser(sql, req) {
  const payload = getAuthUser(req);
  if (!payload) return null;
  await ensureUsersTable(sql);
  const rows = await sql`SELECT * FROM users WHERE id = ${payload.uid}`;
  return rows[0] || null;
}

// ── Database Helpers ─────────────────────────────────────────────
export async function ensureUsersTable(sql) {
  await sql`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL,
      password_hash TEXT,
      role TEXT NOT NULL DEFAULT 'user',
      status TEXT NOT NULL DEFAULT 'pending',
      nickname TEXT,
      allowed_factions TEXT DEFAULT '[]',
      created_at TIMESTAMP DEFAULT NOW()
    )
  `;
}

// ── Shared Constants ──────────────────────────────────────────────
export { SUPER_ADMIN_EMAIL, randomUUID };
