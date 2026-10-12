import { describe, expect, test } from "vitest";
import { displayName, parseMe } from "~/lib/me";

const user = { id: "u1", email: "a@contoh.test", name: "Ani", role: "editor", emailVerified: true };

describe("parseMe", () => {
  test("reads the documented shape", () => {
    expect(parseMe({ user: { ...user, areas: ["konten", "komunikasi"] } })).toEqual({
      ...user,
      areas: ["konten", "komunikasi"],
    });
  });

  test("a payload without areas (the Worker before the permission model) gives none, least privilege", () => {
    expect(parseMe({ user })?.areas).toEqual([]);
  });

  test("areas next to user are accepted too", () => {
    expect(parseMe({ user, areas: ["pendaftaran"] })?.areas).toEqual(["pendaftaran"]);
  });

  test("user.areas wins over areas next to it", () => {
    expect(parseMe({ user: { ...user, areas: ["konten"] }, areas: ["pendaftaran"] })?.areas).toEqual(["konten"]);
  });

  test("unknown areas are dropped and duplicates collapse", () => {
    expect(parseMe({ user: { ...user, areas: ["konten", "sistem", "konten", 7, null] } })?.areas).toEqual(["konten"]);
  });

  test("areas that are not a list are ignored", () => {
    expect(parseMe({ user: { ...user, areas: "konten" } })?.areas).toEqual([]);
  });

  test("an unknown role becomes student, like the Worker does", () => {
    expect(parseMe({ user: { ...user, role: "owner" } })?.role).toBe("student");
    expect(parseMe({ user: { ...user, role: undefined } })?.role).toBe("student");
  });

  test("emailVerified must be exactly true", () => {
    expect(parseMe({ user: { ...user, emailVerified: "yes" } })?.emailVerified).toBe(false);
  });

  test("a missing name is an empty string", () => {
    expect(parseMe({ user: { ...user, name: undefined } })?.name).toBe("");
  });

  test.each([null, undefined, "x", 3, [], {}, { user: null }, { user: { email: "a@b.c" } }, { user: { id: "1" } }])(
    "garbage %j is not a user",
    (body) => {
      expect(parseMe(body)).toBeNull();
    },
  );
});

describe("displayName", () => {
  test("prefers the name", () => expect(displayName({ name: " Ani ", email: "x@y.z" })).toBe("Ani"));
  test("falls back to the email before the @", () => expect(displayName({ name: "", email: "budi@y.z" })).toBe("budi"));
  test("falls back to Admin", () => expect(displayName({ name: "", email: "@y.z" })).toBe("Admin"));
});
