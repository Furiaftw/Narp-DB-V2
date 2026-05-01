import { neon } from '@neondatabase/serverless';

/**
 * Ensures all required database tables and columns exist.
 * Called automatically by db-admin and db-approvals before queries.
 */
export async function ensureSchema(sql) {
  // Create jutsus table
  await sql`
    CREATE TABLE IF NOT EXISTS jutsus (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      nature TEXT DEFAULT '',
      rank TEXT DEFAULT '',
      cost TEXT DEFAULT '',
      types TEXT DEFAULT '',
      origin TEXT DEFAULT '',
      specialization TEXT DEFAULT '',
      doc_link TEXT DEFAULT '',
      bloodline TEXT DEFAULT '',
      conditions TEXT DEFAULT '',
      secret_faction TEXT DEFAULT '',
      staff_review TEXT DEFAULT '',
      slots TEXT DEFAULT ''
    )
  `;

  // Create battlemodes table
  await sql`
    CREATE TABLE IF NOT EXISTS battlemodes (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      category TEXT DEFAULT '',
      bloodline TEXT DEFAULT '',
      nature TEXT DEFAULT '',
      doc_link TEXT DEFAULT '',
      limited TEXT DEFAULT '',
      available TEXT DEFAULT '',
      slots TEXT DEFAULT '',
      must_learn_ic TEXT DEFAULT ''
    )
  `;

  // Create clan_slots table
  await sql`
    CREATE TABLE IF NOT EXISTS clan_slots (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      available TEXT DEFAULT '',
      doc_link TEXT DEFAULT '',
      slots TEXT DEFAULT ''
    )
  `;

  // Create bloodlines table
  await sql`
    CREATE TABLE IF NOT EXISTS bloodlines (
      id SERIAL PRIMARY KEY,
      category TEXT NOT NULL,
      name TEXT NOT NULL,
      doc_link TEXT DEFAULT '',
      subcategory TEXT DEFAULT ''
    )
  `;

  // Create factions table
  await sql`
    CREATE TABLE IF NOT EXISTS factions (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL
    )
  `;

  // Create pending_entries table
  await sql`
    CREATE TABLE IF NOT EXISTS pending_entries (
      id SERIAL PRIMARY KEY,
      table_name TEXT NOT NULL,
      entry_data TEXT NOT NULL DEFAULT '{}',
      submitted_by_email TEXT NOT NULL,
      submitted_by_role TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      admin_approval_pending TEXT DEFAULT '',
      approved_by_email TEXT DEFAULT '',
      approved_by_role TEXT DEFAULT '',
      created_at TIMESTAMP DEFAULT NOW(),
      resolved_at TIMESTAMP
    )
  `;

  // Create pending_faction_access table
  await sql`
    CREATE TABLE IF NOT EXISTS pending_faction_access (
      id SERIAL PRIMARY KEY,
      target_uid TEXT NOT NULL,
      target_email TEXT NOT NULL,
      faction TEXT NOT NULL,
      requested_by_email TEXT NOT NULL,
      requested_by_role TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      approved_by_email TEXT DEFAULT '',
      approved_by_role TEXT DEFAULT '',
      created_at TIMESTAMP DEFAULT NOW(),
      resolved_at TIMESTAMP
    )
  `;

  // Create users table
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

  // Add columns that may be missing on older schemas
  const alterStatements = [
    `ALTER TABLE jutsus ADD COLUMN IF NOT EXISTS staff_review TEXT DEFAULT ''`,
    `ALTER TABLE jutsus ADD COLUMN IF NOT EXISTS slots TEXT DEFAULT ''`,
    `ALTER TABLE battlemodes ADD COLUMN IF NOT EXISTS slots TEXT DEFAULT ''`,
    `ALTER TABLE battlemodes ADD COLUMN IF NOT EXISTS must_learn_ic TEXT DEFAULT ''`,
    `ALTER TABLE clan_slots ADD COLUMN IF NOT EXISTS slots TEXT DEFAULT ''`,
    `ALTER TABLE bloodlines ADD COLUMN IF NOT EXISTS doc_link TEXT DEFAULT ''`,
    `ALTER TABLE bloodlines ADD COLUMN IF NOT EXISTS subcategory TEXT DEFAULT ''`,
    `ALTER TABLE pending_entries ADD COLUMN IF NOT EXISTS admin_approval_pending TEXT DEFAULT ''`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash TEXT`,
  ];

  for (const stmt of alterStatements) {
    try {
      await sql.query(stmt);
    } catch (_) {
      // Ignore errors (column may already exist)
    }
  }
}
