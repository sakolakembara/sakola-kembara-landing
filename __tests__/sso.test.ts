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
  ssoCookieOptions,
  type SsoClaims,
} from "@/lib/sso";

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
    // Flip the last character of the signature.
    const tampered = token.slice(0, -1) + (token.at(-1) === "A" ? "B" : "A");
    expect(await readSsoToken(tampered)).toBeNull();
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
