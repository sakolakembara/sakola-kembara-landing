import { beforeEach, describe, expect, test, vi } from "vitest";

const { envMock } = vi.hoisted(() => ({
  envMock: {
    AUTH_SECRET: "test-auth-secret-that-is-at-least-32-chars-long",
    APP_URL: "http://localhost:3000",
    NEXTAUTH_URL: "http://localhost:3000",
    RESEND_API_KEY: undefined as string | undefined,
    EMAIL_FROM: "test@example.com",
  },
}));
vi.mock("@/lib/env", () => ({ env: envMock }));

vi.mock("@/lib/db", () => ({
  db: {
    query: {
      users: { findFirst: vi.fn() },
    },
    update: vi.fn(),
  },
}));

const sendPasswordResetEmailMock = vi.fn();
vi.mock("@/lib/email", () => ({
  sendPasswordResetEmail: (...args: unknown[]) =>
    sendPasswordResetEmailMock(...args),
  sendVerificationEmail: vi.fn(),
}));

import { db } from "@/lib/db";
import {
  requestPasswordReset,
  resetPasswordByToken,
  verifyEmailByToken,
} from "@/lib/account-service";
import { signAccountToken } from "@/lib/account-tokens";

const dbMock = db as unknown as {
  query: { users: { findFirst: ReturnType<typeof vi.fn> } };
  update: ReturnType<typeof vi.fn>;
};

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── verifyEmailByToken ────────────────────────────────────────────────

describe("verifyEmailByToken", () => {
  test("rejects an invalid token", async () => {
    expect(await verifyEmailByToken("garbage")).toEqual({
      ok: false,
      reason: "invalid_token",
    });
  });

  test("rejects when the user no longer exists", async () => {
    const token = await signAccountToken({
      sub: "ghost",
      email: "ghost@example.com",
      purpose: "verify-email",
    });
    dbMock.query.users.findFirst.mockResolvedValueOnce(null);
    expect(await verifyEmailByToken(token)).toEqual({
      ok: false,
      reason: "user_not_found",
    });
  });

  test("rejects when the email has changed since the token was issued", async () => {
    const token = await signAccountToken({
      sub: "u-1",
      email: "old@example.com",
      purpose: "verify-email",
    });
    dbMock.query.users.findFirst.mockResolvedValueOnce({
      id: "u-1",
      email: "new@example.com",
      emailVerifiedAt: null,
    });
    expect(await verifyEmailByToken(token)).toEqual({
      ok: false,
      reason: "email_changed",
    });
  });

  test("is idempotent — succeeds on already-verified account", async () => {
    const token = await signAccountToken({
      sub: "u-2",
      email: "budi@example.com",
      purpose: "verify-email",
    });
    dbMock.query.users.findFirst.mockResolvedValueOnce({
      id: "u-2",
      email: "budi@example.com",
      emailVerifiedAt: new Date(),
    });
    expect(await verifyEmailByToken(token)).toEqual({ ok: true });
    expect(dbMock.update).not.toHaveBeenCalled();
  });

  test("flips emailVerifiedAt on happy path", async () => {
    const token = await signAccountToken({
      sub: "u-3",
      email: "siti@example.com",
      purpose: "verify-email",
    });
    dbMock.query.users.findFirst.mockResolvedValueOnce({
      id: "u-3",
      email: "siti@example.com",
      emailVerifiedAt: null,
    });
    dbMock.update.mockImplementationOnce(() => ({
      set: vi.fn().mockReturnThis(),
      where: vi.fn().mockResolvedValue(undefined),
    }));
    expect(await verifyEmailByToken(token)).toEqual({ ok: true });
    const setCall = (dbMock.update.mock.results[0]!.value as {
      set: ReturnType<typeof vi.fn>;
    }).set.mock.calls[0][0];
    expect(setCall.emailVerifiedAt).toBeInstanceOf(Date);
  });
});

// ─── requestPasswordReset ───────────────────────────────────────────────

describe("requestPasswordReset", () => {
  test("silent on unknown email (no send, no throw)", async () => {
    dbMock.query.users.findFirst.mockResolvedValueOnce(null);
    await requestPasswordReset("ghost@example.com");
    expect(sendPasswordResetEmailMock).not.toHaveBeenCalled();
  });

  test("silent on Google-only account (no password hash)", async () => {
    dbMock.query.users.findFirst.mockResolvedValueOnce({
      id: "u-1",
      email: "g@example.com",
      passwordHash: null,
      emailVerifiedAt: new Date(),
    });
    await requestPasswordReset("g@example.com");
    expect(sendPasswordResetEmailMock).not.toHaveBeenCalled();
  });

  test("silent on unverified account (squatter defense)", async () => {
    dbMock.query.users.findFirst.mockResolvedValueOnce({
      id: "u-2",
      email: "unverified@example.com",
      passwordHash: "$2b$10$abc",
      emailVerifiedAt: null,
    });
    await requestPasswordReset("unverified@example.com");
    expect(sendPasswordResetEmailMock).not.toHaveBeenCalled();
  });

  test("sends when the account exists, has a password, and is verified", async () => {
    dbMock.query.users.findFirst.mockResolvedValueOnce({
      id: "u-3",
      email: "budi@example.com",
      passwordHash: "$2b$10$abc",
      emailVerifiedAt: new Date(),
    });
    sendPasswordResetEmailMock.mockResolvedValueOnce({ ok: true });
    await requestPasswordReset("budi@example.com");
    expect(sendPasswordResetEmailMock).toHaveBeenCalledWith(
      "budi@example.com",
      expect.stringContaining("/reset-password?token="),
    );
  });
});

// ─── resetPasswordByToken ───────────────────────────────────────────────

describe("resetPasswordByToken", () => {
  test("rejects a weak password before token check", async () => {
    expect(await resetPasswordByToken("any-token", "short")).toEqual({
      ok: false,
      reason: "weak_password",
    });
  });

  test("rejects an invalid token", async () => {
    expect(await resetPasswordByToken("garbage", "brand-new-pass")).toEqual({
      ok: false,
      reason: "invalid_token",
    });
  });

  test("rejects when email has changed", async () => {
    const token = await signAccountToken({
      sub: "u-1",
      email: "old@example.com",
      purpose: "reset-password",
    });
    dbMock.query.users.findFirst.mockResolvedValueOnce({
      id: "u-1",
      email: "new@example.com",
    });
    expect(await resetPasswordByToken(token, "brand-new-pass")).toEqual({
      ok: false,
      reason: "email_changed",
    });
  });

  test("writes a bcrypt hash on happy path", async () => {
    const token = await signAccountToken({
      sub: "u-2",
      email: "budi@example.com",
      purpose: "reset-password",
    });
    dbMock.query.users.findFirst.mockResolvedValueOnce({
      id: "u-2",
      email: "budi@example.com",
    });
    dbMock.update.mockImplementationOnce(() => ({
      set: vi.fn().mockReturnThis(),
      where: vi.fn().mockResolvedValue(undefined),
    }));
    const r = await resetPasswordByToken(token, "brand-new-pass");
    expect(r).toEqual({ ok: true, email: "budi@example.com" });
    const setCall = (dbMock.update.mock.results[0]!.value as {
      set: ReturnType<typeof vi.fn>;
    }).set.mock.calls[0][0];
    expect(setCall.passwordHash).toMatch(/^\$2[aby]\$/);
  });
});
