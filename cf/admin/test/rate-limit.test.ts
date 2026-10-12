import { env } from "cloudflare:workers";
import { describe, expect, test, vi } from "vitest";
import wranglerConfig from "../wrangler.jsonc?raw";
import { checkLimits, limitedResponse, RATE_LIMITS, resetMemoryLimits, type LimitEnv } from "../src/security/rate-limit";
import { clientIp, emailKey } from "../src/security/client";
import { awaitFreshWindow, call, CAPTCHA, createVerifiedUser, emails, emailsTo, fakeNetwork, freshIp, PASSWORD, productionLike, register, signIn, uniqueEmail } from "./helpers";

// The limits are Cloudflare rate limit bindings (wrangler.jsonc), the real
// Miniflare implementation, so the numbers below are the production ones:
//
//   login 5/min per IP+email, loginAccount 20/min per email, register 10/min per IP,
//   reset 5/min per IP, verifyResend 2/min per email, mailTarget 3/min per email,
//   token 20/min per IP, contact 5/min per IP.

const legacy = {
  login: "Terlalu banyak percobaan masuk. Silakan tunggu beberapa menit lalu coba lagi.",
  register: "Terlalu banyak percobaan pendaftaran. Silakan tunggu beberapa menit lalu coba lagi.",
  token: "Terlalu banyak percobaan. Coba lagi dalam beberapa menit.",
  contact: "Terlalu banyak percobaan pengiriman. Silakan tunggu satu menit lalu coba lagi.",
};

describe("the table and wrangler.jsonc say the same thing", () => {
  test("every binding is declared with the limit and period the code assumes, with a distinct namespace id", () => {
    // wrangler.jsonc is JSONC: drop the comments, then read the ratelimits array.
    const json = wranglerConfig.replace(/^\s*\/\/.*$/gm, "").replace(/,(\s*[}\]])/g, "$1");
    const declared = (JSON.parse(json) as { ratelimits: { name: string; namespace_id: string; simple: { limit: number; period: number } }[] }).ratelimits;

    expect(declared.map((entry) => entry.name).sort()).toEqual(Object.values(RATE_LIMITS).map((config) => config.binding).sort());
    for (const config of Object.values(RATE_LIMITS)) {
      const entry = declared.find((candidate) => candidate.name === config.binding)!;
      expect(entry.simple, config.binding).toEqual({ limit: config.limit, period: config.period });
    }
    expect(new Set(declared.map((entry) => entry.namespace_id)).size).toBe(declared.length);
    // Cloudflare accepts only these periods.
    for (const config of Object.values(RATE_LIMITS)) expect([10, 60]).toContain(config.period);
  });

  test("the cron trigger is registered", () => {
    expect(wranglerConfig).toMatch(/"triggers":\s*\{\s*"crons":\s*\["17 3 \* \* \*"\]\s*\}/);
  });
});

describe("login", () => {
  // Negative check: remove `app.use(`${AUTH_BASE_PATH}/*`, authGate);` in src/worker.ts.
  test("the sixth attempt in a minute from one client on one account is refused, with Retry-After and the legacy message", async () => {
    const email = uniqueEmail();
    const ip = freshIp();
    await createVerifiedUser(email);

    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) statuses.push((await signIn(email, "wrong password", ip)).status);
    expect(statuses).toEqual([401, 401, 401, 401, 401, 429]);

    // Even the right password is refused while the window is full.
    const blocked = await signIn(email, PASSWORD, ip);
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("retry-after")).toBe("60");
    expect(blocked.headers.get("cache-control")).toBe("no-store");
    expect(await blocked.json()).toEqual({ error: "rate_limited", message: legacy.login, retryAfterSeconds: 60 });
  });

  test("another client is not affected by that client's failures", async () => {
    const email = uniqueEmail();
    const ip = freshIp();
    await createVerifiedUser(email);
    for (let i = 0; i < 6; i++) await signIn(email, "wrong password", ip);

    expect((await signIn(email, PASSWORD, freshIp())).status).toBe(200);
  });

  test("a classroom behind one address can all sign in", async () => {
    const ip = freshIp();
    const emails = Array.from({ length: 12 }, () => uniqueEmail("student"));
    for (const email of emails) await createVerifiedUser(email);

    const statuses = await Promise.all(emails.map((email) => signIn(email, PASSWORD, ip).then((r) => r.status)));
    expect(statuses.every((status) => status === 200)).toBe(true);
  });

  test("one account attacked from many addresses is throttled after 20 tries a minute", async () => {
    const email = uniqueEmail();
    const statuses: number[] = [];
    for (let i = 0; i < 22; i++) statuses.push((await signIn(email, "guess", freshIp())).status);
    expect(statuses.slice(0, 20).every((status) => status === 401)).toBe(true);
    expect(statuses.slice(20)).toEqual([429, 429]);
  });

  test("the email is matched case-insensitively and trimmed, so changing the spelling does not get a fresh allowance", async () => {
    const email = uniqueEmail("Mixed");
    const ip = freshIp();
    await createVerifiedUser(email.toLowerCase());
    const spellings = [email, email.toUpperCase(), ` ${email} `, email.toLowerCase(), email, email.toUpperCase()];
    const statuses: number[] = [];
    for (const spelling of spellings) statuses.push((await signIn(spelling.trim().length === spelling.length ? spelling : spelling.trim(), "wrong", ip)).status);
    expect(statuses.at(-1)).toBe(429);
  });

  test("a request without an email still counts against the address", async () => {
    const ip = freshIp();
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) statuses.push((await call("/api/auth/sign-in/email", { method: "POST", json: { password: "x" }, ip })).status);
    expect(statuses.at(-1)).toBe(429);
  });
});

