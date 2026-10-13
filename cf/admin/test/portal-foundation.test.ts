import { env } from "cloudflare:workers";
import { Hono, type Context } from "hono";
import { afterEach, describe, expect, test, vi } from "vitest";
import type { AppEnv } from "../src/context";
import { EMAIL_NOT_VERIFIED_MESSAGE, requireStudent, STUDENT_ONLY_MESSAGE } from "../src/portal/guard";
import { call, CAPTCHA, fakeNetwork, freshIp, PASSWORD, productionLike, signedInCookie, uniqueEmail } from "./helpers";
import { limiterClock } from "./limiter-clock";
import {
  cookieHeaderOf,
  createVerifiedStudent,
  PORTAL_ORIGIN,
  portalAppAround,
  portalCall,
  portalSignedIn,
  portalSignIn,
} from "./portal-helpers";

// The portal Worker's skeleton (src/portal/worker.ts, src/portal/guard.ts): what every /portal/api answer carries, the
// public config, `me`, the guard every student route starts with, the JSON 404, the error handler. The auth routes are in
// test/portal-auth.test.ts. docs/cloudflare/portal-architecture.md sections 4 and 6; portal-api.md section 1.

afterEach(() => {
  vi.restoreAllMocks();
});

const ALWAYS_HEADERS = { "cache-control": "no-store", "x-content-type-options": "nosniff", "referrer-policy": "no-referrer" };

function expectApiHeaders(res: Response, label = "") {
  for (const [name, value] of Object.entries(ALWAYS_HEADERS)) expect(res.headers.get(name), `${label} ${name}`).toBe(value);
}

describe("headers and the JSON 404", () => {
  test("every answer under /portal/api carries no-store, nosniff and no-referrer: success, refusals, redirects and 404s", async () => {
    const email = uniqueEmail();
    const cookie = await portalSignedIn(email);
    const answers: [string, Response][] = [
      ["config", await portalCall("/portal/api/config")],
      ["me", await portalCall("/portal/api/me", { cookie })],
      ["me without a session (401)", await portalCall("/portal/api/me")],
      ["unknown path (404)", await portalCall("/portal/api/nothing-here")],
      ["unknown auth route (404)", await portalCall("/portal/api/auth/delete-user", { method: "POST", json: {} })],
      ["a cross-origin write (403)", await portalCall("/portal/api/auth/sign-out", { method: "POST", json: {}, origin: "https://evil.test" })],
      ["a form body (415)", await portalCall("/portal/api/auth/register", { method: "POST", headers: { "content-type": "text/plain" }, body: "x" })],
      ["a redirect of Better Auth", await portalCall("/portal/api/auth/verify-email?token=nope&callbackURL=%2Fportal%2Flogin")],
      ["get-session", await portalCall("/portal/api/auth/get-session", { cookie })],
    ];
    for (const [label, res] of answers) expectApiHeaders(res, label);
    expect(answers.map(([, res]) => res.status)).toEqual([200, 200, 401, 404, 404, 403, 415, 302, 200]);
  });

  test("an unknown path under /portal/api is the ordinary JSON 404, and so are paths outside it (nothing else lives in this script)", async () => {
    for (const path of ["/portal/api", "/portal/api/", "/portal/api/nothing-here", "/portal/api/overview", "/portal/api/applications", "/portal/status", "/portal", "/", "/api/me", "/api/config", "/api/admin/users"]) {
      const res = await portalCall(path);
      expect(res.status, path).toBe(404);
      expect(await res.json(), path).toEqual({ error: "not_found" });
    }
  });

  test("the admin's surface does not exist here and the portal's does not exist on the admin (no route is shared)", async () => {
    const cookie = await portalSignedIn();
    for (const path of ["/api/me", "/api/dashboard", "/api/admin/applications", "/api/auth/get-session", "/uploads/x.png"]) {
      expect((await portalCall(path, { cookie })).status, `portal ${path}`).toBe(404);
    }
    for (const path of ["/portal/api/me", "/portal/api/config", "/portal/api/auth/get-session", "/portal/api/overview", "/portal/api/dev/mailbox"]) {
      const res = await call(path, { cookie });
      expect(res.status, `admin ${path}`).toBe(404);
      expect(await res.json(), path).toEqual({ error: "not_found" });
    }
  });

  test("a route that sets its own Cache-Control keeps it (a file answer is `private, no-store`), the other two headers are added", async () => {
    // The Worker mounts no route of its own yet, so the middleware the Worker uses (src/portal/headers.ts) is put in
    // front of a route that sets its own, exactly as the file routes of a later task will be.
    const files = new Hono<AppEnv>();
    files.get("/file", () => new Response("bytes", { headers: { "Cache-Control": "private, no-store", "Content-Type": "image/png" } }));
    files.get("/plain", (c) => c.json({ ok: true }));
    const via = portalAppAround({ "/portal/api": files });
    const file = await portalCall("/portal/api/file", { via });
    expect(file.headers.get("cache-control")).toBe("private, no-store");
    expect(file.headers.get("x-content-type-options")).toBe("nosniff");
    expect(file.headers.get("referrer-policy")).toBe("no-referrer");
    expectApiHeaders(await portalCall("/portal/api/plain", { via }), "plain");
  });

  test("no CORS: no Access-Control header on any answer, and no OPTIONS handler", async () => {
    for (const [path, init] of [
      ["/portal/api/config", { headers: { origin: "https://evil.test" } }],
      ["/portal/api/me", { headers: { origin: "https://evil.test" } }],
      ["/portal/api/config", { method: "OPTIONS", headers: { origin: "https://evil.test", "access-control-request-method": "GET" } }],
      ["/portal/api/auth/sign-in/email", { method: "OPTIONS", origin: "https://evil.test", headers: { "access-control-request-method": "POST" } }],
    ] as const) {
      const res = await portalCall(path, init);
      for (const name of res.headers.keys()) expect(name.startsWith("access-control-"), `${path} ${name}`).toBe(false);
    }
    expect((await portalCall("/portal/api/config", { method: "OPTIONS" })).status).toBe(404);
  });
});

