#!/usr/bin/env node
/**
 * Seed (or upsert) an admin_users row so /admin sign-in can succeed.
 *
 * Usage:
 *   npm run seed:admin -- admin@sakolakembara.org
 *   npm run seed:admin -- admin@sakolakembara.org "Admin Sakem" super_admin
 *
 * Defaults: displayName from email local-part, role = super_admin.
 */
import { Client } from "pg";

const VALID_ROLES = new Set(["super_admin", "editor", "viewer"]);
const ALLOWED_DOMAIN = "sakolakembara.org";

const args = process.argv.slice(2);
const email = (args[0] || process.env.SEED_ADMIN_EMAIL || "").toLowerCase().trim();
const displayName = args[1] || email.split("@")[0];
const role = (args[2] || "super_admin").toLowerCase();

if (!email) {
  console.error("Usage: npm run seed:admin -- <email> [displayName] [role]");
  process.exit(1);
}
if (!email.endsWith(`@${ALLOWED_DOMAIN}`)) {
  console.error(`Email must end with @${ALLOWED_DOMAIN}`);
  process.exit(1);
}
if (!VALID_ROLES.has(role)) {
  console.error(`Role must be one of: ${[...VALID_ROLES].join(", ")}`);
  process.exit(1);
}
if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set. Did you `cp .env.example .env.local`?");
  process.exit(1);
}

const client = new Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

try {
  const { rows } = await client.query(
    `INSERT INTO admin_users (email, display_name, role)
       VALUES ($1, $2, $3)
     ON CONFLICT (email) DO UPDATE
       SET display_name = EXCLUDED.display_name,
           role         = EXCLUDED.role,
           updated_at   = now()
     RETURNING id, email, display_name, role, created_at`,
    [email, displayName, role],
  );
  console.log("Seeded admin:");
  console.log(rows[0]);
} finally {
  await client.end();
}