describe("the visitor's address is CF-Connecting-IP and nothing else (legacy bug SAKEM-008)", () => {
  test("X-Forwarded-For does not choose the bucket: rotating it gains nothing", async () => {
    const email = uniqueEmail();
    const ip = freshIp();
    await createVerifiedUser(email);
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) {
      const res = await call("/api/auth/sign-in/email", { method: "POST", json: { email, password: "wrong" }, ip, headers: { "x-forwarded-for": `198.51.100.${i + 1}`, "x-real-ip": `198.51.100.${i + 1}` } });
      statuses.push(res.status);
    }
    expect(statuses.at(-1)).toBe(429);
  });

  test("and sharing an X-Forwarded-For does not put two clients in one bucket", async () => {
    const email = uniqueEmail();
    await createVerifiedUser(email);
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) {
      const res = await call("/api/auth/sign-in/email", { method: "POST", json: { email, password: "wrong" }, ip: freshIp(), headers: { "x-forwarded-for": "198.51.100.1" } });
      statuses.push(res.status);
    }
    expect(statuses).toEqual([401, 401, 401, 401, 401, 401]);
  });

  test("a request without the header (local, no edge) shares one 'unknown' bucket: over-throttled, never under", async () => {
    const email = uniqueEmail();
    await createVerifiedUser(email);
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) statuses.push((await call("/api/auth/sign-in/email", { method: "POST", json: { email, password: "wrong" }, ip: null })).status);
    expect(statuses.at(-1)).toBe(429);
  });

  test("clientIp: only a well-formed address from that one header", () => {
    const of = (value: string | null, extra: Record<string, string> = {}) => clientIp(new Headers({ ...(value === null ? {} : { "cf-connecting-ip": value }), ...extra }));
    expect(of("203.0.113.7")).toBe("203.0.113.7");
    expect(of("2001:DB8::1")).toBe("2001:db8::1");
    expect(of(null, { "x-forwarded-for": "6.6.6.6", "x-real-ip": "6.6.6.6" })).toBe("unknown");
    for (const bad of ["", "not an ip", "1.2.3", "1.2.3.4.5", "999999999999999999999999999999999999999999999999", "<script>", "1.2.3.4, 5.6.7.8"]) expect(of(bad), bad).toBe("unknown");
  });
});