describe("the same-origin guard on every write", () => {
  test("a write from another origin, from a sibling subdomain (same-site) or from a page with no signal and a cookie is refused before anything runs", async () => {
    const cookie = await portalSignedIn();
    const refused = [
      await portalCall("/portal/api/auth/sign-out", { method: "POST", json: {}, cookie, origin: "https://evil.test" }),
      await portalCall("/portal/api/auth/sign-out", { method: "POST", json: {}, cookie, origin: "https://admin.sakola.test" }),
      await portalCall("/portal/api/auth/sign-out", { method: "POST", json: {}, cookie, origin: null, headers: { "sec-fetch-site": "same-site" } }),
      await portalCall("/portal/api/auth/sign-out", { method: "POST", json: {}, cookie, origin: null }),
    ];
    expect(refused.map((res) => res.status)).toEqual([403, 403, 403, 403]);
    expect((await Promise.all(refused.map((res) => res.json() as Promise<{ error: string }>))).map((body) => body.error)).toEqual(["forbidden", "forbidden", "forbidden", "forbidden"]);
    // The session is still alive: nothing ran.
    expect((await portalCall("/portal/api/me", { cookie })).status).toBe(200);
  });

  test("a write from the apex itself passes", async () => {
    const cookie = await portalSignedIn();
    expect((await portalCall("/portal/api/auth/sign-out", { method: "POST", json: {}, cookie })).status).toBe(200);
  });
});

