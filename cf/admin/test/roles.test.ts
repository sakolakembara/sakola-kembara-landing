import { describe, expect, test } from "vitest";
import { adminRoles, isAdminRole, isUserRole, userRoles } from "../src/auth/roles";

// Role names only. What each role may do in each area is test/permissions.test.ts.
describe("role names", () => {
  test("the four roles of the legacy app, in privilege order", () => {
    expect([...userRoles]).toEqual(["student", "viewer", "editor", "super_admin"]);
  });

  test("admin roles are every role except student (the legacy list)", () => {
    expect([...adminRoles]).toEqual(["viewer", "editor", "super_admin"]);
    expect(isAdminRole("student")).toBe(false);
    expect(isAdminRole("viewer")).toBe(true);
    expect(isAdminRole("super_admin")).toBe(true);
  });

  test("anything that is not exactly a role name is not a role", () => {
    for (const role of ["admin", "SUPER_ADMIN", " editor", "", null, undefined, 7, {}, ["editor"]]) {
      expect(isUserRole(role), String(role)).toBe(false);
      expect(isAdminRole(role), String(role)).toBe(false);
    }
  });
});
