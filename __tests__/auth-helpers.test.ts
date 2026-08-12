import { beforeEach, describe, expect, test, vi } from "vitest";

// requireStudent / requireAdmin call redirect() from next/navigation on the
// unhappy paths. Next's redirect throws a special error; we intercept by
// mocking it to throw a labeled Error so tests can assert against it.
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    const err = new Error(`REDIRECT:${to}`);
    (err as unknown as { digest: string }).digest = `NEXT_REDIRECT;replace;${to};307;`;
    throw err;
  },
}));

// Mock auth() to return whatever a given test wants.
const authMock = vi.fn();
vi.mock("@/auth", () => ({
  auth: () => authMock(),
}));

// Minimal DB mock — findFirst returns whatever the test sets.
const usersFindFirstMock = vi.fn();
vi.mock("@/lib/db", () => ({
  db: {
    query: {
      users: {
        findFirst: (opts: unknown) => usersFindFirstMock(opts),
      },
    },
  },
}));

import { requireAdmin, requireStudent, requireSuperAdmin } from "@/lib/auth-helpers";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("requireAdmin", () => {
  test("redirects to /login when no session", async () => {
    authMock.mockResolvedValueOnce(null);
    await expect(requireAdmin()).rejects.toThrow("REDIRECT:/login");
  });

  test("redirects to /portal when session lacks admin role", async () => {
    authMock.mockResolvedValueOnce({
      user: { email: "student@example.com", role: "student" },
    });
    await expect(requireAdmin()).rejects.toThrow("REDIRECT:/portal?error=admin-only");
  });

  test("returns context when session has editor role and DB confirms", async () => {
    authMock.mockResolvedValueOnce({
      user: { email: "editor@example.com", role: "editor" },
    });
    usersFindFirstMock.mockResolvedValueOnce({
      id: "u-1",
      role: "editor",
    });
    await expect(requireAdmin()).resolves.toEqual({
      email: "editor@example.com",
      userId: "u-1",
      role: "editor",
    });
  });

  test("re-checks DB and rejects when role was demoted since JWT was issued", async () => {
    authMock.mockResolvedValueOnce({
      user: { email: "demoted@example.com", role: "editor" },
    });
    usersFindFirstMock.mockResolvedValueOnce({
      id: "u-2",
      role: "student", // demoted in DB
    });
    await expect(requireAdmin()).rejects.toThrow(
      "REDIRECT:/portal?error=admin-only",
    );
  });
});

describe("requireSuperAdmin", () => {
  test("redirects when role is only editor", async () => {
    authMock.mockResolvedValueOnce({
      user: { email: "editor@example.com", role: "editor" },
    });
    usersFindFirstMock.mockResolvedValueOnce({
      id: "u-1",
      role: "editor",
    });
    await expect(requireSuperAdmin()).rejects.toThrow(
      /REDIRECT:\/admin\/settings\?error=/,
    );
  });

  test("returns context for super_admin", async () => {
    authMock.mockResolvedValueOnce({
      user: { email: "super@example.com", role: "super_admin" },
    });
    usersFindFirstMock.mockResolvedValueOnce({
      id: "u-3",
      role: "super_admin",
    });
    await expect(requireSuperAdmin()).resolves.toMatchObject({
      email: "super@example.com",
      role: "super_admin",
    });
  });
});

describe("requireStudent", () => {
  test("redirects to /login when unauthenticated", async () => {
    authMock.mockResolvedValueOnce(null);
    await expect(requireStudent()).rejects.toThrow("REDIRECT:/login");
  });

  test("carries the fromPath through the redirect", async () => {
    authMock.mockResolvedValueOnce(null);
    await expect(requireStudent("/portal/status")).rejects.toThrow(
      "REDIRECT:/login?from=%2Fportal%2Fstatus",
    );
  });

  test("redirects to /login when session exists but DB row missing", async () => {
    authMock.mockResolvedValueOnce({
      user: { email: "ghost@example.com" },
    });
    usersFindFirstMock.mockResolvedValueOnce(null);
    await expect(requireStudent()).rejects.toThrow("REDIRECT:/login");
  });

  test("returns context for a valid student", async () => {
    authMock.mockResolvedValueOnce({
      user: { email: "student@example.com" },
    });
    usersFindFirstMock.mockResolvedValueOnce({
      id: "s-1",
      email: "student@example.com",
      role: "student",
      name: "Siti",
      image: null,
    });
    await expect(requireStudent()).resolves.toEqual({
      email: "student@example.com",
      userId: "s-1",
      role: "student",
      name: "Siti",
      image: null,
    });
  });

  test("returns context for an admin viewing the portal", async () => {
    authMock.mockResolvedValueOnce({
      user: { email: "editor@example.com" },
    });
    usersFindFirstMock.mockResolvedValueOnce({
      id: "e-1",
      email: "editor@example.com",
      role: "editor",
      name: "Editor",
      image: null,
    });
    const ctx = await requireStudent();
    expect(ctx.role).toBe("editor");
  });
});
