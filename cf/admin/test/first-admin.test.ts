import { env } from "cloudflare:workers";
import { describe, expect, test } from "vitest";
import { firstAdminSql, firstAdminStatements, inspectSql, literal, makeFirstAdmin, NAME_MAX, parseEmail, parseName, passwordProblem, PASSWORD_MAX, PASSWORD_MIN } from "../scripts/first-admin-sql";
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from "../src/auth/factory";
import { PBKDF2_ITERATIONS, verifyPassword } from "../src/auth/password";
import { call, cookiesOf, insertSuperAdmin, signIn, uniqueEmail } from "./helpers";

// The SQL of scripts/create-first-admin.ts (docs/cloudflare/first-super-admin.md), run against the test database
// and then used the way the owner will: sign in through the Worker. The command itself (the questions, wrangler,
// the temporary file) is checked end to end by `pnpm check:first-admin`, which needs a real local D1 and a dev server.

const PASSWORD = "a long passphrase for the first admin";

/** What `wrangler d1 execute --file` does with the file: each statement in turn, stopping at the first that fails. */
async function run(statements: readonly string[]) {
  for (const statement of statements) await env.DB.prepare(statement).run();
}

async function first(options: { email?: string; name?: string; password?: string } = {}) {
  return makeFirstAdmin({ email: options.email ?? uniqueEmail("owner"), name: options.name ?? "Pemilik", password: options.password ?? PASSWORD });
}

const n = async (table: string) => (await env.DB.prepare(`SELECT count(*) AS n FROM ${table}`).first<{ n: number }>())!.n;

describe("the SQL on an empty database", () => {
  test("creates a super_admin who signs in with the password and opens Pengaturan, and is the one who counts", async () => {
    const { input, sql } = await first();
    await run(firstAdminStatements(input));

    const signedIn = await signIn(input.email, PASSWORD);
    expect(signedIn.status).toBe(200);
    const cookie = cookiesOf(signedIn);
    expect(await (await call("/api/me", { cookie })).json()).toMatchObject({ user: { email: input.email, role: "super_admin" } });

    const list = (await (await call("/api/admin/users", { cookie })).json()) as { items: { email: string; role: string; status: string; emailVerified: boolean }[] };
    expect(list.items).toEqual([expect.objectContaining({ email: input.email, role: "super_admin", status: "active", emailVerified: true })]);
    expect(await n("signable_super_admins")).toBe(1);
    expect(sql).toContain("INSERT INTO users");
  });

  test("the password hash is the Worker's own: it verifies with the Worker's function, in its stored format", async () => {
    const { input } = await first();
    expect(input.passwordHash.startsWith(`pbkdf2-sha256$${PBKDF2_ITERATIONS}$`)).toBe(true);
    expect(await verifyPassword({ hash: input.passwordHash, password: PASSWORD })).toBe(true);
    expect(await verifyPassword({ hash: input.passwordHash, password: `${PASSWORD}!` })).toBe(false);
    // Two runs, two salts: the same password does not make the same string.
    expect((await first()).input.passwordHash).not.toBe(input.passwordHash);
  });

  test("the password is nowhere in the SQL, and a wrong one does not sign in", async () => {
    const { input, sql } = await first();
    expect(sql).not.toContain(PASSWORD);
    await run(firstAdminStatements(input));
    expect((await signIn(input.email, "not the password at all")).status).toBe(401);
  });

  test("writes one audit row, with the person as the actor, that Aktivitas can show", async () => {
    const { input } = await first();
    await run(firstAdminStatements(input));
    const rows = (await env.DB.prepare("SELECT actor_id, actor_email, action, resource_type, resource_id, metadata FROM audit_log").all()).results;
    expect(rows).toEqual([
      {
        actor_id: input.userId,
        actor_email: input.email,
        action: "admin.create",
        resource_type: "admin_user",
        resource_id: input.userId,
        metadata: JSON.stringify({ email: input.email, role: "super_admin", mode: "password" }),
      },
    ]);
    const cookie = cookiesOf(await signIn(input.email, PASSWORD));
    const audit = (await (await call("/api/admin/audit", { cookie })).json()) as { items: { action: string; actorEmail: string; details?: Record<string, unknown> }[] };
    expect(audit.items[0]).toMatchObject({ action: "admin.create", actorEmail: input.email });
  });

  test("an address with a quote, and a name that tries SQL, are stored as the text they are", async () => {
    const { input } = await first({ email: "o'brien@example.test", name: "x'); DROP TABLE users; --" });
    await run(firstAdminStatements(input));
    expect(await env.DB.prepare("SELECT email, name FROM users").first()).toEqual({ email: "o'brien@example.test", name: "x'); DROP TABLE users; --" });
    expect((await signIn("o'brien@example.test", PASSWORD)).status).toBe(200);
  });
});

