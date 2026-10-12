import { describe, expect, test } from "vitest";
import { type Access, accessTo, type Section } from "~/lib/access";
import { AREAS, type Area, type Me, type Role } from "~/lib/me";

const SECTIONS: Section[] = ["pendaftaran", "komunikasi", "konten", "sistem", "umum"];

type Row = Record<Section, Access>;
const row = (pendaftaran: Access, komunikasi: Access, konten: Access, sistem: Access, umum: Access): Row => ({
  pendaftaran,
  komunikasi,
  konten,
  sistem,
  umum,
});

/** Every role against three area grants, written out cell by cell. */
const MATRIX: { role: Role; areas: Area[]; expected: Row }[] = [
  // student: nothing, whatever the areas say
  { role: "student", areas: [], expected: row("none", "none", "none", "none", "none") },
  { role: "student", areas: ["konten"], expected: row("none", "none", "none", "none", "none") },
  { role: "student", areas: [...AREAS], expected: row("none", "none", "none", "none", "none") },
  // viewer: reads everything but Sistem, never writes, areas are irrelevant
  { role: "viewer", areas: [], expected: row("read", "read", "read", "none", "read") },
  { role: "viewer", areas: ["konten"], expected: row("read", "read", "read", "none", "read") },
  { role: "viewer", areas: [...AREAS], expected: row("read", "read", "read", "none", "read") },
  // editor: writes only in granted areas, reads the others, no Sistem
  { role: "editor", areas: [], expected: row("read", "read", "read", "none", "read") },
  { role: "editor", areas: ["konten"], expected: row("read", "read", "write", "none", "read") },
  { role: "editor", areas: ["pendaftaran", "komunikasi"], expected: row("write", "write", "read", "none", "read") },
  { role: "editor", areas: [...AREAS], expected: row("write", "write", "write", "none", "read") },
  // super_admin: everything, including Sistem, areas are irrelevant
  { role: "super_admin", areas: [], expected: row("write", "write", "write", "write", "write") },
  { role: "super_admin", areas: ["konten"], expected: row("write", "write", "write", "write", "write") },
  { role: "super_admin", areas: [...AREAS], expected: row("write", "write", "write", "write", "write") },
];

describe("accessTo: role x area matrix", () => {
  for (const { role, areas, expected } of MATRIX) {
    for (const section of SECTIONS) {
      test(`${role} [${areas.join(",") || "no areas"}] on ${section} is ${expected[section]}`, () => {
        expect(accessTo({ role, areas }, section)).toBe(expected[section]);
      });
    }
  }
});

describe("accessTo: invariants over every subset of areas", () => {
  const subsets: Area[][] = [];
  for (let mask = 0; mask < 1 << AREAS.length; mask++) subsets.push(AREAS.filter((_, i) => mask & (1 << i)));

  test("there are eight subsets", () => expect(subsets).toHaveLength(8));

  for (const areas of subsets) {
    const label = areas.join(",") || "no areas";
    test(`[${label}]: viewer never writes, student never sees, super_admin always writes`, () => {
      for (const section of SECTIONS) {
        expect(accessTo({ role: "viewer", areas }, section)).not.toBe("write");
        expect(accessTo({ role: "student", areas }, section)).toBe("none");
        expect(accessTo({ role: "super_admin", areas }, section)).toBe("write");
      }
    });
    test(`[${label}]: editor writes exactly where granted and never in Sistem`, () => {
      for (const area of AREAS) {
        expect(accessTo({ role: "editor", areas }, area)).toBe(areas.includes(area) ? "write" : "read");
      }
      expect(accessTo({ role: "editor", areas }, "sistem")).toBe("none");
    });
  }
});

describe("accessTo: unknown input gets nothing", () => {
  test("no user at all", () => {
    for (const section of SECTIONS) {
      expect(accessTo(null, section)).toBe("none");
      expect(accessTo(undefined, section)).toBe("none");
    }
  });

  test("a role this build does not know", () => {
    for (const role of ["admin", "SUPER_ADMIN", "", "owner"]) {
      for (const section of SECTIONS) {
        expect(accessTo({ role, areas: [...AREAS] } as unknown as Pick<Me, "role" | "areas">, section)).toBe("none");
      }
    }
  });
});
