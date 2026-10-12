import { describe, expect, test } from "vitest";
import { levelIn } from "../../src/auth/permissions";
import { type Access, accessTo, type Section } from "~/lib/access";
import { ADMIN_AREAS, AREAS, type Area, type Me, type Role } from "~/lib/me";
import { GRANT_SETS, meFor } from "./me-fixtures";

const SECTIONS: Section[] = [...ADMIN_AREAS, "umum"];
const ROLES: Role[] = ["student", "viewer", "editor", "super_admin"];

type Row = Record<Section, Access>;
const row = (pendaftaran: Access, komunikasi: Access, konten: Access, sistem: Access, umum: Access): Row => ({
  pendaftaran,
  komunikasi,
  konten,
  sistem,
  umum,
});

/**
 * Every role against several grant sets, written out cell by cell: the rules as
 * decided for SAKEM-082. An editor has access (write) in the areas granted to
 * them and none anywhere else; the dashboard ("umum") is open to every admin.
 */
const MATRIX: { role: Role; granted: Area[]; expected: Row }[] = [
  // student: nothing
  { role: "student", granted: [], expected: row("none", "none", "none", "none", "none") },
  { role: "student", granted: ["konten"], expected: row("none", "none", "none", "none", "none") },
  { role: "student", granted: [...AREAS], expected: row("none", "none", "none", "none", "none") },
  // viewer: reads everything but Sistem, never writes, grants are irrelevant
  { role: "viewer", granted: [], expected: row("read", "read", "read", "none", "read") },
  { role: "viewer", granted: ["konten"], expected: row("read", "read", "read", "none", "read") },
  { role: "viewer", granted: [...AREAS], expected: row("read", "read", "read", "none", "read") },
  // editor: access only in granted areas, nothing in the others, no Sistem; the dashboard always
  { role: "editor", granted: [], expected: row("none", "none", "none", "none", "read") },
  { role: "editor", granted: ["pendaftaran"], expected: row("write", "none", "none", "none", "read") },
  { role: "editor", granted: ["komunikasi"], expected: row("none", "write", "none", "none", "read") },
  { role: "editor", granted: ["konten"], expected: row("none", "none", "write", "none", "read") },
  { role: "editor", granted: ["pendaftaran", "komunikasi"], expected: row("write", "write", "none", "none", "read") },
  { role: "editor", granted: [...AREAS], expected: row("write", "write", "write", "none", "read") },
  // super_admin: everything, including Sistem
  { role: "super_admin", granted: [], expected: row("write", "write", "write", "write", "read") },
  { role: "super_admin", granted: ["konten"], expected: row("write", "write", "write", "write", "read") },
  { role: "super_admin", granted: [...AREAS], expected: row("write", "write", "write", "write", "read") },
];

describe("accessTo: role x grants matrix", () => {
  for (const { role, granted, expected } of MATRIX) {
    for (const section of SECTIONS) {
      test(`${role} [${granted.join(",") || "no grants"}] on ${section} is ${expected[section]}`, () => {
        expect(accessTo(meFor(role, granted), section)).toBe(expected[section]);
      });
    }
  }
});

describe("accessTo agrees with the Worker's own rules (src/auth/permissions.ts) for every role and every set of grants", () => {
  test("there are eight sets of grants", () => expect(GRANT_SETS).toHaveLength(8));

  for (const role of ROLES) {
    for (const granted of GRANT_SETS) {
      test(`${role} [${granted.join(",") || "no grants"}]`, () => {
        const me = meFor(role, granted);
        for (const area of ADMIN_AREAS) {
          // levelIn is what the route guards use; the SPA must show exactly that.
          expect(accessTo(me, area), area).toBe(levelIn(role, me.areas.granted, area));
        }
        // The dashboard is open to every admin role, read-only, and to nobody else.
        expect(accessTo(me, "umum")).toBe(role === "student" ? "none" : "read");
      });
    }
  }
});

describe("accessTo: invariants", () => {
  test("a viewer never writes and a student never sees, for any grants", () => {
    for (const granted of GRANT_SETS) {
      for (const section of SECTIONS) {
        expect(accessTo(meFor("viewer", granted), section)).not.toBe("write");
        expect(accessTo(meFor("student", granted), section)).toBe("none");
      }
    }
  });

  test("an editor has access exactly where granted, sees nothing else and never sees Sistem", () => {
    for (const granted of GRANT_SETS) {
      for (const area of AREAS) {
        expect(accessTo(meFor("editor", granted), area), `editor [${granted}] ${area}`).toBe(granted.includes(area) ? "write" : "none");
      }
      expect(accessTo(meFor("editor", granted), "sistem")).toBe("none");
    }
  });

  test("an editor is never read-only: access is write or none", () => {
    for (const granted of GRANT_SETS) {
      for (const area of ADMIN_AREAS) {
        expect(accessTo(meFor("editor", granted), area), `editor [${granted}] ${area}`).not.toBe("read");
      }
    }
  });

  test("only super_admin sees Sistem", () => {
    for (const role of ROLES) {
      for (const granted of GRANT_SETS) {
        expect(accessTo(meFor(role, granted), "sistem") !== "none").toBe(role === "super_admin");
      }
    }
  });
});

describe("accessTo: input it should not trust", () => {
  test("no user at all", () => {
    for (const section of SECTIONS) {
      expect(accessTo(null, section)).toBe("none");
      expect(accessTo(undefined, section)).toBe("none");
    }
  });

  test("a role this build does not know gets nothing, even with full lists", () => {
    const full = meFor("super_admin").areas;
    for (const role of ["admin", "SUPER_ADMIN", "", "owner"]) {
      for (const section of SECTIONS) {
        expect(accessTo({ role, areas: full } as unknown as Pick<Me, "role" | "areas">, section)).toBe("none");
      }
    }
  });

  test("a student whose payload claims areas still gets nothing", () => {
    const lying = { role: "student", areas: meFor("super_admin").areas } as Pick<Me, "role" | "areas">;
    for (const section of SECTIONS) expect(accessTo(lying, section)).toBe("none");
  });

  test("empty lists show nothing but the dashboard (a payload without areas)", () => {
    const bare = { role: "editor", areas: { granted: [], visible: [], writable: [] } } as Pick<Me, "role" | "areas">;
    for (const area of ADMIN_AREAS) expect(accessTo(bare, area)).toBe("none");
    expect(accessTo(bare, "umum")).toBe("read");
  });
});