describe("GET /portal/api/config", () => {
  test("public: nothing set means no Google, no widget key, no links", async () => {
    const res = await portalCall("/portal/api/config");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ google: false, turnstileSiteKey: null, siteUrl: "", adminUrl: "" });
  });

  test("Google only when both variables are set; the widget's public key; the two origins", async () => {
    const res = await portalCall("/portal/api/config", {
      env: { GOOGLE_CLIENT_ID: "id", GOOGLE_CLIENT_SECRET: "secret", TURNSTILE_SITE_KEY: "site-key", SITE_URL: "https://sakola.test/", ADMIN_URL: "https://admin.sakola.test" },
    });
    expect(await res.json()).toEqual({ google: true, turnstileSiteKey: "site-key", siteUrl: "https://sakola.test", adminUrl: "https://admin.sakola.test" });
    expect(((await (await portalCall("/portal/api/config", { env: { GOOGLE_CLIENT_ID: "id" } })).json()) as { google: boolean }).google).toBe(false);
    expect(((await (await portalCall("/portal/api/config", { env: { GOOGLE_CLIENT_SECRET: "x" } })).json()) as { google: boolean }).google).toBe(false);
  });

  test("a secret never leaves: nothing but the four public fields is answered", async () => {
    const res = await portalCall("/portal/api/config", {
      env: { GOOGLE_CLIENT_ID: "id", GOOGLE_CLIENT_SECRET: "client-secret-value", TURNSTILE_SECRET_KEY: "turnstile-secret-value", RESEND_API_KEY: "re_secret_value", PRIVATE_FILES_KEY: "files-key-value" },
    });
    expect(Object.keys((await res.clone().json()) as object).sort()).toEqual(["adminUrl", "google", "siteUrl", "turnstileSiteKey"]);
    const text = await res.text();
    for (const secret of ["client-secret-value", "turnstile-secret-value", "re_secret_value", "files-key-value"]) expect(text).not.toContain(secret);
  });

  test("an origin that is not a plain http(s) origin is treated as unset (a typo can break a link, never put a script in an attribute)", async () => {
    for (const bad of ["javascript:alert(1)", "https://a.test/path", 'https://a.test"x', "ftp://a.test", "not a url", "//a.test", ""]) {
      const body = (await (await portalCall("/portal/api/config", { env: { SITE_URL: bad, ADMIN_URL: bad } })).json()) as { siteUrl: string; adminUrl: string };
      expect(body, bad).toMatchObject({ siteUrl: "", adminUrl: "" });
    }
  });
});

describe("GET /portal/api/me", () => {
  test("a student gets exactly the five fields the SPA needs, and nothing else about the account", async () => {
    const email = uniqueEmail();
    const id = await createVerifiedStudent(email);
    const cookie = cookieHeaderOf(await portalSignIn(email));
    const res = await portalCall("/portal/api/me", { cookie });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ user: { id, name: "Tester", email, emailVerified: true, role: "student" } });
  });

  test("an admin account gets its role: the SPA shows the screen that links to the admin (me is the one route that does not check the role)", async () => {
    for (const role of ["viewer", "editor", "super_admin"] as const) {
      const email = uniqueEmail(role);
      const cookie = await portalSignedIn(email, role);
      const body = (await (await portalCall("/portal/api/me", { cookie })).json()) as { user: { role: string } };
      expect(body.user.role, role).toBe(role);
    }
  });

  test("no session, a garbage cookie, a signed-out session: 401 unauthenticated", async () => {
    expect(await (await portalCall("/portal/api/me")).json()).toEqual({ error: "unauthenticated" });
    expect((await portalCall("/portal/api/me", { cookie: "sakem-student.session_token=garbage" })).status).toBe(401);
    const cookie = await portalSignedIn();
    await portalCall("/portal/api/auth/sign-out", { method: "POST", json: {}, cookie });
    expect((await portalCall("/portal/api/me", { cookie })).status).toBe(401);
  });

  test("a deactivated account has no session even if its row is still there", async () => {
    const email = uniqueEmail();
    const cookie = await portalSignedIn(email);
    await env.DB.prepare("UPDATE users SET deactivated_at = ? WHERE email = ?").bind(Date.now(), email).run();
    expect((await portalCall("/portal/api/me", { cookie })).status).toBe(401);
  });
});

describe("GET /portal/api/dev/mailbox", () => {
  test("only with ENVIRONMENT=development: the emails of this isolate; 404 in production and in tests", async () => {
    const email = uniqueEmail();
    await createVerifiedStudent(email);
    expect((await portalCall("/portal/api/dev/mailbox")).status).toBe(404); // ENVIRONMENT is "test"
    expect((await portalCall("/portal/api/dev/mailbox", { env: { ENVIRONMENT: "production" } })).status).toBe(404);
    const res = await portalCall("/portal/api/dev/mailbox", { env: { ENVIRONMENT: "development" } });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { messages: unknown[] }).messages.length).toBeGreaterThan(0);
  });
});

describe("the error handler", () => {
  test("an unexpected error is a JSON 500 with no message, and the log line holds the message only (no stack, no request)", async () => {
    const routes = new Hono<AppEnv>();
    routes.get("/boom", () => {
      throw new Error("something broke");
    });
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await portalCall("/portal/api/boom", { via: portalAppAround({ "/portal/api": routes }) });
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "internal" });
    expect(error.mock.calls).toEqual([["[portal] unhandled error: something broke"]]);
  });
});