describe("registration, reset, resend and the mailbox", () => {
  test("one address cannot register more than 10 times a minute, with the legacy message", async () => {
    const ip = freshIp();
    const statuses: number[] = [];
    let last: Response | undefined;
    for (let i = 0; i < 12; i++) {
      last = await register(uniqueEmail("flood"), { ip });
      statuses.push(last.status);
    }
    expect(statuses.slice(0, 10).every((status) => status === 200)).toBe(true);
    expect(statuses.slice(10)).toEqual([429, 429]);
    expect(await last!.json()).toMatchObject({ error: "rate_limited", message: legacy.register });
  });

  test("forgot password: 5 a minute per address", async () => {
    const ip = freshIp();
    const statuses: number[] = [];
    let last: Response | undefined;
    for (let i = 0; i < 7; i++) {
      last = await call("/api/auth/request-password-reset", { method: "POST", json: { email: uniqueEmail("any"), redirectTo: "/reset-password" }, ip });
      statuses.push(last.status);
    }
    expect(statuses).toEqual([200, 200, 200, 200, 200, 429, 429]);
    expect(await last!.json()).toMatchObject({ error: "rate_limited", message: "Terlalu banyak permintaan. Silakan tunggu satu menit lalu coba lagi." });
  });

  test("resending the verification link: 2 a minute per email, from any address", async () => {
    await awaitFreshWindow();
    const email = uniqueEmail();
    await register(email); // counts as one mail to this mailbox
    const statuses: number[] = [];
    for (let i = 0; i < 4; i++) statuses.push((await call("/api/auth/send-verification-email", { method: "POST", json: { email }, ip: freshIp() })).status);
    expect(statuses).toEqual([200, 200, 429, 429]);
  });

  // Negative check: remove the mailTarget checks from the table in src/auth/gate.ts.
  test("one mailbox gets at most 3 emails a minute across register, reset and resend, whoever asks", async () => {
    const email = uniqueEmail();
    const statuses: number[] = [];
    statuses.push((await register(email, { ip: freshIp() })).status);
    statuses.push((await call("/api/auth/request-password-reset", { method: "POST", json: { email, redirectTo: "/reset-password" }, ip: freshIp() })).status);
    statuses.push((await register(email, { ip: freshIp() })).status);
    const fourth = await call("/api/auth/request-password-reset", { method: "POST", json: { email, redirectTo: "/reset-password" }, ip: freshIp() });
    statuses.push(fourth.status);
    expect(statuses).toEqual([200, 200, 200, 429]);
    expect(await fourth.json()).toMatchObject({ error: "rate_limited", message: expect.stringContaining("Terlalu banyak email dikirim ke alamat ini") });
    expect(emailsTo(email).length).toBeLessThanOrEqual(3);
  });

  test("the limit keys on the address, so it does not tell anyone whether an account exists", async () => {
    const known = uniqueEmail();
    // Straight into the table, so no email was counted for it yet; the ghost has none either.
    await env.DB.prepare("INSERT INTO users (id, name, email, email_verified) VALUES (?, 'Known', ?, 1)").bind(crypto.randomUUID(), known).run();
    const ghost = uniqueEmail("ghost");
    const run = async (email: string) => {
      const statuses: number[] = [];
      for (let i = 0; i < 5; i++) statuses.push((await call("/api/auth/request-password-reset", { method: "POST", json: { email, redirectTo: "/reset-password" }, ip: freshIp() })).status);
      return statuses;
    };
    expect(await run(known)).toEqual(await run(ghost));
  });

  test("redeeming a token: 20 a minute per address", async () => {
    const ip = freshIp();
    const statuses: number[] = [];
    for (let i = 0; i < 22; i++) statuses.push((await call("/api/auth/reset-password", { method: "POST", json: { token: `nope-${i}`, newPassword: "long enough password" }, ip })).status);
    expect(statuses.slice(0, 20).every((status) => status === 400)).toBe(true);
    expect(statuses.slice(20)).toEqual([429, 429]);
    const verify = await call("/api/auth/verify-email?token=x", { ip });
    expect(verify.status).toBe(429);
    expect(await verify.json()).toMatchObject({ message: legacy.token });
  });

  test("only the listed routes are throttled: reading the session is free", async () => {
    const ip = freshIp();
    for (let i = 0; i < 25; i++) expect((await call("/api/auth/get-session", { ip })).status).toBe(200);
  });

  test("a throttled request sends no email and creates nothing", async () => {
    const ip = freshIp();
    for (let i = 0; i < 10; i++) await register(uniqueEmail("ok"), { ip });
    emails().length = 0;
    const email = uniqueEmail("blocked");
    expect((await register(email, { ip })).status).toBe(429);
    expect(emails()).toHaveLength(0);
  });
});

