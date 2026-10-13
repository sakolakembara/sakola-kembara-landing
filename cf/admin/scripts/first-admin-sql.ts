// The SQL that creates the FIRST super_admin of an empty database (docs/cloudflare/first-super-admin.md), kept apart
// from the command (create-first-admin.ts) so a test can run it against the test database and sign in with the
// result. No I/O here: it computes a password hash and builds text.
//
// The password hash is made by `hashPassword` of src/auth/password.ts, the very function the Worker verifies with,
// not a copy of it: a change of algorithm or iteration count there changes this too.
import { z } from "zod";
import { hashPassword } from "../src/auth/password";

/** Same bounds as the Worker (PASSWORD_MIN_LENGTH and PASSWORD_MAX_LENGTH in src/auth/factory.ts; a test pins them). */
export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 128;
/** Same as `nameField` in src/api/admin-users.ts. */
export const NAME_MAX = 120;

/** What a Pengaturan invitation accepts for an address (src/api/admin-users.ts `emailField`): trimmed, lower case, 5 to 200. */
const emailField = z.string().trim().toLowerCase().pipe(z.email().min(5).max(200));

/** The address as the database will hold it, or null when it is not one. */
export function parseEmail(raw: string): string | null {
  const parsed = emailField.safeParse(raw);
  return parsed.success && !hasControl(parsed.data) ? parsed.data : null;
}

/** The name, or the part of the address before the `@` when none was typed; null when too long or not text. */
export function parseName(raw: string, email: string): string | null {
  const name = raw.trim() || email.split("@")[0]!;
  return name.length <= NAME_MAX && !hasControl(name) ? name : null;
}

/** Why a password is refused, in words, or null when it is fine. */
export function passwordProblem(password: string): string | null {
  if (password.length < PASSWORD_MIN) return `The password needs at least ${PASSWORD_MIN} characters.`;
  if (password.length > PASSWORD_MAX) return `The password can have at most ${PASSWORD_MAX} characters.`;
  return null;
}

// A control character (a newline, a NUL) has no place in an address or a name, and none may reach the SQL file.
const hasControl = (value: string) => /[\u0000-\u001f\u007f]/.test(value);

/** A value as an SQL string literal: quotes doubled, nothing else is special inside them. */
export function literal(value: string): string {
  if (hasControl(value)) throw new Error("a control character cannot go into the SQL");
  return `'${value.replaceAll("'", "''")}'`;
}

export interface FirstAdminInput {
  /** Ids of the three rows; `makeFirstAdmin` draws them. */
  userId: string;
  accountId: string;
  auditId: string;
  email: string;
  name: string;
  /** The stored form, `pbkdf2-sha256$<iterations>$<salt>$<hash>` (src/auth/password.ts). */
  passwordHash: string;
}

/**
 * Three INSERTs that each carry their own condition, so the file does nothing when it should not:
 *
 *   1. the user, only while no super_admin who can sign in exists (the view of migrations 0010 and 0011). Verified,
 *      like every admin who has an account (SAKEM-089): nobody can open an email link on a database that has no
 *      admin yet, and the owner is the one who typed the address.
 *   2. the credential account (the password), only when row 1 was written
 *   3. the audit row `admin.create` (the person is the actor, as for the other flows that run before anyone is
 *      signed in), only when row 1 was written
 *
 * An address that already belongs to someone is not skipped: the unique index on `users.email` makes the first
 * INSERT fail, loudly, and nothing after it runs. The command checks both before it gets here and says it kindly.
 */
export function firstAdminStatements(input: FirstAdminInput): [string, string, string] {
  const { userId, accountId, auditId, email, name, passwordHash } = input;
  const user = literal(userId);
  const created = literal(JSON.stringify({ email, role: "super_admin", mode: "password" }));
  return [
    `INSERT INTO users (id, name, email, email_verified, role)
SELECT ${user}, ${literal(name)}, ${literal(email)}, 1, 'super_admin'
WHERE NOT EXISTS (SELECT 1 FROM signable_super_admins);`,
    `INSERT INTO account (id, account_id, provider_id, user_id, password)
SELECT ${literal(accountId)}, ${user}, 'credential', ${user}, ${literal(passwordHash)}
WHERE EXISTS (SELECT 1 FROM users WHERE id = ${user});`,
    `INSERT INTO audit_log (id, actor_id, actor_email, action, resource_type, resource_id, metadata)
SELECT ${literal(auditId)}, ${user}, ${literal(email)}, 'admin.create', 'admin_user', ${user}, ${created}
WHERE EXISTS (SELECT 1 FROM users WHERE id = ${user});`,
  ];
}

/** The file `wrangler d1 execute --file` runs: the statements with a comment on top. */
export function firstAdminSql(input: FirstAdminInput): string {
  return `-- The first super_admin (scripts/create-first-admin.ts). Safe to run twice: nothing is written once one can sign in.\n${firstAdminStatements(input).join("\n\n")}\n`;
}

/** Hashes the password and draws the ids. The password is not kept anywhere: only its hash goes into the SQL. */
export async function makeFirstAdmin(options: { email: string; name: string; password: string }) {
  const input: FirstAdminInput = {
    userId: crypto.randomUUID(),
    accountId: crypto.randomUUID(),
    auditId: crypto.randomUUID(),
    email: options.email,
    name: options.name,
    passwordHash: await hashPassword(options.password),
  };
  return { input, sql: firstAdminSql(input) };
}

/**
 * One row about the database, for the command's checks before and after: how many super_admins can sign in, and
 * how many rows hold this address (of any role). It fails when the migrations have not been applied (there is no
 * `users` table or no view yet), which the command reports as exactly that.
 */
export function inspectSql(email: string): string {
  return `SELECT (SELECT count(*) FROM signable_super_admins) AS signable, (SELECT count(*) FROM users WHERE email = ${literal(email)}) AS same_email`;
}