// ─── The guard every student route starts with ─────────────────────────

describe("requireStudent: the pipeline of a student route, in order", () => {
  /** A route per limiter, each answering with the user the guard set (and counting its own runs). */
  const runs = { read: 0, save: 0, upload: 0, submit: 0, plain: 0 };
  const routes = new Hono<AppEnv>();
  const answer = (name: keyof typeof runs) => (c: Context<AppEnv>) => {
    runs[name] += 1;
    return c.json({ ok: true, user: c.get("user").id });
  };
  routes.get("/read", requireStudent("portalRead"), answer("read"));
  routes.put("/save", requireStudent("portalSave"), answer("save"));
  routes.put("/upload", requireStudent("portalUpload"), answer("upload"));
  routes.post("/submit", requireStudent("portalSubmit"), answer("submit"));
  routes.get("/plain", requireStudent(), answer("plain"));
  const via = portalAppAround({ "/portal/api": routes });

  afterEach(() => {
    for (const key of Object.keys(runs) as (keyof typeof runs)[]) runs[key] = 0;
  });

  test("(2) nobody is signed in: 401 unauthenticated, and the route does not run", async () => {
    const res = await portalCall("/portal/api/read", { via });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthenticated" });
    expect(runs.read).toBe(0);
  });

  test("(2) a cookie of the ADMIN audience is nobody here, and a student's cookie is nobody on the admin", async () => {
    const cookie = await signedInCookie(uniqueEmail("admin"), "editor");
    expect(cookie).toContain("better-auth.session_token=");
    expect((await portalCall("/portal/api/read", { via, cookie })).status).toBe(401);
  });

  test("(3) an admin account of every role is refused with student_only on every data route, whatever the limiter", async () => {
    for (const role of ["viewer", "editor", "super_admin"] as const) {
      const cookie = await portalSignedIn(uniqueEmail(role), role);
      for (const [method, path] of [["GET", "/read"], ["PUT", "/save"], ["PUT", "/upload"], ["POST", "/submit"], ["GET", "/plain"]] as const) {
        const res = await portalCall(`/portal/api${path}`, { via, cookie, method, ...(method === "GET" ? {} : { json: {} }) });
        expect(res.status, `${role} ${path}`).toBe(403);
        expect(await res.json(), `${role} ${path}`).toEqual({ error: "student_only", message: STUDENT_ONLY_MESSAGE });
      }
    }
    expect(Object.values(runs).reduce((a, b) => a + b, 0)).toBe(0);
    expect(STUDENT_ONLY_MESSAGE).toBe("Halaman ini hanya untuk calon siswa. Pengurus yayasan masuk lewat halaman admin.");
  });

  test("(3) the role is read from D1 on every call: an account promoted after sign-in is refused on the next request", async () => {
    const email = uniqueEmail();
    const cookie = await portalSignedIn(email);
    expect((await portalCall("/portal/api/plain", { via, cookie })).status).toBe(200);
    await env.DB.prepare("UPDATE users SET role = 'viewer' WHERE email = ?").bind(email).run();
    expect((await portalCall("/portal/api/plain", { via, cookie })).status).toBe(403);
  });

  test("(4) an unverified address is refused with email_not_verified (an unverified student cannot sign in; this is the second line)", async () => {
    const email = uniqueEmail();
    const cookie = await portalSignedIn(email);
    await env.DB.prepare("UPDATE users SET email_verified = 0 WHERE email = ?").bind(email).run();
    const res = await portalCall("/portal/api/read", { via, cookie });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "email_not_verified", message: EMAIL_NOT_VERIFIED_MESSAGE });
    expect(runs.read).toBe(0);
  });

  test("a verified student gets in, and the route sees who they are", async () => {
    const email = uniqueEmail();
    const id = await createVerifiedStudent(email);
    const cookie = cookieHeaderOf(await portalSignIn(email));
    for (const path of ["/read", "/plain"]) {
      const res = await portalCall(`/portal/api${path}`, { via, cookie });
      expect(res.status, path).toBe(200);
      expect(await res.json(), path).toEqual({ ok: true, user: id });
    }
    expect((await portalCall("/portal/api/save", { via, cookie, method: "PUT", json: {} })).status).toBe(200);
  });

  test("the order: role before verification, session before role", async () => {
    // An unverified admin account: the role answer comes first.
    const email = uniqueEmail();
    const cookie = await portalSignedIn(email, "viewer");
    await env.DB.prepare("UPDATE users SET email_verified = 0 WHERE email = ?").bind(email).run();
    expect(((await (await portalCall("/portal/api/read", { via, cookie })).json()) as { error: string }).error).toBe("student_only");
  });

  describe("(5) the limiter, keyed by the USER ID", () => {
    const limits = [
      { name: "portalRead", method: "GET", path: "/read", limit: 60, message: "Terlalu banyak permintaan. Silakan tunggu satu menit lalu coba lagi." },
      { name: "portalSave", method: "PUT", path: "/save", limit: 30, message: "Terlalu banyak penyimpanan. Silakan tunggu satu menit lalu coba lagi." },
      { name: "portalUpload", method: "PUT", path: "/upload", limit: 20, message: "Terlalu banyak unggahan. Silakan tunggu satu menit lalu coba lagi." },
      { name: "portalSubmit", method: "POST", path: "/submit", limit: 3, message: "Terlalu banyak percobaan pengiriman. Silakan tunggu beberapa menit lalu coba lagi." },
    ] as const;

    for (const { name, method, path, limit, message } of limits) {
      test(`${name}: ${limit} a minute, then 429 with Retry-After and the Indonesian message; the next minute starts again`, async () => {
        const cookie = await portalSignedIn();
        const send = () => portalCall(`/portal/api${path}`, { via, cookie, method, ...(method === "GET" ? {} : { json: {} }) });
        for (let i = 0; i < limit; i++) expect((await send()).status, `${name} call ${i + 1}`).toBe(200);
        const refused = await send();
        expect(refused.status).toBe(429);
        expect(refused.headers.get("retry-after")).toBe("60");
        expect(await refused.json()).toEqual({ error: "rate_limited", message, retryAfterSeconds: 60 });
        expect(Object.values(runs).reduce((a, b) => a + b, 0)).toBe(limit); // the refused call never reached the route
        limiterClock.advance(60_000);
        expect((await send()).status).toBe(200);
      });
    }

    test("the key is the user, not the address: one student from many addresses shares one bucket, two students do not share", async () => {
      const first = await portalSignedIn(uniqueEmail("a"));
      const second = await portalSignedIn(uniqueEmail("b"));
      for (let i = 0; i < 3; i++) expect((await portalCall("/portal/api/submit", { via, cookie: first, method: "POST", json: {}, ip: freshIp() })).status).toBe(200);
      expect((await portalCall("/portal/api/submit", { via, cookie: first, method: "POST", json: {}, ip: freshIp() })).status).toBe(429);
      expect((await portalCall("/portal/api/submit", { via, cookie: second, method: "POST", json: {}, ip: "203.0.113.7" })).status).toBe(200);
      expect((await portalCall("/portal/api/submit", { via, cookie: second, method: "POST", json: {}, ip: "203.0.113.7" })).status).toBe(200);
    });

    test("the limiter runs before the body is read or the route runs: a refused call reads nothing", async () => {
      const cookie = await portalSignedIn();
      for (let i = 0; i < 3; i++) await portalCall("/portal/api/submit", { via, cookie, method: "POST", json: {} });
      const before = runs.submit;
      // A body over the JSON limit would be a 413 if anything looked at it; the limiter answers first.
      const res = await portalCall("/portal/api/submit", { via, cookie, method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ x: "y".repeat(40_000) }) });
      expect(res.status).toBe(429);
      expect(runs.submit).toBe(before);
    });

    test("no key carries a name, an email or a cookie: the limiter is asked for '<limiter>:<user id>' and nothing else", async () => {
      const email = uniqueEmail();
      const id = await createVerifiedStudent(email);
      const cookie = cookieHeaderOf(await portalSignIn(email));
      const keys: string[] = [];
      const spy = { limit: async (options: RateLimitOptions) => (keys.push(options.key), { success: true }) } as RateLimit;
      await portalCall("/portal/api/read", { via, cookie, env: { RL_PORTAL_READ: spy } });
      expect(keys).toEqual([`portalRead:${id}`]);
    });

    test("a missing binding: production answers 503 service_unavailable (fail closed); development falls back to memory", async () => {
      // Production reads another cookie (the __Host- one), so the session is made the way production makes it.
      fakeNetwork();
      const email = uniqueEmail();
      await createVerifiedStudent(email);
      const cookie = cookieHeaderOf(await portalSignIn(email, PASSWORD, { env: productionLike, captcha: CAPTCHA }));
      expect(cookie).toContain("__Host-sakem-student.session_token=");
      const log = vi.spyOn(console, "error").mockImplementation(() => {});
      const prod = await portalCall("/portal/api/read", { via, cookie, env: { ...productionLike, RL_PORTAL_READ: undefined } });
      expect(prod.status).toBe(503);
      expect(await prod.json()).toEqual({ error: "service_unavailable" });
      expect(log).toHaveBeenCalledWith("[rate-limit] binding RL_PORTAL_READ is not configured; refusing the request");
      expect(runs.read).toBe(0);
      // Development has no edge: a missing binding is the in-memory counter, and the route runs.
      const devCookie = await portalSignedIn();
      expect((await portalCall("/portal/api/read", { via, cookie: devCookie, env: { RL_PORTAL_READ: undefined } })).status).toBe(200);
    });

    test("a route with no limiter named has none (me and the auth routes carry their own rules)", async () => {
      const cookie = await portalSignedIn();
      for (let i = 0; i < 80; i++) expect((await portalCall("/portal/api/plain", { via, cookie })).status).toBe(200);
    });
  });
});

