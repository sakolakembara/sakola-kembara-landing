import { env } from "cloudflare:workers";
import { afterEach, describe, expect, test, vi } from "vitest";
import { AUTH_POLICIES, findPolicy } from "../src/auth/gate";
import { TURNSTILE_TEST_SECRETS } from "../src/security/turnstile";
import {
  call,
  CAPTCHA,
  createVerifiedUser,
  emails,
  emailsTo,
  fakeNetwork,
  freshIp,
  PASSWORD,
  productionLike,
  register,
  signIn,
  uniqueEmail,
  withEmail,
} from "./helpers";

// src/auth/gate.ts: which /api/auth routes exist, and what stands in front of each.

afterEach(() => {
  vi.restoreAllMocks();
});

async function userCount(): Promise<number> {
  return (await env.DB.prepare("SELECT count(*) AS n FROM users").first<{ n: number }>())!.n;
}

describe("the route table", () => {
  const unlisted: [string, string][] = [
    ["POST", "/api/auth/sign-up/email"],
    ["POST", "/api/auth/update-user"],
    ["POST", "/api/auth/delete-user"],
    ["POST", "/api/auth/change-email"],
    ["POST", "/api/auth/change-password"],
    ["POST", "/api/auth/set-password"],
    ["GET", "/api/auth/list-sessions"],
    ["POST", "/api/auth/revoke-sessions"],
    ["GET", "/api/auth/list-accounts"],
    ["POST", "/api/auth/link-social"],
    ["POST", "/api/auth/unlink-account"],
    ["POST", "/api/auth/get-access-token"],
    ["GET", "/api/auth/ok"],
    ["GET", "/api/auth/error"],
    ["GET", "/api/auth/sign-in/email"], // right path, wrong method
    ["POST", "/api/auth/get-session"],
    ["POST", "/api/auth/reset-password/sometoken"],
    ["GET", "/api/auth/reset-password"], // the prefix needs a token after it
    ["GET", "/api/auth/"],
    ["GET", "/api/auth"],
  ];

  for (const [method, path] of unlisted) {
    test(`${method} ${path} does not exist`, async () => {
      const res = await call(path, { method, ...(method === "POST" ? { json: {} } : {}) });
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: "not_found" });
    });
  }

  test("every listed route has an explicit decision: limits listed or none on purpose", () => {
    expect(AUTH_POLICIES.map((policy) => `${policy.method} ${policy.path}`).sort()).toEqual([
      "GET /callback/",
      "GET /get-session",
      "GET /reset-password/",
      "GET /verify-email",
      "POST /register",
      "POST /request-password-reset",
      "POST /reset-password",
      "POST /send-verification-email",
      "POST /sign-in/email",
      "POST /sign-in/social",
      "POST /sign-out",
    ]);
    // Every route that sends an email, or checks a password, is behind Turnstile and a limit.
    for (const path of ["/sign-in/email", "/register", "/request-password-reset", "/send-verification-email"]) {
      const policy = findPolicy("POST", path)!;
      expect(policy.turnstile, path).toBeDefined();
      expect(policy.limits({ ip: "1.2.3.4", email: "abc" }).length, path).toBeGreaterThan(0);
    }
    for (const path of ["/register", "/request-password-reset", "/send-verification-email"]) {
      expect(findPolicy("POST", path)!.sendsEmail, path).toBe(true);
    }
  });

  test("parameterised paths match a token after the prefix, nothing else", () => {
    expect(findPolicy("GET", "/api/auth/reset-password/abc")).toBeDefined();
    expect(findPolicy("GET", "/api/auth/reset-password/")).toBeUndefined();
    expect(findPolicy("GET", "/api/auth/callback/google")).toBeDefined();
    expect(findPolicy("POST", "/api/auth/callback/google")).toBeUndefined();
  });
});

