import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { inspect } from "node:util";

// Covers how outbound email behaves with and without a provider key:
//   - production without RESEND_API_KEY: nothing is sent, `{ ok: false }` is
//     returned, and no tokenized URL (or recipient) reaches the logs;
//   - non-production without a key: the console fallback still works;
//   - callers (verification helper, resend route, forgot-password action)
//     surface or swallow the failure as designed.
//
// lib/email.ts creates its vendor client at import time, so each scenario
// resets the module registry and re-imports after setting the env.

const { envMock, resendSendMock, findFirstMock, rateLimitMock } = vi.hoisted(
  () => ({
    envMock: {
      NODE_ENV: "production" as "development" | "production" | "test",
      AUTH_SECRET: "test-auth-secret-that-is-at-least-32-chars-long",
      APP_URL: "https://sakolakembara.org",
      NEXTAUTH_URL: "https://sakolakembara.org",
      RESEND_API_KEY: undefined as string | undefined,
      EMAIL_FROM: "Sakola Kembara <no-reply@example.test>",
    },
    resendSendMock: vi.fn(),
    findFirstMock: vi.fn(),
    rateLimitMock: vi.fn(),
  }),
);
vi.mock("@/lib/env", () => ({ env: envMock }));

vi.mock("resend", () => ({
  Resend: class {
    emails = { send: (...args: unknown[]) => resendSendMock(...args) };
  },
}));

vi.mock("@/lib/db", () => ({
  db: { query: { users: { findFirst: findFirstMock } }, update: vi.fn() },
}));
vi.mock("@/lib/rate-limit", () => ({
  rateLimit: (...args: unknown[]) => rateLimitMock(...args),
}));
vi.mock("@/auth", () => ({
  auth: async () => ({ user: { email: "budi@example.com" } }),
}));

const TOKEN_URL =
  "https://sakolakembara.org/reset-password?token=live-token-value-123";
const RECIPIENT = "budi@example.com";

const consoleSpies = (["log", "info", "warn", "error", "debug"] as const).map(
  (method) => vi.spyOn(console, method),
);

/** Everything written through console.*, flattened to one string. */
function loggedOutput(): string {
  return consoleSpies
    .flatMap((spy) => spy.mock.calls)
    .flat()
    .map((arg) => (typeof arg === "string" ? arg : inspect(arg, { depth: 5 })))
    .join("\n");
}

async function loadEmail() {
  vi.resetModules();
  return import("@/lib/email");
}

beforeEach(() => {
  vi.clearAllMocks();
  consoleSpies.forEach((spy) => spy.mockImplementation(() => {}));
  envMock.NODE_ENV = "production";
  envMock.RESEND_API_KEY = undefined;
  rateLimitMock.mockResolvedValue({
    allowed: true,
    count: 1,
    limit: 2,
    resetAt: Date.now() + 60_000,
  });
});

afterEach(() => {
  consoleSpies.forEach((spy) => spy.mockReset());
});

// ─── lib/email.ts ──────────────────────────────────────────────────────

describe("send in production without RESEND_API_KEY", () => {
  test("password reset: returns ok:false, sends nothing, logs no URL", async () => {
    const { sendPasswordResetEmail } = await loadEmail();

    const result = await sendPasswordResetEmail(RECIPIENT, TOKEN_URL);

    expect(result).toEqual({ ok: false, reason: "provider_not_configured" });
    expect(resendSendMock).not.toHaveBeenCalled();
    const out = loggedOutput();
    expect(out).toContain("RESEND_API_KEY");
    expect(out).not.toContain("live-token-value-123");
    expect(out).not.toContain("reset-password?token");
    expect(out).not.toContain(RECIPIENT);
  });

  test("verification: returns ok:false, sends nothing, logs no URL", async () => {
    const { sendVerificationEmail } = await loadEmail();

    const result = await sendVerificationEmail(
      RECIPIENT,
      "https://sakolakembara.org/verify-email?token=live-token-value-456",
    );

    expect(result).toEqual({ ok: false, reason: "provider_not_configured" });
    expect(resendSendMock).not.toHaveBeenCalled();
    const out = loggedOutput();
    expect(out).not.toContain("live-token-value-456");
    expect(out).not.toContain("verify-email?token");
    expect(out).not.toContain(RECIPIENT);
  });
});

describe("send outside production without RESEND_API_KEY", () => {
  test.each(["development", "test"] as const)(
    "%s: keeps the console fallback and reports ok",
    async (nodeEnv) => {
      envMock.NODE_ENV = nodeEnv;
      const { sendPasswordResetEmail } = await loadEmail();

      const result = await sendPasswordResetEmail(RECIPIENT, TOKEN_URL);

      expect(result).toEqual({ ok: true, reason: "logged_to_console" });
      expect(resendSendMock).not.toHaveBeenCalled();
      expect(loggedOutput()).toContain("live-token-value-123");
    },
  );
});

