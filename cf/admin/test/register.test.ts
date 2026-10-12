import { env } from "cloudflare:workers";
import { describe, expect, test } from "vitest";
import { call, cookiesOf, createVerifiedUser, emails, emailsTo, linkIn, ORIGIN, PASSWORD, register, signIn, uniqueEmail } from "./helpers";

// POST /api/auth/register: the student registration endpoint (src/auth/register.ts).
// Turnstile, the rate limits and the "email provider is configured" check are
// the gate's, and are tested in test/gate.test.ts and test/rate-limit.test.ts.

async function userCount(email?: string): Promise<number> {
  const row = email
    ? await env.DB.prepare("SELECT count(*) AS n FROM users WHERE email = ?").bind(email.trim().toLowerCase()).first<{ n: number }>()
    : await env.DB.prepare("SELECT count(*) AS n FROM users").first<{ n: number }>();
  return row!.n;
}

describe("a new student registers", () => {
  test("200 { ok, message } and nothing else: no user object, no id, no session", async () => {
    const email = uniqueEmail();
    const res = await register(email);

    expect(res.status).toBe(200);
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({ ok: true, message: expect.stringContaining("Cek email kamu") });
    expect(text).not.toContain(email);
    expect(res.headers.getSetCookie()).toEqual([]);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  test("the account is a student, unverified, and a verification email goes out", async () => {
    const email = uniqueEmail();
    await register(email, { name: "  Sari Dewi  " });

    const user = await env.DB.prepare("SELECT name, role, email_verified AS verified, deactivated_at AS deactivated FROM users WHERE email = ?")
      .bind(email)
      .first<{ name: string; role: string; verified: number; deactivated: number | null }>();
    expect(user).toEqual({ name: "Sari Dewi", role: "student", verified: 0, deactivated: null });
    const sent = emailsTo(email);
    expect(sent.map((message) => message.purpose)).toEqual(["verify-email"]);
  });

  test("then: verify, sign in, and /api/me says student", async () => {
    const email = uniqueEmail();
    await register(email);
    expect((await signIn(email)).status).toBe(403);
    expect((await call(linkIn(emailsTo(email)[0]!))).headers.get("location")).toBe("/login?verified=1");

    const res = await signIn(email);
    expect(res.status).toBe(200);
    const me = await call("/api/me", { cookie: cookiesOf(res) });
    expect(await me.json()).toMatchObject({ user: { email, role: "student", emailVerified: true }, areas: { writable: [], visible: [] } });
  });

  // The role is not an input: a client that sends one gets a student, never an admin.
  test("a role sent by the client is ignored: the account is always a student", async () => {
    for (const role of ["super_admin", "editor", "viewer", "admin"]) {
      const email = uniqueEmail();
      const res = await register(email, { extra: { role, areas: ["konten"], emailVerified: true, deactivatedAt: null } });
      expect(res.status).toBe(200);
      const user = await env.DB.prepare("SELECT role, email_verified AS verified FROM users WHERE email = ?").bind(email).first<{ role: string; verified: number }>();
      expect(user).toEqual({ role: "student", verified: 0 });
    }
    expect((await env.DB.prepare("SELECT count(*) AS n FROM admin_area_grants").first<{ n: number }>())!.n).toBe(0);
  });

  test("the address is trimmed and lowercased, so a different spelling is the same account", async () => {
    const email = uniqueEmail("MixedCase");
    await register(`  ${email.toUpperCase()}  `);
    expect(await userCount(email)).toBe(1);
    const again = await register(email);
    expect(again.status).toBe(200);
    expect(await userCount(email)).toBe(1);
  });
});

describe("no account enumeration", () => {
  // Negative check: make the existing-address case answer differently in src/auth/register.ts.
  test("a new address, an address with an account, and an unverified one all get the same status, body and headers", async () => {
    const fresh = uniqueEmail("fresh");
    const verified = uniqueEmail("verified");
    const unverified = uniqueEmail("unverified");
    await createVerifiedUser(verified);
    await register(unverified);

    const answers = [];
    for (const email of [fresh, verified, unverified]) {
      const res = await register(email);
      answers.push({ status: res.status, body: await res.json(), cookies: res.headers.getSetCookie(), type: res.headers.get("content-type") });
    }
    expect(answers[1]).toEqual(answers[0]);
    expect(answers[2]).toEqual(answers[0]);
  });

  test("an existing address gets an 'akun sudah ada' email instead of a second account or a new token", async () => {
    const email = uniqueEmail();
    await createVerifiedUser(email);
    const before = await env.DB.prepare("SELECT id, name, updated_at FROM users WHERE email = ?").bind(email).first<{ id: string; name: string; updated_at: number }>();
    const accountBefore = await env.DB.prepare("SELECT password FROM account WHERE user_id = ?").bind(before!.id).first<{ password: string }>();
    emails().length = 0;

    const res = await register(email, { password: "someone elses password", name: "Intruder" });
    expect(res.status).toBe(200);
    expect(await userCount(email)).toBe(1);
    // Nothing about the account changed: not the name, not the password.
    expect(await env.DB.prepare("SELECT id, name, updated_at FROM users WHERE email = ?").bind(email).first()).toEqual(before);
    expect(await env.DB.prepare("SELECT password FROM account WHERE user_id = ?").bind(before!.id).first()).toEqual(accountBefore);
    expect((await signIn(email, "someone elses password")).status).toBe(401);
    expect((await signIn(email, PASSWORD)).status).toBe(200);

    const sent = emailsTo(email);
    expect(sent.map((message) => message.purpose)).toEqual(["account-exists"]);
    expect(sent[0]).toMatchObject({ subject: "Kamu sudah punya akun Sakola Kembara" });
    // It links to the page the form named (the sign-in page), and carries no token.
    expect(sent[0]!.text).toContain(`${ORIGIN}/login?verified=1`);
    expect(sent[0]!.text).not.toContain("token=");
  });

  test("an unverified account that is registered again keeps the first password and gets the same notice (no takeover by re-registering)", async () => {
    const email = uniqueEmail();
    await register(email, { password: "the first password" });
    emails().length = 0;

    await register(email, { password: "the second password" });
    expect(emailsTo(email).map((message) => message.purpose)).toEqual(["account-exists"]);
    const row = await env.DB.prepare("SELECT a.password FROM account a JOIN users u ON u.id = a.user_id WHERE u.email = ?").bind(email).first<{ password: string }>();
    expect(row?.password).toMatch(/^pbkdf2-sha256\$/);
    // Verify, then only the first password works (the second never replaced it).
    await call("/api/auth/send-verification-email", { method: "POST", json: { email } });
    const link = emailsTo(email).find((message) => message.purpose === "verify-email");
    expect(link).toBeDefined();
    await call(linkIn(link!));
    expect((await signIn(email, "the second password")).status).toBe(401);
    expect((await signIn(email, "the first password")).status).toBe(200);
  });
});

describe("validation: the legacy rules and wording", () => {
  async function invalid(body: Record<string, unknown>) {
    const res = await call("/api/auth/register", { method: "POST", json: { name: "Sari", email: uniqueEmail(), password: PASSWORD, ...body } });
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error: string; message: string; fieldErrors: Record<string, string[]> };
    expect(json.error).toBe("invalid");
    expect(json.message).toBe("Periksa kembali isian formulir.");
    return json.fieldErrors;
  }

  test("name: 2 to 120 characters", async () => {
    expect((await invalid({ name: "S" })).name).toEqual(["Nama minimal 2 karakter"]);
    expect((await invalid({ name: " " })).name).toEqual(["Nama minimal 2 karakter"]);
    expect((await invalid({ name: "x".repeat(121) })).name).toEqual(["Maksimal 120 karakter"]);
    expect((await register(uniqueEmail(), { name: "x".repeat(120) })).status).toBe(200);
  });

  test("email: a real address, at most 254 characters", async () => {
    expect((await invalid({ email: "not an email" })).email).toEqual(["Format email belum benar"]);
    expect((await invalid({ email: "" })).email).toBeDefined();
    expect((await invalid({ email: `${"a".repeat(250)}@example.test` })).email).toBeDefined();
  });

  // The legacy form allowed 200; 128 is Better Auth's bound and the one the SPA states (see PASSWORD_MAX_LENGTH).
  test("password: 8 to 128 characters", async () => {
    expect((await invalid({ password: "1234567" })).password).toEqual(["Password minimal 8 karakter"]);
    expect((await invalid({ password: "x".repeat(129) })).password).toEqual(["Password maksimal 128 karakter"]);
    expect((await register(uniqueEmail(), { password: "12345678" })).status).toBe(200);
    expect((await register(uniqueEmail(), { password: "p".repeat(128) })).status).toBe(200);
  });

  test("confirmPassword, when sent, must match", async () => {
    expect((await invalid({ confirmPassword: "something else" })).confirmPassword).toEqual(["Konfirmasi password tidak cocok"]);
    expect((await register(uniqueEmail(), { extra: { confirmPassword: PASSWORD } })).status).toBe(200);
  });

  test("every field at once, and nothing is created", async () => {
    const fieldErrors = await invalid({ name: "", email: "x", password: "1", confirmPassword: "2" });
    expect(Object.keys(fieldErrors).sort()).toEqual(["confirmPassword", "email", "name", "password"]);
    expect(await userCount()).toBe(0);
    expect(emails()).toHaveLength(0);
  });

  test("a missing or malformed body is a 400, not a crash", async () => {
    expect((await call("/api/auth/register", { method: "POST", json: {} })).status).toBe(400);
    expect((await call("/api/auth/register", { method: "POST", headers: { "content-type": "application/json" }, body: "{not json" })).status).toBe(400);
    expect((await call("/api/auth/register", { method: "POST", json: ["a"] })).status).toBe(400);
    expect(await userCount()).toBe(0);
  });

  test("a callbackURL on another site is refused and nothing is created", async () => {
    const email = uniqueEmail();
    const res = await call("/api/auth/register", { method: "POST", json: { name: "Sari", email, password: PASSWORD, callbackURL: "https://evil.example/phish" } });
    expect(res.status).toBe(403);
    expect(await userCount(email)).toBe(0);
    expect(emails()).toHaveLength(0);
  });
});

describe("honeypot", () => {
  test("a filled 'website' field gets the success answer and creates nothing, sends nothing", async () => {
    const email = uniqueEmail();
    const bot = await register(email, { extra: { website: "https://spam.example" } });
    const human = await register(uniqueEmail());
    expect(bot.status).toBe(200);
    expect(await bot.json()).toEqual(await human.json());
    expect(await userCount(email)).toBe(0);
    expect(emailsTo(email)).toHaveLength(0);
  });

  test("it also hides an otherwise invalid form from a bot", async () => {
    const res = await call("/api/auth/register", { method: "POST", json: { name: "", email: "x", password: "1", website: "spam" } });
    expect(res.status).toBe(200);
  });
});

describe("the Better Auth sign-up is not reachable", () => {
  // Negative check: add { method: "POST", path: "/sign-up/email", ... } to the table in src/auth/gate.ts.
  test("POST /api/auth/sign-up/email is a 404 and creates no account (it would skip Turnstile and the validation)", async () => {
    const email = uniqueEmail();
    const res = await call("/api/auth/sign-up/email", { method: "POST", json: { name: "Bypass", email, password: PASSWORD } });
    expect(res.status).toBe(404);
    expect(await userCount(email)).toBe(0);
  });
});