describe("JSON only, and a small body", () => {
  test("a form-encoded body is a 415 (it could not carry the keys the limits use)", async () => {
    const res = await call("/api/auth/sign-in/email", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: `email=${encodeURIComponent("a@example.test")}&password=${PASSWORD}`,
    });
    expect(res.status).toBe(415);
    expect(await res.json()).toEqual({ error: "json_required" });
  });

  test("so is text/plain, and a missing content type", async () => {
    expect((await call("/api/auth/register", { method: "POST", headers: { "content-type": "text/plain" }, body: "{}" })).status).toBe(415);
    expect((await call("/api/auth/sign-out", { method: "POST" })).status).toBe(415);
  });

  test("a body over 8 KiB is a 413 before anything reads it further", async () => {
    const big = JSON.stringify({ email: "a@example.test", password: "x".repeat(9000) });
    expect((await call("/api/auth/sign-in/email", { method: "POST", headers: { "content-type": "application/json" }, body: big })).status).toBe(413);
    expect(await userCount()).toBe(0);
  });

  test("a body just under the limit is read", async () => {
    const email = uniqueEmail();
    await createVerifiedUser(email);
    const padded = JSON.stringify({ email, password: PASSWORD, padding: "x".repeat(7000) });
    const res = await call("/api/auth/sign-in/email", { method: "POST", headers: { "content-type": "application/json" }, body: padded });
    expect(res.status).toBe(200);
  });
});

