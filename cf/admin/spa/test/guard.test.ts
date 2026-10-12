import { describe, expect, test } from "vitest";
import { decideGuard, loginPath, type SessionState, safeFrom } from "~/lib/guard";
import { meFor as me } from "./me-fixtures";
const at = { pathname: "/applications", search: "?status=pending" };

describe("decideGuard", () => {
  test("loading and error pass through, whatever the page", () => {
    expect(decideGuard({ status: "loading" }, at)).toEqual({ kind: "loading" });
    expect(decideGuard({ status: "error" }, at)).toEqual({ kind: "error" });
  });

  test("not signed in goes to /login carrying the page asked for", () => {
    const state: SessionState = { status: "signed-out", byUser: false };
    expect(decideGuard(state, at)).toEqual({ kind: "login", to: "/login?from=%2Fapplications%3Fstatus%3Dpending" });
  });

  test("not signed in at the dashboard goes to a bare /login", () => {
    expect(decideGuard({ status: "signed-out", byUser: false }, { pathname: "/" })).toEqual({ kind: "login", to: "/login" });
  });

  test("after pressing Keluar there is no `from`", () => {
    expect(decideGuard({ status: "signed-out", byUser: true }, at)).toEqual({ kind: "login", to: "/login" });
  });

  test("every admin role is allowed in", () => {
    for (const role of ["viewer", "editor", "super_admin"] as const) {
      expect(decideGuard({ status: "ready", me: me(role) }, at).kind).toBe("allow");
    }
  });

  test("a student is signed in but not an admin", () => {
    expect(decideGuard({ status: "ready", me: me("student") }, at).kind).toBe("no-admin-access");
  });
});

describe("safeFrom", () => {
  test.each([
    ["/", "/"],
    ["/applications", "/applications"],
    ["/applications?status=pending&batch=2026", "/applications?status=pending&batch=2026"],
    ["/blog/abc/edit#top", "/blog/abc/edit#top"],
  ])("accepts %s", (input, expected) => {
    expect(safeFrom(input)).toBe(expected);
  });

  test.each([
    null,
    undefined,
    "",
    "applications",
    "https://evil.example/",
    "http://evil.example",
    "//evil.example",
    "///evil.example",
    "/\\evil.example",
    "javascript:alert(1)",
    "/ok\nSet-Cookie: a=b",
    "/ok\u0000",
    "/login",
    "/login?from=/",
    "/forgot-password",
    "/reset-password?token=x",
    "/verify-email",
    "/auth/error",
  ])("rejects %j", (input) => {
    expect(safeFrom(input)).toBeNull();
  });

  test("a path that merely starts like an auth page is fine", () => {
    expect(safeFrom("/login-help")).toBe("/login-help");
  });
});

describe("loginPath", () => {
  test("encodes the page", () => {
    expect(loginPath("/applications?status=pending")).toBe("/login?from=%2Fapplications%3Fstatus%3Dpending");
  });
  test("leaves out the dashboard and anything unsafe", () => {
    expect(loginPath("/")).toBe("/login");
    expect(loginPath(null)).toBe("/login");
    expect(loginPath("//evil.example")).toBe("/login");
  });
});
