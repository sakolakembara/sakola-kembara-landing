import { env } from "cloudflare:workers";
import { afterEach, describe, expect, test, vi } from "vitest";
import {
  EMAIL_CONFIRMATION_CEILING,
  EMAIL_DAILY_ALLOWANCE,
  EMAIL_QUOTA_MESSAGE,
  emailDay,
  emailQuotaSpent,
  emailsSentToday,
  mailbox,
  sendEmail,
  takeEmailSlot,
  type EmailMessage,
  type EmailPurpose,
} from "../src/email/send";
import { TURNSTILE_TEST_SECRETS } from "../src/security/turnstile";
import { call, CAPTCHA, createVerifiedUser, fakeNetwork, uniqueEmail } from "./helpers";
import { limiterClock } from "./limiter-clock";
import { portalCall, portalRegister, portalSignedIn, portalSignIn } from "./portal-helpers";
import { addRequiredFiles, applicationOf, captureConsole, countRows, draftOf, openBatch, saveAll, student, submit, VALID } from "./portal-applications-helpers";

// The email budget (docs/cloudflare/portal-architecture.md, 9.2, open decision 7): Resend's free plan sends 100 a day.
// Every email is counted in `email_daily` before it goes out; the confirmation of an application stops at 80, which
// keeps the last 20 for the emails a person is waiting for; at 100 the portal's registration, resend and
// forgot-password routes answer `503 email_quota` before they create anything. The counter's table is migration 0013.

afterEach(() => {
  vi.restoreAllMocks();
});

const TEST_ENV = { ENVIRONMENT: "test", DB: env.DB };

function message(purpose: EmailPurpose, to = "tujuan@example.test"): EmailMessage {
  return { to, subject: "Subjek", html: "<p>isi</p>", text: "isi", purpose };
}

const today = () => emailDay();

async function setCount(sent: number, day = today()) {
  await env.DB.prepare("INSERT INTO email_daily (day, sent) VALUES (?1, ?2) ON CONFLICT (day) DO UPDATE SET sent = ?2").bind(day, sent).run();
}

async function count(day = today()): Promise<number> {
  return (await env.DB.prepare("SELECT sent FROM email_daily WHERE day = ?").bind(day).first<{ sent: number }>())?.sent ?? 0;
}

