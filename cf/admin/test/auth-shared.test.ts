import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, test } from "vitest";
import { ADMIN_AUDIENCE, STUDENT_AUDIENCE } from "../src/auth/audience";
import { authInstancesBuilt, mayCarrySession, sharedAuth } from "../src/auth/session";
import type { Bindings } from "../src/env";
import portalWorker from "../src/portal/worker";
import worker from "../src/worker";
import { getDb } from "../src/db/client";
import { call, createVerifiedUser, emailsTo, ORIGIN, signedInCookie, uniqueEmail } from "./helpers";
import { limiterBindings } from "./limiter-clock";
import { createVerifiedStudent, PORTAL_ORIGIN, PORTAL_SECRET, portalCall, portalSignedIn } from "./portal-helpers";

// The Better Auth instance is built once per isolate instead of once per request, and a request that cannot carry a
// session never asks it (SAKEM-091, docs/cloudflare/free-plan-audit.md "CPU on the hot routes"). What must not change
// is every property of the session path: these tests pin what the shortcut skips, what it must not skip, and that the
// shared instance still hands each request's background work to that request.

/** A call that cannot reuse a Better Auth built before: one text variable of the environment is new. */
let unique = 0;
const freshKey = (): Partial<Bindings> => ({ AUDIT_RETENTION_DAYS: `shared-${(unique += 1)}` });

describe("mayCarrySession: only a Cookie header that names a session_token can hold a session", () => {
  test.each([
    [null, false],
    ["", false],
    ["theme=dark", false],
    ["a=1; b=2", false],
    ["better-auth.session_token=abc.def", true],
    ["__Secure-better-auth.session_token=abc.def", true],
    ["__Host-better-auth.session_token=abc.def", true],
    ["theme=dark; better-auth.session_token=abc.def; a=1", true],
    // Anything that looks like it goes to Better Auth, which checks the signature and D1 as before.
    ["x=session_token", true],
  ])("%j -> %j", (cookie, expected) => {
    const headers = new Headers();
    if (cookie !== null) headers.set("cookie", cookie);
    expect(mayCarrySession(headers)).toBe(expected);
  });
});

describe("a request without a session cookie never builds or asks Better Auth", () => {
  // Negative check: `mayCarrySession` always true in src/auth/session.ts, and the count below moves.
  test.each(["/api/me", "/api/dashboard", "/api/admin/blog", "/api/admin/messages", "/api/admin/team"])("%s answers 401 and builds nothing", async (path) => {
    const before = authInstancesBuilt();
    const none = await call(path, { env: freshKey() });
    expect(none.status).toBe(401);
    expect(await none.json()).toEqual({ error: "unauthenticated" });
    const unrelated = await call(path, { env: freshKey(), cookie: "theme=dark; a=1" });
    expect(unrelated.status).toBe(401);
    expect(authInstancesBuilt()).toBe(before);
  });

  // Negative check: the same line removed in the other direction (`return null` for any cookie) and the 200 below fails.
  test("a request that does carry a session cookie still goes to Better Auth, and a forged one is a 401", async () => {
    const before = authInstancesBuilt();
    const forged = await call("/api/me", { env: freshKey(), cookie: "better-auth.session_token=forged.signature" });
    expect(forged.status).toBe(401);
    expect(authInstancesBuilt()).toBe(before + 1);

    const cookie = await signedInCookie(uniqueEmail("shared"), "super_admin");
    const me = await call("/api/me", { cookie });
    expect(me.status).toBe(200);
    expect(((await me.json()) as { user: { role: string } }).user.role).toBe("super_admin");
  });

  test("the answer without a cookie is the one Better Auth gives (same status, same body) for a signed-out visitor", async () => {
    const shortcut = await call("/api/me", { env: freshKey() });
    const viaBetterAuth = await call("/api/me", { env: freshKey(), cookie: "better-auth.session_token=expired.or.unknown" });
    expect(shortcut.status).toBe(viaBetterAuth.status);
    expect(await shortcut.json()).toEqual(await viaBetterAuth.json());
  });
});