describe("send in production with RESEND_API_KEY", () => {
  beforeEach(() => {
    envMock.RESEND_API_KEY = "re_test_key";
  });

  test("hands the message to the vendor and returns its id", async () => {
    resendSendMock.mockResolvedValueOnce({ data: { id: "msg_1" }, error: null });
    const { sendPasswordResetEmail } = await loadEmail();

    const result = await sendPasswordResetEmail(RECIPIENT, TOKEN_URL);

    expect(result).toEqual({ ok: true, id: "msg_1" });
    expect(resendSendMock).toHaveBeenCalledTimes(1);
    expect(loggedOutput()).not.toContain("live-token-value-123");
  });

  test("vendor rejection returns ok:false without logging the URL", async () => {
    resendSendMock.mockResolvedValueOnce({
      data: null,
      error: { name: "validation_error", message: "rejected", statusCode: 422 },
    });
    const { sendPasswordResetEmail } = await loadEmail();

    const result = await sendPasswordResetEmail(RECIPIENT, TOKEN_URL);

    expect(result).toEqual({ ok: false, reason: "rejected" });
    expect(loggedOutput()).not.toContain("live-token-value-123");
  });
});

// ─── Callers ───────────────────────────────────────────────────────────

describe("sendUserVerificationEmail in production without a key", () => {
  test("reports failure and logs no token", async () => {
    vi.resetModules();
    const { sendUserVerificationEmail } = await import(
      "@/lib/verification-flow"
    );

    const ok = await sendUserVerificationEmail("user-1", RECIPIENT);

    expect(ok).toBe(false);
    expect(resendSendMock).not.toHaveBeenCalled();
    const out = loggedOutput();
    expect(out).toContain("provider_not_configured");
    // Signed tokens are JWTs ("eyJ…") carried in a `token=` query param.
    expect(out).not.toContain("token=");
    expect(out).not.toContain("eyJ");
    expect(out).not.toContain(RECIPIENT);
  });

  test("still reports success through the console fallback outside production", async () => {
    envMock.NODE_ENV = "development";
    vi.resetModules();
    const { sendUserVerificationEmail } = await import(
      "@/lib/verification-flow"
    );

    expect(await sendUserVerificationEmail("user-1", RECIPIENT)).toBe(true);
  });
});

describe("POST /api/account/resend-verification", () => {
  const unverifiedUser = {
    id: "user-1",
    email: RECIPIENT,
    emailVerifiedAt: null,
  };

  test("answers 502 with ok:false in production without a key", async () => {
    findFirstMock.mockResolvedValueOnce(unverifiedUser);
    vi.resetModules();
    const { POST } = await import("@/app/api/account/resend-verification/route");

    const res = await POST();

    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ ok: false });
    expect(loggedOutput()).not.toContain("token=");
  });

  test("answers 200 with ok:true when the send succeeds", async () => {
    envMock.RESEND_API_KEY = "re_test_key";
    resendSendMock.mockResolvedValueOnce({ data: { id: "msg_2" }, error: null });
    findFirstMock.mockResolvedValueOnce(unverifiedUser);
    vi.resetModules();
    const { POST } = await import("@/app/api/account/resend-verification/route");

    const res = await POST();

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });
});

describe("forgot-password action in production without a key", () => {
  const verifiedUser = {
    id: "user-1",
    email: RECIPIENT,
    passwordHash: "$2b$10$abc",
    emailVerifiedAt: new Date(),
  };

  function formFor(email: string): FormData {
    const form = new FormData();
    form.set("email", email);
    form.set("website", "");
    return form;
  }

  test("answers a registered email exactly like an unknown one, and logs no token", async () => {
    vi.resetModules();
    const { requestPasswordResetAction } = await import(
      "@/app/(auth)/forgot-password/actions"
    );

    findFirstMock.mockResolvedValueOnce(verifiedUser);
    const known = await requestPasswordResetAction(
      { status: "idle" },
      formFor(RECIPIENT),
    );

    findFirstMock.mockResolvedValueOnce(null);
    const unknown = await requestPasswordResetAction(
      { status: "idle" },
      formFor("ghost@example.com"),
    );

    expect(known).toEqual(unknown);
    expect(known.status).toBe("success");
    expect(resendSendMock).not.toHaveBeenCalled();
    const out = loggedOutput();
    expect(out).not.toContain("token=");
    expect(out).not.toContain("eyJ");
  });
});