describe("the counter", () => {
  test("the day is the UTC date as YYYY-MM-DD, and a new UTC day starts again at one", async () => {
    expect(emailDay(Date.UTC(2030, 0, 1, 23, 59, 59, 999))).toBe("2030-01-01");
    expect(emailDay(Date.UTC(2030, 0, 2, 0, 0, 0, 0))).toBe("2030-01-02");
    expect(emailDay(Date.UTC(2030, 11, 31, 23, 0))).toBe("2030-12-31");
    expect(await takeEmailSlot(env.DB, 100, Date.UTC(2030, 0, 1, 23, 59, 59, 999))).toBe(1);
    expect(await takeEmailSlot(env.DB, 100, Date.UTC(2030, 0, 1, 23, 59, 59, 999))).toBe(2);
    expect(await takeEmailSlot(env.DB, 100, Date.UTC(2030, 0, 2, 0, 0, 0, 0))).toBe(1);
    expect(await count("2030-01-01")).toBe(2);
    expect(await count("2030-01-02")).toBe(1);
  });

  test("one statement takes one: it stops AT the limit and leaves the row as it was", async () => {
    for (let i = 1; i <= 3; i++) expect(await takeEmailSlot(env.DB, 3)).toBe(i);
    expect(await takeEmailSlot(env.DB, 3)).toBeNull();
    expect(await takeEmailSlot(env.DB, 3)).toBeNull();
    expect(await count()).toBe(3);
    // A higher ceiling (the other purpose) still finds room.
    expect(await takeEmailSlot(env.DB, 5)).toBe(4);
  });

  test("120 at once for a limit of 100: exactly 100 are taken, each number once, and the count ends at 100 (the last one cannot be taken twice)", async () => {
    const results = await Promise.all(Array.from({ length: 120 }, () => takeEmailSlot(env.DB, 100)));
    const taken = results.filter((n): n is number => n !== null).sort((a, b) => a - b);
    expect(taken).toEqual(Array.from({ length: 100 }, (_, i) => i + 1));
    expect(results.filter((n) => n === null)).toHaveLength(20);
    expect(await count()).toBe(100);
  });

  test("emailsSentToday and emailQuotaSpent: 99 is not spent, 100 is, another day's count is nothing", async () => {
    expect(await emailsSentToday(env.DB)).toBe(0);
    expect(await emailQuotaSpent(env)).toBe(false);
    await setCount(EMAIL_DAILY_ALLOWANCE - 1);
    expect(await emailQuotaSpent(env)).toBe(false);
    await setCount(EMAIL_DAILY_ALLOWANCE);
    expect(await emailQuotaSpent(env)).toBe(true);
    await env.DB.prepare("DELETE FROM email_daily").run();
    await setCount(500, "2000-01-01");
    expect(await emailQuotaSpent(env)).toBe(false);
  });

  test("the numbers are the ones of the design: 100 a day, the confirmation stops at 80", () => {
    expect(EMAIL_DAILY_ALLOWANCE).toBe(100);
    expect(EMAIL_CONFIRMATION_CEILING).toBe(80);
    expect(EMAIL_QUOTA_MESSAGE).toBe("Pendaftaran akun hari ini sudah penuh. Coba lagi besok, atau masuk dengan Google.");
  });

  test("an unreadable counter is 'not spent' and says so without a number of anybody's", async () => {
    const broken = { DB: { prepare: () => { throw new Error("d1 is down"); } } as unknown as D1Database };
    const { lines, restore } = captureConsole();
    try {
      expect(await emailQuotaSpent(broken)).toBe(false);
      expect(await emailQuotaSpent({})).toBe(false);
    } finally {
      restore();
    }
    expect(lines).toEqual(["[email] the daily counter could not be read"]);
  });
});

