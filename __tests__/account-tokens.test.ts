import { beforeEach, describe, expect, test, vi } from "vitest";

const { envMock } = vi.hoisted(() => ({
  envMock: {
    AUTH_SECRET: "test-auth-secret-that-is-at-least-32-chars-long",
  },
}));
vi.mock("@/lib/env", () => ({ env: envMock }));

import {
  readAccountToken,
  signAccountToken,
  VERIFY_EMAIL_MAX_AGE_SECONDS,
} from "@/lib/account-tokens";

const sampleClaims = {
  sub: "11111111-1111-1111-1111-111111111111",
  email: "budi@example.com",
  purpose: "verify-email" as const,
};

beforeEach(() => {
  envMock.AUTH_SECRET = "test-auth-secret-that-is-at-least-32-chars-long";
});

describe("signAccountToken / readAccountToken", () => {
  test("roundtrips the verification claims", async () => {
    const token = await signAccountToken(sampleClaims);
    const parsed = await readAccountToken(token, "verify-email");
    expect(parsed).toEqual(sampleClaims);
  });

  test("roundtrips reset-password claims", async () => {
    const reset = { ...sampleClaims, purpose: "reset-password" as const };
    const token = await signAccountToken(reset);
    const parsed = await readAccountToken(token, "reset-password");
    expect(parsed).toEqual(reset);
  });

  test("rejects a verify-email token consumed as reset-password", async () => {
    // Wrong-purpose reuse is the class of bug that lets an attacker
    // trigger a password reset flow from a verification link.
    const token = await signAccountToken(sampleClaims);
    expect(await readAccountToken(token, "reset-password")).toBeNull();
  });

  test("returns null for undefined token", async () => {
    expect(await readAccountToken(undefined, "verify-email")).toBeNull();
  });

  test("returns null for garbage token", async () => {
    expect(await readAccountToken("not-a-jwt", "verify-email")).toBeNull();
  });

  test("returns null when tampered", async () => {
    const token = await signAccountToken(sampleClaims);
    const tampered = token.slice(0, -1) + (token.at(-1) === "A" ? "B" : "A");
    expect(await readAccountToken(tampered, "verify-email")).toBeNull();
  });

  test("returns null when signed with a different secret", async () => {
    const token = await signAccountToken(sampleClaims);
    envMock.AUTH_SECRET = "different-secret-thats-32-chars-YYYYY-AAA";
    expect(await readAccountToken(token, "verify-email")).toBeNull();
  });

  test("VERIFY_EMAIL_MAX_AGE_SECONDS is 24h", () => {
    expect(VERIFY_EMAIL_MAX_AGE_SECONDS).toBe(24 * 60 * 60);
  });
});