describe("the SQL does nothing when it should not", () => {
  // Negative check: the NOT EXISTS of the first statement is removed.
  test("a super_admin who can sign in already exists: nothing is written, however often it runs", async () => {
    const existing = await insertSuperAdmin();
    const { input } = await first();
    await run(firstAdminStatements(input));
    await run(firstAdminStatements(input));
    expect(await n("users")).toBe(1);
    expect(await n("account")).toBe(1); // the existing one's own
    expect(await n("audit_log")).toBe(0);
    expect(await env.DB.prepare("SELECT id FROM users").first<{ id: string }>()).toEqual({ id: existing });
  });

  test("running the file twice creates one admin: the second run finds one who can sign in", async () => {
    const { input } = await first();
    await run(firstAdminStatements(input));
    await run(firstAdminStatements({ ...input, userId: crypto.randomUUID(), accountId: crypto.randomUUID(), auditId: crypto.randomUUID(), email: uniqueEmail("second") }));
    expect(await n("users")).toBe(1);
    expect(await n("account")).toBe(1);
    expect(await n("audit_log")).toBe(1);
  });

  test("a super_admin who cannot sign in does not stop it (an invitation nobody could open is how Pengaturan got out of reach)", async () => {
    await insertSuperAdmin({ verified: false, account: false });
    const { input } = await first();
    await run(firstAdminStatements(input));
    expect(await n("users")).toBe(2);
    expect(await n("signable_super_admins")).toBe(1);
    expect((await signIn(input.email, PASSWORD)).status).toBe(200);
  });

  test("an address that already has an account (a student's, say) fails at the first statement and leaves nothing behind", async () => {
    const email = uniqueEmail("student");
    await env.DB.prepare("INSERT INTO users (id, name, email, email_verified, role) VALUES (?, 'Siswa', ?, 1, 'student')").bind(crypto.randomUUID(), email).run();
    const { input } = await first({ email });
    await expect(run(firstAdminStatements(input))).rejects.toThrow(/UNIQUE constraint failed: users.email/);
    expect(await n("users")).toBe(1);
    expect(await n("account")).toBe(0);
    expect(await n("audit_log")).toBe(0);
  });

  test("the account and the audit row follow the user row only: without it they are not written", async () => {
    const { input } = await first();
    const [, account, audit] = firstAdminStatements(input);
    await run([account, audit]); // the user statement did not run (a super_admin existed, say)
    expect(await n("account")).toBe(0);
    expect(await n("audit_log")).toBe(0);
  });
});

describe("what the command checks before it writes", () => {
  test("the inspection counts the super_admins who can sign in and the rows with the address", async () => {
    const email = uniqueEmail("probe");
    expect(await env.DB.prepare(inspectSql(email)).first()).toEqual({ signable: 0, same_email: 0 });
    await insertSuperAdmin({ email });
    await insertSuperAdmin({ verified: false });
    expect(await env.DB.prepare(inspectSql(email)).first()).toEqual({ signable: 1, same_email: 1 });
  });

  test("the address is trimmed and lower-cased like Pengaturan does it; what is not an address is refused, a newline included", () => {
    expect(parseEmail("  Owner@Example.TEST ")).toBe("owner@example.test");
    for (const bad of ["", "owner", "owner@", "@example.test", "a@b", "owner@example.test\nINSERT", "x".repeat(200) + "@example.test"]) expect(parseEmail(bad), bad).toBeNull();
  });

  test("the name defaults to the part before the @, and is bounded", () => {
    expect(parseName("", "owner@example.test")).toBe("owner");
    expect(parseName("  Bu Guru ", "owner@example.test")).toBe("Bu Guru");
    expect(parseName("x".repeat(NAME_MAX), "o@e.test")).not.toBeNull();
    expect(parseName("x".repeat(NAME_MAX + 1), "o@e.test")).toBeNull();
    expect(parseName("two\nlines", "o@e.test")).toBeNull();
  });

  test("the password bounds are the Worker's (a password the command accepts is one the Worker accepts)", () => {
    expect(PASSWORD_MIN).toBe(PASSWORD_MIN_LENGTH);
    expect(PASSWORD_MAX).toBe(PASSWORD_MAX_LENGTH);
    expect(passwordProblem("x".repeat(PASSWORD_MIN - 1))).not.toBeNull();
    expect(passwordProblem("x".repeat(PASSWORD_MIN))).toBeNull();
    expect(passwordProblem("x".repeat(PASSWORD_MAX))).toBeNull();
    expect(passwordProblem("x".repeat(PASSWORD_MAX + 1))).not.toBeNull();
  });

  test("a literal doubles its quotes and refuses a control character, so nothing can end the string or the statement early", () => {
    expect(literal("a'b")).toBe("'a''b'");
    expect(() => literal("a\nb")).toThrow();
    expect(() => literal("a\u0000b")).toThrow();
  });

  test("the file is the statements under a comment, ending in a newline", async () => {
    const { input } = await first();
    const sql = firstAdminSql(input);
    expect(sql.startsWith("-- ")).toBe(true);
    expect(sql.endsWith(";\n")).toBe(true);
    for (const statement of firstAdminStatements(input)) expect(sql).toContain(statement);
  });
});
