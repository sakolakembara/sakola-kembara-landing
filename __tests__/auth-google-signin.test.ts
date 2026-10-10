import { beforeEach, describe, expect, test, vi } from "vitest";

// Exercises the Google branch of the `signIn` callback in auth.ts with the
// NextAuth factory and the database mocked at the module boundary, so the
// wiring between the callback and decideGoogleLink is covered too.

const { captured } = vi.hoisted(() => ({
  captured: { config: null as null | { callbacks: Record<string, unknown> } },
}));

vi.mock("next-auth", () => ({
  default: (config: { callbacks: Record<string, unknown> }) => {
    captured.config = config;
    return { handlers: {}, auth: vi.fn(), signIn: vi.fn(), signOut: vi.fn() };
  },
}));
vi.mock("next-auth/providers/credentials", () => ({ default: () => ({}) }));
vi.mock("next/headers", () => ({ cookies: vi.fn() }));
vi.mock("@/auth.config", () => ({
  authConfig: { providers: [], callbacks: {} },
  googleConfiguredFlag: true,
}));
vi.mock("@/lib/env", () => ({ env: { SSO_JWT_SECRET: undefined } }));
vi.mock("@/lib/sso", () => ({
  clearSsoCookieOptions: vi.fn(),
  signSsoToken: vi.fn(),
  ssoCookieOptions: vi.fn(),
}));
vi.mock("@/lib/sso-claims", () => ({ buildSsoClaims: vi.fn() }));

const findFirstMock = vi.fn();
const updateSetMock = vi.fn();
const insertValuesMock = vi.fn();
vi.mock("@/lib/db", () => ({
  db: {
    query: { users: { findFirst: (opts: unknown) => findFirstMock(opts) } },
    update: () => ({
      set: (values: unknown) => {
        updateSetMock(values);
        return { where: () => Promise.resolve() };
      },
    }),
    insert: () => ({
      values: (values: unknown) => {
        insertValuesMock(values);
        return {
          returning: () => Promise.resolve([{ id: "new-user-id" }]),
          onConflictDoUpdate: () => Promise.resolve(),
        };
      },
    }),
  },
}));

import "@/auth";

type SignInCallback = (args: {
  user: { id?: string; email?: string | null };
  account: Record<string, unknown>;
  profile: Record<string, unknown>;
}) => Promise<boolean>;

function googleSignIn(profile: Record<string, unknown>) {
  const signIn = captured.config!.callbacks.signIn as SignInCallback;
  return signIn({
    user: { email: profile.email as string },
    account: {
      provider: "google",
      providerAccountId: "google-sub-1",
      type: "oidc",
    },
    profile,
  });
}

const baseProfile = { email: "person@example.com", name: "Person" };
const VERIFIED_AT = new Date("2026-01-01T00:00:00Z");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("Google signIn callback", () => {
  test("rejects email_verified=false without writing anything", async () => {
    findFirstMock.mockResolvedValueOnce({
      id: "u-1",
      role: "student",
      emailVerifiedAt: null,
      passwordHash: "hash",
      name: null,
      image: null,
    });
    await expect(
      googleSignIn({ ...baseProfile, email_verified: false }),
    ).resolves.toBe(false);
    expect(updateSetMock).not.toHaveBeenCalled();
    expect(insertValuesMock).not.toHaveBeenCalled();
  });

  test("rejects a profile that omits email_verified", async () => {
    findFirstMock.mockResolvedValueOnce(null);
    await expect(googleSignIn({ ...baseProfile })).resolves.toBe(false);
    expect(insertValuesMock).not.toHaveBeenCalled();
  });

  test("linking to an unverified local account removes passwordHash", async () => {
    findFirstMock.mockResolvedValueOnce({
      id: "u-1",
      role: "student",
      emailVerifiedAt: null,
      passwordHash: "hash",
      name: null,
      image: null,
    });
    await expect(
      googleSignIn({ ...baseProfile, email_verified: true }),
    ).resolves.toBe(true);
    expect(updateSetMock).toHaveBeenCalledTimes(1);
    const set = updateSetMock.mock.calls[0][0];
    expect(set.passwordHash).toBeNull();
    expect(set.emailVerifiedAt).toBeInstanceOf(Date);
  });

  test("linking to an already-verified local account keeps the password", async () => {
    findFirstMock.mockResolvedValueOnce({
      id: "u-2",
      role: "student",
      emailVerifiedAt: VERIFIED_AT,
      passwordHash: "hash",
      name: "Person",
      image: null,
    });
    await expect(
      googleSignIn({ ...baseProfile, email_verified: true }),
    ).resolves.toBe(true);
    const set = updateSetMock.mock.calls[0][0];
    expect("passwordHash" in set).toBe(false);
    expect(set.emailVerifiedAt).toBe(VERIFIED_AT);
  });

  test("linking to an unverified admin keeps its password and role", async () => {
    findFirstMock.mockResolvedValueOnce({
      id: "a-1",
      role: "super_admin",
      emailVerifiedAt: null,
      passwordHash: "hash",
      name: "Admin",
      image: null,
    });
    await expect(
      googleSignIn({ ...baseProfile, email_verified: true }),
    ).resolves.toBe(true);
    const set = updateSetMock.mock.calls[0][0];
    expect("passwordHash" in set).toBe(false);
    expect("role" in set).toBe(false);
    expect(set.emailVerifiedAt).toBeInstanceOf(Date);
  });

  test("creates a verified student row for a new verified Google user", async () => {
    findFirstMock.mockResolvedValueOnce(null);
    await expect(
      googleSignIn({ ...baseProfile, email_verified: true }),
    ).resolves.toBe(true);
    expect(updateSetMock).not.toHaveBeenCalled();
    const inserted = insertValuesMock.mock.calls[0][0];
    expect(inserted).toMatchObject({
      email: "person@example.com",
      role: "student",
    });
    expect(inserted.emailVerifiedAt).toBeInstanceOf(Date);
  });
});
