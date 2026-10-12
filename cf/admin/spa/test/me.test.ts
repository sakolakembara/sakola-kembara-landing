import { describe, expect, test } from "vitest";
import { adminAreas, grantableAreas } from "../../src/auth/permissions";
import { userRoles } from "../../src/auth/roles";
import { ADMIN_AREAS, AREAS, displayName, parseMe, ROLES } from "~/lib/me";

const user = { id: "u1", email: "a@contoh.test", name: "Ani", role: "editor", emailVerified: true };
const areas = { granted: ["konten"], visible: ["pendaftaran", "komunikasi", "konten"], writable: ["konten"] };

describe("parseMe", () => {
  test("reads the shape of GET /api/me", () => {
    expect(parseMe({ user, areas })).toEqual({ ...user, areas });
  });

  test("a payload without areas gives empty lists, least privilege", () => {
    expect(parseMe({ user })?.areas).toEqual({ granted: [], visible: [], writable: [] });
  });

  test("an areas value that is not an object gives empty lists", () => {
    for (const bad of ["konten", ["konten"], 7, null]) {
      expect(parseMe({ user, areas: bad })?.areas).toEqual({ granted: [], visible: [], writable: [] });
    }
  });

  test("each list is read on its own", () => {
    expect(parseMe({ user, areas: { visible: ["konten"] } })?.areas).toEqual({ granted: [], visible: ["konten"], writable: [] });
    expect(parseMe({ user, areas: { writable: "konten", visible: ["konten"] } })?.areas).toEqual({
      granted: [],
      visible: ["konten"],
      writable: [],
    });
  });

  test("unknown names are dropped and duplicates collapse", () => {
    expect(parseMe({ user, areas: { granted: ["konten", "sistem", "konten", 7, null], visible: ["sistem", "bogus", "sistem"], writable: [] } })?.areas).toEqual({
      granted: ["konten"], // "sistem" cannot be granted
      visible: ["sistem"],
      writable: [],
    });
  });

  test("an unknown role becomes student, like the Worker does", () => {
    expect(parseMe({ user: { ...user, role: "owner" }, areas })?.role).toBe("student");
    expect(parseMe({ user: { ...user, role: undefined }, areas })?.role).toBe("student");
  });

  test("emailVerified must be exactly true", () => {
    expect(parseMe({ user: { ...user, emailVerified: "yes" }, areas })?.emailVerified).toBe(false);
  });

  test("a missing name is an empty string", () => {
    expect(parseMe({ user: { ...user, name: undefined }, areas })?.name).toBe("");
  });

  test.each([null, undefined, "x", 3, [], {}, { user: null }, { user: { email: "a@b.c" } }, { user: { id: "1" } }])(
    "garbage %j is not a user",
    (body) => {
      expect(parseMe(body)).toBeNull();
    },
  );
});

describe("the names the SPA knows are the Worker's", () => {
  test("roles", () => expect([...ROLES]).toEqual([...userRoles]));
  test("grantable areas", () => expect([...AREAS]).toEqual([...grantableAreas]));
  test("all areas, in sidebar order", () => expect([...ADMIN_AREAS]).toEqual([...adminAreas]));
});

describe("displayName", () => {
  test("prefers the name", () => expect(displayName({ name: " Ani ", email: "x@y.z" })).toBe("Ani"));
  test("falls back to the email before the @", () => expect(displayName({ name: "", email: "budi@y.z" })).toBe("budi"));
  test("falls back to Admin", () => expect(displayName({ name: "", email: "@y.z" })).toBe("Admin"));
});