describe("sendEmail counts every email before it goes out", () => {
  test("each message is one on the counter, whatever its purpose, and still reaches the mailbox", async () => {
    for (const purpose of ["verify-email", "reset-password", "account-exists", "admin-invite", "application-received"] as const) {
      expect(await sendEmail(TEST_ENV, message(purpose)), purpose).toEqual({ ok: true });
    }
    expect(await count()).toBe(5);
    expect(mailbox.messages).toHaveLength(5);
  });

  test("without a database in the env (a script, a unit test) nothing is counted", async () => {
    expect(await sendEmail({ ENVIRONMENT: "test" }, message("verify-email"))).toEqual({ ok: true });
    expect(await count()).toBe(0);
  });

  test("production without a provider sends nothing and counts nothing", async () => {
    expect(await sendEmail({ ENVIRONMENT: "production", DB: env.DB }, message("verify-email"))).toEqual({ ok: false, reason: "provider_not_configured" });
    expect(await count()).toBe(0);
  });

  test("the confirmation stops at 80: the 80th is sent, the 81st is skipped and the counter stays; the log has numbers and a purpose only", async () => {
    await setCount(EMAIL_CONFIRMATION_CEILING - 1);
    const { lines, restore } = captureConsole();
    try {
      expect(await sendEmail(TEST_ENV, message("application-received", "siswa-rahasia@example.test"))).toEqual({ ok: true });
      expect(await count()).toBe(80);
      expect(await sendEmail(TEST_ENV, message("application-received", "siswa-rahasia@example.test"))).toEqual({ ok: false, reason: "daily_budget" });
      expect(await count()).toBe(80);
    } finally {
      restore();
    }
    expect(mailbox.messages).toHaveLength(1);
    expect(lines).toEqual(["[email] 80 of 100 emails are used today", "[email] 80 of 100 emails are used today; application-received email was not sent"]);
    expect(lines.join("\n")).not.toContain("rahasia");
  });

  test("the last 20 are kept for the emails a person waits for: verification and reset go on from 80 to 100", async () => {
    await setCount(EMAIL_CONFIRMATION_CEILING);
    for (let i = 0; i < 20; i++) {
      expect(await sendEmail(TEST_ENV, message(i % 2 ? "reset-password" : "verify-email")), `#${81 + i}`).toEqual({ ok: true });
    }
    expect(await count()).toBe(100);
    expect(mailbox.messages).toHaveLength(20);
    // The confirmation is still refused, everything else is not counted past 100.
    expect(await sendEmail(TEST_ENV, message("application-received"))).toEqual({ ok: false, reason: "daily_budget" });
  });

  test("past 100 an email somebody waits for is still tried (Resend is the judge), the counter stays at 100 and the log says so", async () => {
    await setCount(EMAIL_DAILY_ALLOWANCE);
    const { lines, restore } = captureConsole();
    try {
      expect(await sendEmail(TEST_ENV, message("verify-email"))).toEqual({ ok: true });
    } finally {
      restore();
    }
    expect(mailbox.messages).toHaveLength(1);
    expect(await count()).toBe(100);
    expect(lines).toEqual(["[email] 100 of 100 emails are used today; verify-email email is sent anyway"]);
  });

  test("with a Resend key: the email is counted BEFORE the request, an optional one over its ceiling never reaches Resend, the others do", async () => {
    const network = fakeNetwork();
    const live = { ...TEST_ENV, RESEND_API_KEY: "re_test_key", EMAIL_FROM: "Sakola <no-reply@example.test>" };
    expect(await sendEmail(live, message("verify-email"))).toEqual({ ok: true });
    expect(network.resend).toHaveLength(1);
    expect(await count()).toBe(1);

    await setCount(EMAIL_CONFIRMATION_CEILING);
    expect(await sendEmail(live, message("application-received"))).toEqual({ ok: false, reason: "daily_budget" });
    expect(network.resend).toHaveLength(1);
    expect(await sendEmail(live, message("reset-password"))).toEqual({ ok: true });
    expect(network.resend).toHaveLength(2);
    expect(await count()).toBe(81);

    // A provider that fails was counted all the same (the counter is a brake, and a failed send may still have spent the allowance).
    network.resendStatus = 500;
    expect(await sendEmail(live, message("verify-email"))).toMatchObject({ ok: false, reason: "provider_error" });
    expect(await count()).toBe(82);
  });

  test("a counter that cannot be written does not stop an email: it is sent, and the log names no address", async () => {
    const broken = { ENVIRONMENT: "test", DB: { prepare: () => { throw new Error("d1 is down"); } } as unknown as D1Database };
    const { lines, restore } = captureConsole();
    try {
      expect(await sendEmail(broken, message("verify-email", "siswa-rahasia@example.test"))).toEqual({ ok: true });
      expect(await sendEmail(broken, message("application-received", "siswa-rahasia@example.test"))).toEqual({ ok: true });
    } finally {
      restore();
    }
    expect(mailbox.messages).toHaveLength(2);
    expect(lines).toEqual(["[email] the daily counter could not be updated", "[email] the daily counter could not be updated"]);
  });

  test("a new UTC day starts the count again: the day's row is the key (the clock moves, the old day's row stays)", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(Date.UTC(2030, 5, 1, 23, 59, 58));
      await setCount(EMAIL_DAILY_ALLOWANCE, "2030-06-01");
      expect(await emailQuotaSpent(env)).toBe(true);
      vi.setSystemTime(Date.UTC(2030, 5, 2, 0, 0, 1));
      expect(await emailQuotaSpent(env)).toBe(false);
      expect(await sendEmail(TEST_ENV, message("application-received"))).toEqual({ ok: true });
    } finally {
      vi.useRealTimers();
    }
    expect(await count("2030-06-02")).toBe(1);
    expect(await count("2030-06-01")).toBe(100);
  });
});

