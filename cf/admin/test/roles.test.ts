import { describe, expect, test } from "vitest";
import { adminRoles, can, isAdminRole, userRoles, type Access } from "../src/auth/roles";

// The role matrix of the legacy app (docs/architecture/authentication.md),
// ported to the new guard. SAKEM-013: viewer is read-only.
const matrix: Record<string, Record<Access, boolean>> = {
  student: { "admin-read": false, "admin-write": false, "super-admin": false },
  viewer: { "admin-read": true, "admin-write": false, "super-admin": false },
  editor: { "admin-read": true, "admin-write": true, "super-admin": false },
  super_admin: { "admin-read": true, "admin-write": true, "super-admin": true },
};

describe("role matrix", () => {
  for (const [role, access] of Object.entries(matrix)) {
    for (const [level, expected] of Object.entries(access)) {
      test(`${role} ${expected ? "may" : "may not"} ${level}`, () => {
        expect(can(role, level as Access)).toBe(expected);
      });
    }
  }

  test("covers every role the schema knows", () => {
    expect(Object.keys(matrix).sort()).toEqual([...userRoles].sort());
  });

  test("unknown, empty and non-string roles get nothing", () => {
    for (const role of ["admin", "SUPER_ADMIN", "", null, undefined, 7, {}]) {
      for (const level of ["admin-read", "admin-write", "super-admin"] as const) {
        expect(can(role, level), `${String(role)} ${level}`).toBe(false);
      }
    }
  });

  test("isAdminRole matches the legacy list", () => {
    expect([...adminRoles]).toEqual(["viewer", "editor", "super_admin"]);
    expect(isAdminRole("student")).toBe(false);
    expect(isAdminRole("viewer")).toBe(true);
  });
});
