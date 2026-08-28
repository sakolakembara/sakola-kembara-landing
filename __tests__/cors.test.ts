import { beforeEach, describe, expect, test, vi } from "vitest";

// lib/env freezes its parsed values at import time, so mock the module with
// a mutable object the tests can steer.
const { envMock } = vi.hoisted(() => ({
  envMock: {
    NODE_ENV: "test" as "development" | "production" | "test",
    SSO_ALLOWED_ORIGINS: undefined as string | undefined,
  },
}));
vi.mock("@/lib/env", () => ({ env: envMock }));

import { corsHeadersFor, isOriginAllowedForStateChange } from "@/lib/cors";

const LMS = "https://lms.sakolakembara.org";

function req(origin?: string): Request {
  return new Request("https://sakolakembara.org/api/sso/register", {
    method: "POST",
    headers: origin ? { origin } : {},
  });
}

beforeEach(() => {
  envMock.NODE_ENV = "test";
  envMock.SSO_ALLOWED_ORIGINS = undefined;
});

describe("isOriginAllowedForStateChange", () => {
  test("allows an allow-listed origin", () => {
    envMock.SSO_ALLOWED_ORIGINS = LMS;
    expect(isOriginAllowedForStateChange(req(LMS))).toBe(true);
  });

  test("rejects an origin outside the allow-list", () => {
    envMock.SSO_ALLOWED_ORIGINS = LMS;
    expect(isOriginAllowedForStateChange(req("https://evil.example"))).toBe(false);
  });

  test("rejects a missing Origin when an allow-list is configured", () => {
    envMock.SSO_ALLOWED_ORIGINS = LMS;
    expect(isOriginAllowedForStateChange(req())).toBe(false);
  });

  test("handles a comma-separated list with whitespace", () => {
    envMock.SSO_ALLOWED_ORIGINS = ` ${LMS} , https://lms.sakem.test:3100 `;
    expect(isOriginAllowedForStateChange(req("https://lms.sakem.test:3100"))).toBe(true);
  });

  test("an unset allow-list stays permissive outside production", () => {
    envMock.NODE_ENV = "development";
    expect(isOriginAllowedForStateChange(req())).toBe(true);
    expect(isOriginAllowedForStateChange(req("https://evil.example"))).toBe(true);
  });

  test("an unset allow-list FAILS CLOSED in production", () => {
    // These endpoints mint a session cookie, and Set-Cookie lands whether or
    // not CORS lets the attacker read the reply. A forgotten deploy variable
    // must not become open login-CSRF.
    envMock.NODE_ENV = "production";
    expect(isOriginAllowedForStateChange(req())).toBe(false);
    expect(isOriginAllowedForStateChange(req("https://evil.example"))).toBe(false);
    expect(isOriginAllowedForStateChange(req(LMS))).toBe(false);
  });
});

describe("corsHeadersFor", () => {
  test("echoes an allow-listed origin and allows credentials", () => {
    envMock.SSO_ALLOWED_ORIGINS = LMS;
    const h = corsHeadersFor(req(LMS));
    expect(h["Access-Control-Allow-Origin"]).toBe(LMS);
    expect(h["Access-Control-Allow-Credentials"]).toBe("true");
    expect(h["Vary"]).toBe("Origin");
  });

  test("never wildcards", () => {
    envMock.SSO_ALLOWED_ORIGINS = LMS;
    expect(corsHeadersFor(req(LMS))["Access-Control-Allow-Origin"]).not.toBe("*");
  });

  test("emits nothing for a disallowed origin", () => {
    envMock.SSO_ALLOWED_ORIGINS = LMS;
    expect(corsHeadersFor(req("https://evil.example"))).toEqual({});
  });

  test("emits nothing when there is no Origin header", () => {
    envMock.SSO_ALLOWED_ORIGINS = LMS;
    expect(corsHeadersFor(req())).toEqual({});
  });
});