describe("the portal's account routes answer 503 email_quota when the day is spent", () => {
  const RESEND = "/portal/api/auth/send-verification-email";
  const FORGOT = "/portal/api/auth/request-password-reset";

  async function atQuota<T>(run: () => Promise<T>): Promise<T> {
    await setCount(EMAIL_DAILY_ALLOWANCE);
    return run();
  }

  test("registration: 503 with the message, and NOTHING is created or sent", async () => {
    const email = uniqueEmail("baru");
    const res = await atQuota(() => portalRegister(email));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "email_quota", message: EMAIL_QUOTA_MESSAGE });
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await countRows("users")).toBe(0);
    expect(await countRows("account")).toBe(0);
    expect(mailbox.messages).toHaveLength(0);
    expect(await count()).toBe(100);
  });

  test("resend and forgot-password: the same 503, for an address that has an account and one that has none (it is a function of the day, not of the address)", async () => {
    const known = uniqueEmail("ada");
    await createPortalAccount(known);
    await setCount(EMAIL_DAILY_ALLOWANCE);
    const bodies: unknown[] = [];
    for (const path of [RESEND, FORGOT]) {
      for (const email of [known, uniqueEmail("tidak-ada")]) {
        const res = await portalCall(path, { method: "POST", json: { email, ...(path === FORGOT ? { redirectTo: "/portal/reset-password" } : { callbackURL: "/portal/login?verified=1" }) } });
        expect(res.status, `${path} ${email}`).toBe(503);
        bodies.push(await res.json());
      }
    }
    expect(new Set(bodies.map((body) => JSON.stringify(body))).size).toBe(1);
    expect(bodies[0]).toEqual({ error: "email_quota", message: EMAIL_QUOTA_MESSAGE });
    expect(mailbox.messages.filter((m) => m.to === known)).toHaveLength(1); // only the verification of the account's own creation
  });

  test("at 99 a registration goes through, and the 100th email is its verification", async () => {
    await setCount(EMAIL_DAILY_ALLOWANCE - 1);
    const res = await portalRegister(uniqueEmail("ke100"));
    expect(res.status).toBe(200);
    expect(await count()).toBe(100);
    expect(mailbox.messages).toHaveLength(1);
    // Now it is spent.
    expect((await portalRegister(uniqueEmail("ke101"))).status).toBe(503);
  });

  test("a registration counts: one new address is one email, an address that already has an account is one ('Kamu sudah punya akun')", async () => {
    const email = uniqueEmail("dua");
    expect((await portalRegister(email)).status).toBe(200);
    expect(await count()).toBe(1);
    expect((await portalRegister(email)).status).toBe(200);
    expect(await count()).toBe(2);
    expect(mailbox.messages.map((m) => m.purpose)).toEqual(["verify-email", "account-exists"]);
  });

  test("the other auth routes are not touched: sign-in, the session and sign-out work at 100", async () => {
    const email = uniqueEmail("masuk");
    const cookie = await portalSignedIn(email);
    await setCount(EMAIL_DAILY_ALLOWANCE);
    expect((await portalSignIn(email)).status).toBe(200);
    expect((await portalCall("/portal/api/auth/get-session", { cookie })).status).toBe(200);
    expect((await portalCall("/portal/api/me", { cookie })).status).toBe(200);
    expect((await portalCall("/portal/api/auth/sign-out", { method: "POST", cookie, json: {} })).status).toBe(200);
  });

  test("the rate limiter answers first: the 11th registration of a minute is a 429, not the 503", async () => {
    await setCount(EMAIL_DAILY_ALLOWANCE);
    const ip = "198.51.100.77";
    const statuses: number[] = [];
    for (let i = 0; i < 11; i++) statuses.push((await portalRegister(uniqueEmail("rl"), { ip })).status);
    expect(statuses).toEqual([...Array(10).fill(503), 429]);
    limiterClock.advance(61_000);
    expect((await portalRegister(uniqueEmail("rl"), { ip })).status).toBe(503);
  });

  test("it comes before Turnstile: a refused request does not spend a token (the check is never called), and a request under quota does", async () => {
    const network = fakeNetwork();
    const turnstile = { TURNSTILE_SECRET_KEY: TURNSTILE_TEST_SECRETS.alwaysPass };
    await setCount(EMAIL_DAILY_ALLOWANCE);
    const refused = await portalRegister(uniqueEmail("t1"), { env: turnstile, captcha: CAPTCHA });
    expect(refused.status).toBe(503);
    expect(network.siteverify).toHaveLength(0);
    await setCount(0);
    const allowed = await portalRegister(uniqueEmail("t2"), { env: turnstile, captcha: CAPTCHA });
    expect(allowed.status).toBe(200);
    expect(network.siteverify).toHaveLength(1);
  });

  test("it is a unit of the portal only: the admin Worker's forgot-password and resend are answered as before at 100", async () => {
    await setCount(EMAIL_DAILY_ALLOWANCE);
    const email = uniqueEmail("admin");
    await createVerifiedUser(email, "editor");
    await setCount(EMAIL_DAILY_ALLOWANCE);
    const forgot = await call("/api/auth/request-password-reset", { method: "POST", json: { email, redirectTo: "/reset-password" } });
    expect(forgot.status).toBe(200);
    const resend = await call("/api/auth/send-verification-email", { method: "POST", json: { email, callbackURL: "/login" } });
    expect(resend.status).toBe(200);
    expect(await forgot.json()).not.toHaveProperty("error");
  });

  test("a counter that cannot be read does not close the door (it logs, it does not turn registrations away)", async () => {
    const broken = { prepare: (sql: string) => (/email_daily/.test(sql) ? (() => { throw new Error("d1 is down"); })() : env.DB.prepare(sql)) } as unknown as D1Database;
    const proxied = new Proxy(env.DB, { get: (target, property) => (property === "prepare" ? broken.prepare : (Reflect.get(target, property, target) as unknown)) });
    const { lines, restore } = captureConsole();
    let res: Response;
    try {
      res = await portalRegister(uniqueEmail("db"), { env: { DB: proxied as D1Database } });
    } finally {
      restore();
    }
    expect(res.status).toBe(200);
    expect(lines).toContain("[email] the daily counter could not be read");
  });
});

