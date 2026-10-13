import { describe, expect, test } from "vitest";
import { decideGuard, loginPath, portalSafeFrom, type SessionState } from "~/lib/guard";
import { isStudent, type Me, parseMe } from "~/lib/me";

const me = (role: string): Me => ({ id: "u1", name: "Sari Dewi", email: "sari@contoh.test", emailVerified: true, role });
const here = { pathname: "/status", search: "", hash: "" };

describe("who is a student", () => {
  test("only the exact role", () => {
    expect(isStudent(me("student"))).toBe(true);
    for (const role of ["viewer", "editor", "super_admin", "", "Student", "student ", "unknown"]) {
      expect(isStudent(me(role)), JSON.stringify(role)).toBe(false);
    }
  });

  test("an unknown or missing role in the answer is NOT a student (unlike the admin, which falls to the least privilege)", () => {
    expect(parseMe({ user: { id: "u", email: "a@b.test", role: "whatever" } })?.role).toBe("whatever");
    expect(isStudent(parseMe({ user: { id: "u", email: "a@b.test", role: "whatever" } })!)).toBe(false);
    expect(isStudent(parseMe({ user: { id: "u", email: "a@b.test" } })!)).toBe(false);
    expect(isStudent(parseMe({ user: { id: "u", email: "a@b.test", role: 5 } })!)).toBe(false);
  });
});

describe("the guard", () => {
  test("loading and error wait and say so", () => {
    expect(decideGuard({ status: "loading" }, here)).toEqual({ kind: "loading" });
    expect(decideGuard({ status: "error" }, here)).toEqual({ kind: "error" });
  });

  test("a student is let in", () => {
    const state: SessionState = { status: "ready", me: me("student") };
    expect(decideGuard(state, here)).toEqual({ kind: "allow", me: me("student") });
  });

  test("an account that is not a student gets the 'not a student' decision, whatever its role", () => {
    for (const role of ["viewer", "editor", "super_admin", "", "unknown"]) {
      expect(decideGuard({ status: "ready", me: me(role) }, here).kind, role).toBe("not-student");
    }
  });

  test("signed out goes to /login carrying the page that was asked for", () => {
    expect(decideGuard({ status: "signed-out", byUser: false }, { pathname: "/daftar", search: "?x=1", hash: "" })).toEqual({
      kind: "login",
      to: "/login?from=%2Fdaftar%3Fx%3D1",
    });
  });

  test("signed out from the front page, or by pressing Keluar, goes to a plain /login", () => {
    expect(decideGuard({ status: "signed-out", byUser: false }, { pathname: "/" })).toEqual({ kind: "login", to: "/login" });
    expect(decideGuard({ status: "signed-out", byUser: true }, here)).toEqual({ kind: "login", to: "/login" });
  });
});

describe("the `from` of a sign-in link", () => {
  test("a path of the portal is kept, with its query and hash", () => {
    expect(portalSafeFrom("/daftar")).toBe("/daftar");
    expect(portalSafeFrom("/status?a=1#b")).toBe("/status?a=1#b");
  });

  test.each(["https://evil.test/x", "//evil.test/x", "/\\evil.test", "daftar", "", null, undefined, "/ab\ncd"])("%j is refused", (raw) => {
    expect(portalSafeFrom(raw as string | null | undefined)).toBeNull();
  });

  test("the sign-in pages are never a destination, and neither is the sign-up form", () => {
    for (const path of ["/login", "/register", "/forgot-password", "/reset-password?token=x", "/verify-email", "/auth/error", "/register/x"]) {
      expect(portalSafeFrom(path), path).toBeNull();
    }
  });

  test("loginPath carries a good `from` and drops a bad one", () => {
    expect(loginPath("/daftar")).toBe("/login?from=%2Fdaftar");
    expect(loginPath("/")).toBe("/login");
    expect(loginPath("//evil.test")).toBe("/login");
    expect(loginPath(null)).toBe("/login");
  });
});