describe("Turnstile on the routes that send email or check a password", () => {
  const routes = [
    { name: "sign-in", path: "/api/auth/sign-in/email", body: () => ({ email: uniqueEmail(), password: PASSWORD }) },
    { name: "register", path: "/api/auth/register", body: () => ({ email: uniqueEmail(), password: PASSWORD, name: "Tester" }) },
    { name: "forgot password", path: "/api/auth/request-password-reset", body: () => ({ email: uniqueEmail(), redirectTo: "/reset-password" }) },
    { name: "resend verification", path: "/api/auth/send-verification-email", body: () => ({ email: uniqueEmail() }) },
  ];

  for (const route of routes) {
    describe(route.name, () => {
      // Negative check: skip the Turnstile call in src/auth/gate.ts, or make verifyTurnstile always ok.
      test("no token: 403 captcha_failed", async () => {
        fakeNetwork();
        const res = await call(route.path, { method: "POST", json: route.body(), env: productionLike });
        expect(res.status).toBe(403);
        expect(await res.json()).toMatchObject({ error: "captcha_failed", message: expect.stringContaining("Verifikasi keamanan gagal") });
      });

      test("a token Cloudflare refuses: 403, and nothing is created or sent", async () => {
        const network = fakeNetwork();
        const body = route.body();
        const res = await call(route.path, { method: "POST", json: body, env: { ...productionLike, TURNSTILE_SECRET_KEY: TURNSTILE_TEST_SECRETS.alwaysFail }, captcha: CAPTCHA });
        expect(res.status).toBe(403);
        expect(network.siteverify).toHaveLength(1);
        expect(await userCount()).toBe(0);
        expect(emails()).toHaveLength(0);
        expect(network.resend).toHaveLength(0);
      });

      test("a token that was already used: 403", async () => {
        fakeNetwork();
        const res = await call(route.path, { method: "POST", json: route.body(), env: { ...productionLike, TURNSTILE_SECRET_KEY: TURNSTILE_TEST_SECRETS.spent }, captcha: CAPTCHA });
        expect(res.status).toBe(403);
        expect(await res.json()).toMatchObject({ error: "captcha_failed" });
      });

      test("Siteverify unreachable: 503 captcha_unavailable (fails closed), nothing happens", async () => {
        vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("network down"));
        const res = await call(route.path, { method: "POST", json: route.body(), env: productionLike, captcha: CAPTCHA });
        expect(res.status).toBe(503);
        expect(await res.json()).toMatchObject({ error: "captcha_unavailable" });
        expect(await userCount()).toBe(0);
      });

      test("production without TURNSTILE_SECRET_KEY: 503, never skipped", async () => {
        const res = await call(route.path, { method: "POST", json: route.body(), env: { ...productionLike, TURNSTILE_SECRET_KEY: undefined }, captcha: CAPTCHA });
        expect(res.status).toBe(503);
        expect(await res.json()).toMatchObject({ error: "captcha_unavailable" });
      });

      test("a good token passes the gate and is sent to Siteverify with the visitor's address", async () => {
        const network = fakeNetwork();
        const ip = freshIp();
        const res = await call(route.path, { method: "POST", json: route.body(), env: productionLike, captcha: CAPTCHA, ip });
        expect(res.status).not.toBe(403);
        expect(res.status).not.toBe(503);
        expect(network.siteverify).toEqual([{ secret: TURNSTILE_TEST_SECRETS.alwaysPass, response: CAPTCHA, remoteip: ip }]);
      });
    });
  }

  test("registration with a good token creates the account, with a bad one it does not", async () => {
    const network = fakeNetwork();
    const good = uniqueEmail("good");
    const bad = uniqueEmail("bad");
    expect((await register(good, { env: productionLike, captcha: CAPTCHA })).status).toBe(200);
    expect((await register(bad, { env: { ...productionLike, TURNSTILE_SECRET_KEY: TURNSTILE_TEST_SECRETS.alwaysFail }, captcha: CAPTCHA })).status).toBe(403);
    const users = await env.DB.prepare("SELECT email FROM users").all<{ email: string }>();
    expect(users.results.map((row) => row.email)).toEqual([good]);
    expect(network.resend.map((message) => message.to)).toEqual([good]);
  });

  test("the rate limit counts failed Turnstile attempts too, so a bot cannot hammer Siteverify", async () => {
    const network = fakeNetwork();
    const ip = freshIp();
    const email = uniqueEmail();
    const statuses: number[] = [];
    for (let i = 0; i < 7; i++) {
      statuses.push((await call("/api/auth/sign-in/email", { method: "POST", json: { email, password: "x" }, env: productionLike, ip })).status);
    }
    expect(statuses).toEqual([403, 403, 403, 403, 403, 429, 429]);
    expect(network.siteverify).toHaveLength(0); // no token was sent, and the limited ones never got that far
  });

  test("the routes that carry a token or nothing sensitive need no Turnstile", async () => {
    fakeNetwork();
    const noCaptcha = { ...productionLike, TURNSTILE_SECRET_KEY: TURNSTILE_TEST_SECRETS.alwaysFail };
    expect((await call("/api/auth/get-session", { env: noCaptcha })).status).toBe(200);
    expect((await call("/api/auth/sign-out", { method: "POST", json: {}, env: noCaptcha })).status).not.toBe(403);
    expect((await call("/api/auth/reset-password", { method: "POST", json: { token: "nope", newPassword: "long enough" }, env: noCaptcha })).status).toBe(400);
    expect((await call("/api/auth/verify-email?token=nope", { env: noCaptcha })).status).not.toBe(403);
  });

  test("outside production with no secret the check is skipped, so forms work without a Cloudflare account", async () => {
    const network = fakeNetwork();
    const res = await register(uniqueEmail(), { env: { TURNSTILE_SECRET_KEY: "" } });
    expect(res.status).toBe(200);
    expect(network.siteverify).toHaveLength(0);
  });

  test("outside production a configured secret is used for real (Cloudflare's test secrets)", async () => {
    const network = fakeNetwork();
    expect((await register(uniqueEmail(), { env: { TURNSTILE_SECRET_KEY: TURNSTILE_TEST_SECRETS.alwaysFail }, captcha: CAPTCHA })).status).toBe(403);
    expect((await register(uniqueEmail(), { env: { TURNSTILE_SECRET_KEY: TURNSTILE_TEST_SECRETS.alwaysPass }, captcha: CAPTCHA })).status).toBe(200);
    expect(network.siteverify).toHaveLength(2);
  });
});