describe("one Better Auth per (D1 binding, text configuration, origin)", () => {
  // A binding of its own per test: the number of instances kept is per binding, and nothing here queries it.
  let fakeDb: D1Database;
  beforeEach(() => {
    fakeDb = {} as D1Database;
  });
  const bindings = () => ({ ...env, ...limiterBindings(), DB: fakeDb }) as Bindings;

  test("the same configuration and origin share one instance, across separately built environments", () => {
    const a = sharedAuth(bindings(), "https://admin.shared-one.test");
    const b = sharedAuth(bindings(), "https://admin.shared-one.test");
    expect(b).toBe(a);
  });

  test("another origin, or any changed text variable or secret, is another instance", () => {
    const base = sharedAuth(bindings(), "https://admin.shared-two.test");
    expect(sharedAuth(bindings(), "https://other.shared-two.test")).not.toBe(base);
    for (const change of [{ BETTER_AUTH_SECRET: "another-secret-0123456789-abcdefghijklmnop" }, { TRUSTED_ORIGINS: "https://x.test" }, { COOKIE_DOMAIN: ".shared-two.test" }, { ENVIRONMENT: "production" }, { GOOGLE_CLIENT_ID: "id" }, { RESEND_API_KEY: "re_other" }, { EMAIL_FROM: "Other <o@example.test>" }]) {
      expect(sharedAuth({ ...bindings(), ...change } as Bindings, "https://admin.shared-two.test")).not.toBe(base);
    }
  });

  test("a request can name any Host, so the number kept is capped: past it an instance serves one request and is dropped", () => {
    const kept = Array.from({ length: 8 }, (_, i) => sharedAuth(bindings(), `https://cap-${i}.shared-three.test`));
    const first = sharedAuth(bindings(), "https://cap-0.shared-three.test");
    expect(first).toBe(kept[0]);
    const beyond = sharedAuth(bindings(), "https://cap-8.shared-three.test");
    expect(sharedAuth(bindings(), "https://cap-8.shared-three.test")).not.toBe(beyond);
  });

  test("the Drizzle instance is shared per D1 binding too", () => {
    expect(getDb(env.DB)).toBe(getDb(env.DB));
  });

  test("background work asked for outside a request is not a crash, and the work still runs", async () => {
    const auth = sharedAuth(bindings(), "https://admin.shared-four.test");
    let ran = false;
    const handler = auth.options.advanced!.backgroundTasks!.handler!;
    expect(() => handler(Promise.resolve().then(() => void (ran = true)))).not.toThrow();
    await Promise.resolve();
    await Promise.resolve();
    expect(ran).toBe(true);
  });
});

describe("the shared instance hands each request's background work to that request", () => {
  /** An execution context that records what was handed to `waitUntil`. */
  function recordingContext() {
    const promises: Promise<unknown>[] = [];
    const ctx = {
      waitUntil: (promise: Promise<unknown>) => void promises.push(promise),
      passThroughOnException() {},
      props: {},
    } as unknown as ExecutionContext;
    return { ctx, promises };
  }

  function requestReset(email: string, ctx: ExecutionContext) {
    return worker.fetch!(
      new Request(`${ORIGIN}/api/auth/request-password-reset`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: ORIGIN, "cf-connecting-ip": `203.0.113.${(unique += 1) % 250}` },
        body: JSON.stringify({ email, redirectTo: "/reset-password" }),
      }) as never,
      { ...env, ...limiterBindings() } as Bindings,
      ctx,
    );
  }

  // Negative check: have `waitUntilOfCurrentRequest` use one fixed context and one of the two counts below is zero.
  test("two overlapping requests with two contexts: each context gets the email of its own request", async () => {
    const first = uniqueEmail("overlap-a");
    const second = uniqueEmail("overlap-b");
    await createVerifiedUser(first);
    await createVerifiedUser(second);

    const a = recordingContext();
    const b = recordingContext();
    const [responseA, responseB] = await Promise.all([requestReset(first, a.ctx), requestReset(second, b.ctx)]);
    expect(responseA.status).toBe(200);
    expect(responseB.status).toBe(200);

    // Each request handed its after-the-response work to its own context: both have some, and the same amount (a
    // shared "current context" would give one of them everything and the other nothing).
    expect(a.promises.length).toBeGreaterThan(0);
    expect(b.promises.length).toBe(a.promises.length);
    await Promise.all([...a.promises, ...b.promises]);
    const resets = (address: string) => emailsTo(address).filter((message) => message.purpose === "reset-password");
    expect(resets(first)).toHaveLength(1);
    expect(resets(second)).toHaveLength(1);
  });
});