describe("what a full run writes to the console", () => {
  test("no address, name, token, cookie or password appears in any log line, on success or on failure", async () => {
    const lines: string[] = [];
    for (const method of ["log", "info", "warn", "error", "debug"] as const) vi.spyOn(console, method).mockImplementation((...args: unknown[]) => void lines.push(args.map(String).join(" ")));
    fakeNetwork();

    const email = uniqueEmail("rahasia");
    const password = "kata-sandi-rahasia-123";
    const body = { email, password, name: "Nama Rahasia Siswa", callbackURL: "/portal/login?verified=1" };
    await portalCall("/portal/api/auth/register", { method: "POST", json: body, env: productionLike, captcha: CAPTCHA });
    await portalCall("/portal/api/auth/register", { method: "POST", json: body, env: productionLike, captcha: CAPTCHA }); // an existing address
    await portalCall("/portal/api/auth/register", { method: "POST", json: body, env: { ...productionLike, RESEND_API_KEY: "", EMAIL_FROM: "" }, captcha: CAPTCHA }); // 503: no provider
    await portalCall("/portal/api/auth/register", { method: "POST", json: { ...body, email: "not-an-email" }, env: productionLike, captcha: CAPTCHA }); // 400
    await portalCall("/portal/api/auth/sign-in/email", { method: "POST", json: { email, password: "wrong-password-1" }, env: productionLike, captcha: CAPTCHA }); // not verified / wrong
    await portalCall("/portal/api/auth/sign-in/email", { method: "POST", json: { email, password }, env: productionLike }); // no token: 403
    await portalCall("/portal/api/me", { cookie: "sakem-student.session_token=garbage-cookie-value" });
    await portalCall("/portal/api/auth/verify-email?token=garbage-token-value&callbackURL=%2Fportal%2Flogin");
    await portalCall("/portal/api/auth/reset-password/garbage-reset-token?callbackURL=%2Fportal%2Freset-password");
    await portalCall("/portal/api/auth/request-password-reset", { method: "POST", json: { email, redirectTo: "/portal/reset-password" }, env: productionLike, captcha: CAPTCHA });
    await portalCall("/portal/api/auth/sign-in/email", { method: "POST", json: { email: "x@example.test", password: "x" }, env: { ...productionLike, RL_LOGIN: undefined, RL_LOGIN_ACCOUNT: undefined } });

    const output = lines.join("\n");
    for (const secret of [email, password, "Nama Rahasia Siswa", "garbage-cookie-value", "garbage-token-value", "garbage-reset-token", "wrong-password-1", "token=", "re_fake_key_for_tests"]) {
      expect(output, secret).not.toContain(secret);
    }
    expect(PORTAL_ORIGIN).toBe("https://sakola.test");
  });
});
