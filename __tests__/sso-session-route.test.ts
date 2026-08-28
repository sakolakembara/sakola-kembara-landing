import { beforeEach, describe, expect, test, vi } from "vitest";

// lib/env is frozen at import time; mock it so the route and lib/sso agree
// on a signing secret.
const { envMock } = vi.hoisted(() => ({
  envMock: {
    NODE_ENV: "test" as "development" | "production" | "test",
    SSO_JWT_SECRET: "test-secret-at-least-32-chars-long-XXXXXXXXX" as
      | string
      | undefined,
    SSO_COOKIE_DOMAIN: undefined as string | undefined,
    SSO_ALLOWED_ORIGINS: undefined as string | undefined,
  },
}));
vi.mock("@/lib/env", () => ({ env: envMock }));

// Minimal cookie jar standing in for next/headers.
const { jar } = vi.hoisted(() => ({
  jar: new Map<string, { value: string; maxAge?: number }>(),
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => {
      const hit = jar.get(name);
      return hit ? { name, value: hit.value } : undefined;
    },
    set: (opts: { name: string; value: string; maxAge?: number }) => {
      jar.set(opts.name, { value: opts.value, maxAge: opts.maxAge });
    },
  }),
}));

const buildSsoClaimsMock = vi.fn();
vi.mock("@/lib/sso-claims", () => ({
  buildSsoClaims: (...args: unknown[]) => buildSsoClaimsMock(...args),
}));

import { GET } from "@/app/api/sso/session/route";
import {
  COOKIE_NAME,
  signSsoToken,
  verifySsoToken,
  type SsoClaims,
} from "@/lib/sso";

const SUB = "44444444-4444-4444-4444-444444444444";

const tokenClaims: SsoClaims = {
  sub: SUB,
  email: "budi@example.com",
  name: "Budi Santoso",
  emailVerified: false,
  landingRole: "student",
  acceptedInBatches: ["batch-2025"],
};

function request(): Request {
  return new Request("https://sakolakembara.org/api/sso/session");
}

async function seedCookie(
  claims: SsoClaims = tokenClaims,
  opts?: { expiresAt?: number },
) {
  jar.set(COOKIE_NAME, { value: await signSsoToken(claims, opts) });
}

beforeEach(() => {
  vi.clearAllMocks();
  jar.clear();
  envMock.NODE_ENV = "test";
  envMock.SSO_JWT_SECRET = "test-secret-at-least-32-chars-long-XXXXXXXXX";
});

describe("GET /api/sso/session", () => {
  test("reports unauthenticated with no cookie, without querying the DB", async () => {
    const body = await (await GET(request())).json();
    expect(body).toEqual({ authenticated: false });
    expect(buildSsoClaimsMock).not.toHaveBeenCalled();
  });

  test("reports unauthenticated for a forged cookie, without querying the DB", async () => {
    // Signature verification must gate the DB read — that is what keeps this
    // endpoint safe to leave unthrottled.
    jar.set(COOKIE_NAME, { value: "not.a.jwt" });
    const body = await (await GET(request())).json();
    expect(body).toEqual({ authenticated: false });
    expect(buildSsoClaimsMock).not.toHaveBeenCalled();
  });

  test("returns LIVE claims, not the snapshot baked into the cookie", async () => {
    // The regression this endpoint exists to prevent: acceptance revoked and
    // email verified since sign-in. Answering from the cookie would keep
    // granting course access for up to 30 days.
    await seedCookie();
    buildSsoClaimsMock.mockResolvedValueOnce({
      ...tokenClaims,
      emailVerified: true,
      acceptedInBatches: [],
    });

    const body = await (await GET(request())).json();
    expect(body.authenticated).toBe(true);
    expect(body.user.acceptedInBatches).toEqual([]);
    expect(body.user.emailVerified).toBe(true);
    expect(buildSsoClaimsMock).toHaveBeenCalledWith(SUB);
  });

  test("writes the refreshed claims back to the cookie", async () => {
    await seedCookie();
    const fresh = { ...tokenClaims, acceptedInBatches: [] };
    buildSsoClaimsMock.mockResolvedValueOnce(fresh);

    await GET(request());

    const rewritten = await verifySsoToken(jar.get(COOKIE_NAME)!.value);
    expect(rewritten!.claims.acceptedInBatches).toEqual([]);
  });

  test("refreshing preserves absolute expiry instead of extending it", async () => {
    const pinned = Math.floor(Date.now() / 1000) + 3600;
    await seedCookie(tokenClaims, { expiresAt: pinned });
    buildSsoClaimsMock.mockResolvedValueOnce({
      ...tokenClaims,
      acceptedInBatches: [],
    });

    await GET(request());

    const rewritten = await verifySsoToken(jar.get(COOKIE_NAME)!.value);
    expect(rewritten!.expiresAt).toBe(pinned);
    // maxAge tracks the remaining window, not a fresh 30 days.
    expect(jar.get(COOKIE_NAME)!.maxAge).toBeLessThanOrEqual(3600);
    expect(jar.get(COOKIE_NAME)!.maxAge).toBeGreaterThan(3500);
  });

  test("leaves the cookie untouched when nothing changed", async () => {
    await seedCookie();
    const before = jar.get(COOKIE_NAME)!.value;
    buildSsoClaimsMock.mockResolvedValueOnce({ ...tokenClaims });

    await GET(request());

    expect(jar.get(COOKIE_NAME)!.value).toBe(before);
  });

  test("clears the cookie and denies when the user no longer exists", async () => {
    await seedCookie();
    buildSsoClaimsMock.mockResolvedValueOnce(null);

    const body = await (await GET(request())).json();
    expect(body).toEqual({ authenticated: false });
    expect(jar.get(COOKIE_NAME)!.value).toBe("");
    expect(jar.get(COOKIE_NAME)!.maxAge).toBe(0);
  });

  test("never caches the response", async () => {
    const res = await GET(request());
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
  });

  test("omits CORS headers for an origin that is not allow-listed", async () => {
    envMock.SSO_ALLOWED_ORIGINS = "https://lms.sakolakembara.org";
    const res = await GET(
      new Request("https://sakolakembara.org/api/sso/session", {
        headers: { origin: "https://evil.example" },
      }),
    );
    expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });
});