// The portal Worker (SAKEM-083) mounts the same context for the student audience (src/portal/auth-context.ts): it
// gets the shared instance and the no-cookie shortcut too, and the two audiences never share an instance.
describe("the portal's student audience: its own shared instance, never the admin's", () => {
  // Negative check: leave the audience out of the key in src/auth/session.ts and the two below are one instance.
  test("the audience is part of the key: same binding, environment and origin, two instances, each its own mount point and cookie", () => {
    const bindings = { ...env, ...limiterBindings(), DB: {} as D1Database } as Bindings;
    const origin = "https://sakola.shared-five.test";
    const admin = sharedAuth(bindings, origin);
    const student = sharedAuth(bindings, origin, STUDENT_AUDIENCE);
    expect(student).not.toBe(admin);
    expect(sharedAuth(bindings, origin, ADMIN_AUDIENCE)).toBe(admin);
    expect(sharedAuth(bindings, origin, STUDENT_AUDIENCE)).toBe(student);
    expect(admin.options.basePath).toBe("/api/auth");
    expect(admin.options.advanced?.cookiePrefix).toBe("better-auth");
    expect(student.options.basePath).toBe("/portal/api/auth");
    expect(student.options.advanced?.cookiePrefix).toBe("sakem-student");
  });

  test("a portal request without the student cookie builds nothing (the admin's cookie is another name); with it, one instance serves them all", async () => {
    const config = freshKey();
    const before = authInstancesBuilt();
    expect((await portalCall("/portal/api/me", { env: config })).status).toBe(401);
    expect((await portalCall("/portal/api/me", { env: config, cookie: "better-auth.session_token=forged.signature" })).status).toBe(401);
    expect(authInstancesBuilt()).toBe(before);

    for (let i = 0; i < 3; i += 1) {
      expect((await portalCall("/portal/api/me", { env: config, cookie: "sakem-student.session_token=forged.signature" })).status).toBe(401);
    }
    expect(authInstancesBuilt()).toBe(before + 1);
  });

  test("a student's session is read on every call from the shared instance, and sign-out ends it", async () => {
    const cookie = await portalSignedIn(uniqueEmail("siswa-shared"));
    const again = await portalCall("/portal/api/me", { cookie });
    expect(again.status).toBe(200);
    expect(((await again.json()) as { user: { role: string } }).user.role).toBe("student");
    const out = await portalCall("/portal/api/auth/sign-out", { method: "POST", cookie, json: {} });
    expect(out.status).toBe(200);
    expect((await portalCall("/portal/api/me", { cookie })).status).toBe(401);
  });

  // Negative check: the same fixed context as the admin's (see above), through the portal's context.
  test("two overlapping portal requests with two contexts: each context gets the email of its own request", async () => {
    const first = uniqueEmail("portal-overlap-a");
    const second = uniqueEmail("portal-overlap-b");
    await createVerifiedStudent(first);
    await createVerifiedStudent(second);

    const reset = (email: string) => {
      const promises: Promise<unknown>[] = [];
      const ctx = { waitUntil: (promise: Promise<unknown>) => void promises.push(promise), passThroughOnException() {}, props: {} } as unknown as ExecutionContext;
      const response = portalWorker.fetch!(
        new Request(`${PORTAL_ORIGIN}/portal/api/auth/request-password-reset`, {
          method: "POST",
          headers: { "content-type": "application/json", origin: PORTAL_ORIGIN, "cf-connecting-ip": `203.0.113.${(unique += 1) % 250}` },
          body: JSON.stringify({ email, redirectTo: "/portal/reset-password" }),
        }) as never,
        { ...env, BETTER_AUTH_SECRET: PORTAL_SECRET, ...limiterBindings() } as Bindings,
        ctx,
      );
      return { response, promises };
    };
    const a = reset(first);
    const b = reset(second);
    const [responseA, responseB] = await Promise.all([a.response, b.response]);
    expect(responseA.status).toBe(200);
    expect(responseB.status).toBe(200);
    expect(a.promises.length).toBeGreaterThan(0);
    expect(b.promises.length).toBe(a.promises.length);
    await Promise.all([...a.promises, ...b.promises]);
    const resets = (address: string) => emailsTo(address).filter((message) => message.purpose === "reset-password");
    expect(resets(first)).toHaveLength(1);
    expect(resets(second)).toHaveLength(1);
  });
});