describe("routes that send email refuse when no email can be sent (production), before creating anything", () => {
  const noProvider = { ENVIRONMENT: "production", RESEND_API_KEY: undefined, EMAIL_FROM: undefined, TURNSTILE_SECRET_KEY: TURNSTILE_TEST_SECRETS.alwaysPass };

  test("register: 503 email_unavailable, no account", async () => {
    const network = fakeNetwork();
    const res = await register(uniqueEmail(), { env: noProvider, captcha: CAPTCHA });
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ error: "email_unavailable", message: expect.stringContaining("email") });
    expect(await userCount()).toBe(0);
    expect(network.siteverify).toHaveLength(0); // refused before the token is spent
  });

  test("forgot password and resend: 503, the same for every address (so it is no oracle)", async () => {
    fakeNetwork();
    const known = uniqueEmail();
    await createVerifiedUser(known);
    for (const email of [known, uniqueEmail("ghost")]) {
      const reset = await call("/api/auth/request-password-reset", { method: "POST", json: { email, redirectTo: "/reset-password" }, env: noProvider, captcha: CAPTCHA });
      const resend = await call("/api/auth/send-verification-email", { method: "POST", json: { email }, env: noProvider, captcha: CAPTCHA });
      expect([reset.status, resend.status]).toEqual([503, 503]);
    }
  });

  test("a missing EMAIL_FROM alone is enough to refuse", async () => {
    fakeNetwork();
    const res = await register(uniqueEmail(), { env: { ...productionLike, EMAIL_FROM: undefined }, captcha: CAPTCHA });
    expect(res.status).toBe(503);
  });

  test("sign-in is not affected: it sends nothing unless the account is unverified", async () => {
    const email = uniqueEmail();
    await createVerifiedUser(email);
    fakeNetwork();
    const res = await call("/api/auth/sign-in/email", { method: "POST", json: { email, password: PASSWORD }, env: noProvider, captcha: CAPTCHA });
    expect(res.status).toBe(200);
  });

  test("outside production it works without a provider: the message is recorded, not printed", async () => {
    const email = uniqueEmail();
    const res = await register(email, { env: { RESEND_API_KEY: undefined, EMAIL_FROM: undefined } });
    expect(res.status).toBe(200);
    expect(emailsTo(email)).toHaveLength(1);
  });

  test("a configured provider that fails later does not change the answer (no oracle), but is logged without the address", async () => {
    const logged: string[] = [];
    for (const method of ["error", "warn", "info", "log"] as const) vi.spyOn(console, method).mockImplementation((...args: unknown[]) => void logged.push(args.join(" ")));
    const network = fakeNetwork();
    network.resendStatus = 422;
    network.resendBody = JSON.stringify({ name: "validation_error", message: "The to field must be a valid email recipient@example.test" });

    const email = uniqueEmail();
    const res = await register(email, { env: productionLike, captcha: CAPTCHA });
    expect(res.status).toBe(200);
    expect(logged.join("\n")).toContain("provider rejected verify-email email: HTTP 422 validation_error");
    expect(logged.join("\n")).not.toContain(email);
    expect(logged.join("\n")).not.toContain("recipient@example.test");
  });
});

describe("withEmail env, for reference", () => {
  test("a configured provider sends through Resend, not the mailbox", async () => {
    const network = fakeNetwork();
    const email = uniqueEmail();
    expect((await register(email, { env: withEmail })).status).toBe(200);
    expect(network.resend.map((message) => message.to)).toEqual([email]);
    expect(emails()).toHaveLength(0);
  });
});

describe("sign-in still reaches Better Auth through the gate", () => {
  test("verified user, good password, good token", async () => {
    const email = uniqueEmail();
    await createVerifiedUser(email);
    fakeNetwork();
    const res = await call("/api/auth/sign-in/email", { method: "POST", json: { email, password: PASSWORD }, env: productionLike, captcha: CAPTCHA });
    expect(res.status).toBe(200);
    expect((await signIn(uniqueEmail("nobody"))).status).toBe(401);
  });
});
