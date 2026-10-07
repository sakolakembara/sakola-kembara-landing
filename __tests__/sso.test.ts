import { beforeEach, describe, expect, test, vi } from "vitest";

// lib/env freezes its parsed values at import time, so vi.stubEnv can't
// change them after the fact. Mock the env module directly with a mutable
// object tests can mutate. vi.hoisted lets us define the object above
// the vi.mock hoisting so the factory can see it.
const { envMock } = vi.hoisted(() => ({
  envMock: {
    NODE_ENV: "test" as "development" | "production" | "test",
    SSO_JWT_SECRET:
      "test-secret-at-least-32-chars-long-XXXXXXXXX" as string | undefined,
    SSO_COOKIE_DOMAIN: undefined as string | undefined,
  },
}));
vi.mock("@/lib/env", () => ({ env: envMock }));

import {
  COOKIE_NAME,
  TOKEN_MAX_AGE_SECONDS,
  clearSsoCookieOptions,
  readSsoToken,
  signSsoToken,
  ssoClaimsEqual,
  ssoCookieOptions,
  verifySsoToken,
  type SsoClaims,
} from "@/lib/sso";
import { tamperSignature } from "./jwt-helpers";

const sampleClaims: SsoClaims = {
  sub: "44444444-4444-4444-4444-444444444444",
  email: "budi@example.com",
  name: "Budi Santoso",
  emailVerified: true,
  landingRole: "student",
  acceptedInBatches: ["11111111-1111-1111-1111-111111111111"],
};

beforeEach(() => {
  envMock.NODE_ENV = "test";
  envMock.SSO_JWT_SECRET = "test-secret-at-least-32-chars-long-XXXXXXXXX";
  envMock.SSO_COOKIE_DOMAIN = undefined;
});

describe("signSsoToken / readSsoToken", () => {
  test("roundtrips the claims", async () => {
    const token = await signSsoToken(sampleClaims);
    const parsed = await readSsoToken(token);
    expect(parsed).toEqual(sampleClaims);
  });

  test("returns null for an undefined token", async () => {
    expect(await readSsoToken(undefined)).toBeNull();
  });

  test("returns null for a garbage token", async () => {
    expect(await readSsoToken("not-a-jwt")).toBeNull();
  });

  test("returns null when tampered", async () => {
    const token = await signSsoToken(sampleClaims);
    expect(await readSsoToken(tamperSignature(token))).toBeNull();
  });

  test("returns null when signed with a different secret", async () => {
    const token = await signSsoToken(sampleClaims);
    envMock.SSO_JWT_SECRET = "different-secret-thats-32-chars-YYYYY-AAA";
    expect(await readSsoToken(token)).toBeNull();
  });

  test("returns null when SSO_JWT_SECRET is not configured", async () => {
    envMock.SSO_JWT_SECRET = undefined;
    expect(await readSsoToken("any-token")).toBeNull();
  });
});

describe("verifySsoToken", () => {
  test("exposes exp so a re-issue can preserve absolute expiry", async () => {
    const before = Math.floor(Date.now() / 1000);
    const token = await signSsoToken(sampleClaims);
    const verified = await verifySsoToken(token);
    expect(verified).not.toBeNull();
    expect(verified!.claims).toEqual(sampleClaims);
    // Default lifetime, within a second of now.
    expect(verified!.expiresAt).toBeGreaterThanOrEqual(
      before + TOKEN_MAX_AGE_SECONDS - 2,
    );
    expect(verified!.expiresAt).toBeLessThanOrEqual(
      before + TOKEN_MAX_AGE_SECONDS + 2,
    );
  });

  test("signSsoToken honours a pinned expiresAt instead of restarting the window", async () => {
    const pinned = Math.floor(Date.now() / 1000) + 600;
    const token = await signSsoToken(sampleClaims, { expiresAt: pinned });
    const verified = await verifySsoToken(token);
    expect(verified!.expiresAt).toBe(pinned);
  });

  test("rejects an already-expired token", async () => {
    const past = Math.floor(Date.now() / 1000) - 10;
    const token = await signSsoToken(sampleClaims, { expiresAt: past });
    expect(await verifySsoToken(token)).toBeNull();
  });
});

describe("ssoClaimsEqual", () => {
  test("true for identical claims", () => {
    expect(ssoClaimsEqual(sampleClaims, { ...sampleClaims })).toBe(true);
  });

  test("batch order does not count as a difference", () => {
    const a = { ...sampleClaims, acceptedInBatches: ["b-1", "b-2"] };
    const b = { ...sampleClaims, acceptedInBatches: ["b-2", "b-1"] };
    expect(ssoClaimsEqual(a, b)).toBe(true);
  });

  test.each([
    ["email", { email: "lain@example.com" }],
    ["name", { name: "Nama Lain" }],
    ["emailVerified", { emailVerified: false }],
    ["landingRole", { landingRole: "editor" as const }],
    ["a revoked acceptance", { acceptedInBatches: [] }],
    ["an added acceptance", { acceptedInBatches: ["b-1", "b-2", "b-3"] }],
  ])("false when %s changes", (_label, patch) => {
    expect(ssoClaimsEqual(sampleClaims, { ...sampleClaims, ...patch })).toBe(false);
  });
});

describe("ssoCookieOptions", () => {
  test("host-only when SSO_COOKIE_DOMAIN is unset", () => {
    const opts = ssoCookieOptions();
    expect(opts.name).toBe(COOKIE_NAME);
    expect(opts.httpOnly).toBe(true);
    expect(opts.sameSite).toBe("lax");
    expect(opts.path).toBe("/");
    expect(opts.maxAge).toBe(TOKEN_MAX_AGE_SECONDS);
    expect(opts.domain).toBeUndefined();
  });

  test("scoped to the configured parent domain", () => {
    envMock.SSO_COOKIE_DOMAIN = ".sakolakembara.org";
    const opts = ssoCookieOptions();
    expect(opts.domain).toBe(".sakolakembara.org");
  });

  test("insecure outside production, secure in production", () => {
    envMock.NODE_ENV = "development";
    expect(ssoCookieOptions().secure).toBe(false);
    envMock.NODE_ENV = "production";
    expect(ssoCookieOptions().secure).toBe(true);
  });
});

describe("clearSsoCookieOptions", () => {
  test("mirrors the setter but with maxAge 0", () => {
    envMock.SSO_COOKIE_DOMAIN = ".sakolakembara.org";
    const clear = clearSsoCookieOptions();
    expect(clear.name).toBe(COOKIE_NAME);
    expect(clear.domain).toBe(".sakolakembara.org");
    expect(clear.maxAge).toBe(0);
  });
});
