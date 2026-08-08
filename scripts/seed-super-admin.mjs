#!/usr/bin/env node
/**
 * Seed (or upsert) a single super-admin so a fresh deployment can sign in
 * before any admin exists. Safe to re-run — upserts by email and refreshes
 * the password hash + name each time.
 *
 * Reads from env (preferred, works cleanly with `--env-file-if-exists`):
 *   SEED_SUPER_ADMIN_EMAIL     — required
 *   SEED_SUPER_ADMIN_PASSWORD  — required, min 8 chars
 *   SEED_SUPER_ADMIN_NAME      — optional, defaults to email local-part
 *
 * Or pass positional args when calling directly:
 *   npm run seed:super-admin -- admin@contoh.com "Admin Sakem" "s3cretP4ss"
 *
 * On success the row is (re-)upserted into `users` with role=super_admin and
 * `password_hash` set from bcrypt. The admin can then sign in via the
 * "Masuk sebagai admin" form on /login using their email + password.
 */
import { Client } from "pg";
import bcrypt from "bcryptjs";

const args = process.argv.slice(2);
const email = String(args[0] || process.env.SEED_SUPER_ADMIN_EMAIL || "")
  .toLowerCase()
  .trim();
const name = String(args[1] || process.env.SEED_SUPER_ADMIN_NAME || "").trim();
const password = String(args[2] || process.env.SEED_SUPER_ADMIN_PASSWORD || "");

if (!email) {
  console.error("Missing email. Set SEED_SUPER_ADMIN_EMAIL or pass as first arg.");
  process.exit(1);
}
if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
  console.error(`Invalid email: ${email}`);
  process.exit(1);
}
if (!password || password.length < 8) {
  console.error(
    "Missing or too-short password. Set SEED_SUPER_ADMIN_PASSWORD (min 8 chars) or pass as third arg.",
  );
  process.exit(1);
}
if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set. Did you `cp .env.example .env.local`?");
  process.exit(1);
}

const displayName = name || email.split("@")[0];
const passwordHash = await bcrypt.hash(password, 10);

const client = new Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

try {
  const { rows } = await client.query(
    `INSERT INTO users (email, name, role, password_hash)
       VALUES ($1, $2, 'super_admin', $3)
     ON CONFLICT (email) DO UPDATE
       SET name          = EXCLUDED.name,
           role          = 'super_admin',
           password_hash = EXCLUDED.password_hash,
           updated_at    = now()
     RETURNING id, email, name, role, created_at`,
    [email, displayName, passwordHash],
  );
  console.log("Super-admin ready:");
  console.log({ ...rows[0], password_hash: "(bcrypt, redacted)" });
  console.log(
    "\nSign in at /login → 'Masuk sebagai admin' with this email + your password.",
  );
} finally {
  await client.end();
}