async function createPortalAccount(email: string) {
  expect((await portalRegister(email)).status).toBe(200);
}

describe("the confirmation of an application follows the budget", () => {
  /** A student with a complete draft and its files, with a WhatsApp number of their own (the same number inside an hour is the anti-duplicate). */
  async function ready(whatsapp: string) {
    const who = await student();
    await saveAll(who, { identity: { ...VALID.identity, whatsapp } });
    const draft = (await draftOf(who.id))!;
    await addRequiredFiles(draft.id);
    return who;
  }

  test("under 80 it is sent and counted (79 becomes 80)", async () => {
    await openBatch();
    const who = await ready("6281000000001");
    await setCount(EMAIL_CONFIRMATION_CEILING - 1);
    mailbox.clear();
    expect((await submit(who)).status).toBe(201);
    expect(mailbox.messages.map((m) => m.purpose)).toEqual(["application-received"]);
    expect(await count()).toBe(EMAIL_CONFIRMATION_CEILING);
  });

  test("at 80 the application is still saved (201), no email is sent, the counter stays, and the log says why in numbers", async () => {
    await openBatch();
    const who = await ready("6281000000002");
    await setCount(EMAIL_CONFIRMATION_CEILING);
    mailbox.clear();
    const { lines, restore } = captureConsole();
    let res: Response;
    try {
      res = await submit(who);
    } finally {
      restore();
    }
    expect(res.status).toBe(201);
    expect((await applicationOf(who.id))?.user_id).toBe(who.id);
    expect(mailbox.messages).toHaveLength(0);
    expect(await count()).toBe(EMAIL_CONFIRMATION_CEILING);
    expect(lines).toEqual(["[email] 80 of 100 emails are used today; application-received email was not sent"]);
  });

  test("the day's emails are one counter for every purpose: a registration and a confirmation together", async () => {
    await openBatch();
    const email = uniqueEmail("hitung");
    expect((await portalRegister(email)).status).toBe(200);
    const who = await ready("6281000000003");
    mailbox.clear();
    const before = await count();
    expect((await submit(who)).status).toBe(201);
    expect(await count()).toBe(before + 1);
  });
});