describe("checkLimits and the in-memory fallback (local dev and tests only)", () => {
  const noBindings: LimitEnv = { ENVIRONMENT: "test" };

  test("without a binding, outside production, the same limit applies in memory", async () => {
    const statuses: boolean[] = [];
    for (let i = 0; i < 7; i++) statuses.push((await checkLimits(noBindings, [{ name: "login", key: "k" }])).allowed);
    expect(statuses).toEqual([true, true, true, true, true, false, false]);
    expect(await checkLimits(noBindings, [{ name: "login", key: "another key" }])).toEqual({ allowed: true });
  });

  test("the fallback window rolls over after the period", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      for (let i = 0; i < 6; i++) await checkLimits(noBindings, [{ name: "contact", key: "k" }]);
      expect((await checkLimits(noBindings, [{ name: "contact", key: "k" }])).allowed).toBe(false);
      vi.setSystemTime(Date.now() + 61_000);
      expect((await checkLimits(noBindings, [{ name: "contact", key: "k" }])).allowed).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  test("buckets do not share keys: the same key under two bindings is two counters", async () => {
    for (let i = 0; i < 5; i++) await checkLimits(noBindings, [{ name: "login", key: "same" }]);
    expect((await checkLimits(noBindings, [{ name: "login", key: "same" }])).allowed).toBe(false);
    expect((await checkLimits(noBindings, [{ name: "loginAccount", key: "same" }])).allowed).toBe(true);
  });

  test("when a check is refused, the others are still counted", async () => {
    for (let i = 0; i < 5; i++) await checkLimits(noBindings, [{ name: "login", key: "a" }]);
    const result = await checkLimits(noBindings, [
      { name: "login", key: "a" },
      { name: "loginAccount", key: "acct" },
    ]);
    expect(result).toEqual({ allowed: false, reason: "limited", name: "login" });
    // loginAccount was counted once by that call; 19 more are allowed, the 20th call after that is not.
    const rest: boolean[] = [];
    for (let i = 0; i < 20; i++) rest.push((await checkLimits(noBindings, [{ name: "loginAccount", key: "acct" }])).allowed);
    expect(rest.filter(Boolean)).toHaveLength(19);
  });

  test("production without the binding fails closed: 503, logged, never 'allowed'", async () => {
    const lines: string[] = [];
    vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => void lines.push(args.join(" ")));
    const result = await checkLimits({ ENVIRONMENT: "production" }, [{ name: "login", key: "k" }]);
    expect(result).toEqual({ allowed: false, reason: "unavailable", name: "login" });
    expect(lines).toEqual(["[rate-limit] binding RL_LOGIN is not configured; refusing the request"]);
    vi.restoreAllMocks();

    const res = limitedResponse(result as Exclude<typeof result, { allowed: true }>);
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "service_unavailable" });
    // A missing ENVIRONMENT is production.
    expect(await checkLimits({}, [{ name: "login", key: "k" }])).toMatchObject({ allowed: false, reason: "unavailable" });
  });

  test("through the worker: a production deploy that lost a binding refuses the route and does nothing", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    fakeNetwork();
    const email = uniqueEmail();
    const res = await register(email, { env: { ...productionLike, RL_REGISTER: undefined, RL_MAIL_TARGET: undefined }, captcha: CAPTCHA });
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "service_unavailable" });
    expect(emails()).toHaveLength(0);
  });

  test("through the worker: a local run without the binding still throttles, in memory", async () => {
    const email = uniqueEmail();
    const ip = freshIp();
    await createVerifiedUser(email);
    resetMemoryLimits();
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) {
      statuses.push((await call("/api/auth/sign-in/email", { method: "POST", json: { email, password: "wrong" }, ip, env: { RL_LOGIN: undefined, RL_LOGIN_ACCOUNT: undefined } })).status);
    }
    expect(statuses).toEqual([401, 401, 401, 401, 401, 429]);
  });

  test("429 uses the legacy copy per concern and the period as Retry-After", async () => {
    for (const [name, config] of Object.entries(RATE_LIMITS)) {
      const res = limitedResponse({ allowed: false, reason: "limited", name: name as keyof typeof RATE_LIMITS });
      expect(res.status).toBe(429);
      expect(res.headers.get("retry-after")).toBe(String(config.period));
      expect(await res.json()).toEqual({ error: "rate_limited", message: config.message, retryAfterSeconds: config.period });
    }
    expect(RATE_LIMITS.contact.message).toBe(legacy.contact);
    expect(RATE_LIMITS.register.message).toBe(legacy.register);
  });
});

describe("emailKey", () => {
  test("is a stable 32-character hash of the normalised address, and never the address", async () => {
    const a = await emailKey("Sari@Example.test ");
    expect(a).toMatch(/^[0-9a-f]{32}$/);
    expect(a).toBe(await emailKey("sari@example.test"));
    expect(a).not.toBe(await emailKey("sari2@example.test"));
    expect(a).not.toContain("sari");
  });
});
