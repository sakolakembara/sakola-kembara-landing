import { describe, expect, test } from "vitest";
import {
  adminAreas,
  areaActions,
  areaLabels,
  can,
  grantableAreas,
  isAdminArea,
  isGrantableArea,
  levelIn,
  menuItems,
  visibleAreas,
  visibleMenu,
  writableAreas,
  type AdminArea,
  type AreaAction,
  type GrantableArea,
} from "../src/auth/permissions";
import { userRoles } from "../src/auth/roles";

// The permission model of SAKEM-081, as a table. Pure functions: no database.
// "r" = may read, "rw" = may read and change, "-" = nothing.

type Cell = "-" | "r" | "rw";
type Row = [role: string, grants: readonly string[], pendaftaran: Cell, komunikasi: Cell, konten: Cell, sistem: Cell];

const all = [...grantableAreas];

const matrix: Row[] = [
  // student: portal only, no admin area, whatever rows exist.
  ["student", [], "-", "-", "-", "-"],
  ["student", all, "-", "-", "-", "-"],
  // viewer: strictly read-only everywhere except Sistem, even with stray grant rows.
  ["viewer", [], "r", "r", "r", "-"],
  ["viewer", all, "r", "r", "r", "-"],
  // editor: reads and changes the granted areas and has nothing in the others
  // (SAKEM-082: the menus of other areas are hidden and their reads refused).
  ["editor", [], "-", "-", "-", "-"],
  ["editor", ["pendaftaran"], "rw", "-", "-", "-"],
  ["editor", ["komunikasi"], "-", "rw", "-", "-"],
  ["editor", ["konten"], "-", "-", "rw", "-"],
  ["editor", ["pendaftaran", "konten"], "rw", "-", "rw", "-"],
  ["editor", ["pendaftaran", "komunikasi"], "rw", "rw", "-", "-"],
  ["editor", ["komunikasi", "konten"], "-", "rw", "rw", "-"],
  ["editor", all, "rw", "rw", "rw", "-"],
  // Sistem cannot be granted: a "sistem" row, if one ever existed, is ignored.
  ["editor", ["sistem"], "-", "-", "-", "-"],
  ["editor", [...all, "sistem"], "rw", "rw", "rw", "-"],
  // super_admin: everything, with or without grants.
  ["super_admin", [], "rw", "rw", "rw", "rw"],
  ["super_admin", all, "rw", "rw", "rw", "rw"],
];

function expected(cell: Cell, action: AreaAction): boolean {
  return action === "read" ? cell !== "-" : cell === "rw";
}

describe("permission matrix: can(role, grantedAreas, area, action)", () => {
  for (const [role, grants, ...cells] of matrix) {
    for (const [index, area] of adminAreas.entries()) {
      for (const action of areaActions) {
        const cell = cells[index]!;
        test(`${role} [${grants.join(", ")}] ${action} ${area}: ${expected(cell, action) ? "allowed" : "refused"}`, () => {
          expect(can(role, grants, area, action)).toBe(expected(cell, action));
        });
      }
    }
  }

  test("the table covers every role", () => {
    expect(new Set(matrix.map(([role]) => role))).toEqual(new Set(userRoles));
  });
});

// Every subset of the three grantable areas, so the properties below hold for
// all 8 combinations, not only the ones spelled out above.
const subsets: GrantableArea[][] = Array.from({ length: 1 << grantableAreas.length }, (_, mask) =>
  grantableAreas.filter((_, bit) => mask & (1 << bit)),
);

describe("permission properties, for every combination of grants", () => {
  test("viewer never writes, anywhere, and never reads Sistem", () => {
    for (const grants of subsets) {
      for (const area of adminAreas) {
        expect(can("viewer", grants, area, "write"), `viewer [${grants}] ${area}`).toBe(false);
        expect(can("viewer", grants, area, "read"), `viewer [${grants}] read ${area}`).toBe(area !== "sistem");
      }
    }
  });

  test("student can do nothing", () => {
    for (const grants of subsets) for (const area of adminAreas) for (const action of areaActions) expect(can("student", grants, area, action)).toBe(false);
  });

  test("an editor reads and writes exactly where granted, and has nothing anywhere else", () => {
    for (const grants of subsets) {
      for (const area of grantableAreas) {
        expect(can("editor", grants, area, "write"), `editor [${grants}] write ${area}`).toBe(grants.includes(area));
        expect(can("editor", grants, area, "read"), `editor [${grants}] read ${area}`).toBe(grants.includes(area));
      }
      expect(can("editor", grants, "sistem", "read")).toBe(false);
      expect(can("editor", grants, "sistem", "write")).toBe(false);
    }
  });

  test("an editor is never read-only: the level in an area is write (granted) or none", () => {
    for (const grants of subsets) {
      for (const area of adminAreas) expect(levelIn("editor", grants, area), `editor [${grants}] ${area}`).not.toBe("read");
    }
  });

  test("no area is granted by being granted another one", () => {
    for (const grants of subsets) {
      for (const area of grantableAreas) {
        if (grants.includes(area)) continue;
        expect(levelIn("editor", grants, area), `editor [${grants}] ${area}`).toBe("none");
      }
    }
  });

  test("Sistem belongs to super_admin alone", () => {
    for (const role of userRoles) {
      for (const grants of subsets) {
        for (const action of areaActions) {
          expect(can(role, grants, "sistem", action), `${role} ${action} sistem`).toBe(role === "super_admin");
        }
      }
    }
  });

  test("super_admin may do everything whatever the grants", () => {
    for (const grants of subsets) for (const area of adminAreas) for (const action of areaActions) expect(can("super_admin", grants, area, action)).toBe(true);
  });

  test("more grants never remove a right", () => {
    for (const small of subsets) {
      for (const big of subsets.filter((s) => small.every((area) => s.includes(area)))) {
        for (const role of userRoles) {
          for (const area of adminAreas) {
            for (const action of areaActions) {
              if (can(role, small, area, action)) expect(can(role, big, area, action)).toBe(true);
            }
          }
        }
      }
    }
  });
});

describe("unknown input gets nothing", () => {
  test("unknown, empty, differently-cased and non-string roles", () => {
    for (const role of ["admin", "SUPER_ADMIN", "Editor", "", null, undefined, 7, {}]) {
      for (const area of adminAreas) {
        for (const action of areaActions) expect(can(role, all, area, action), `${String(role)} ${area} ${action}`).toBe(false);
      }
    }
  });

  test("an unknown area or action is refused even for super_admin", () => {
    expect(can("super_admin", all, "keuangan" as AdminArea, "read")).toBe(false);
    expect(can("super_admin", all, "konten", "delete" as AreaAction)).toBe(false);
    expect(can("super_admin", all, undefined as unknown as AdminArea, "read")).toBe(false);
    expect(levelIn("super_admin", [], "keuangan")).toBe("none");
  });

  test("garbage in the grant list grants nothing", () => {
    const garbage = ["KONTEN", "", null, 1, {}, "konten "];
    expect(can("editor", garbage, "konten", "write")).toBe(false);
    expect(can("editor", garbage, "konten", "read")).toBe(false); // an editor with no real grant sees nothing
    expect(visibleAreas("editor", garbage)).toEqual([]);
  });
});

describe("visibleAreas and writableAreas", () => {
  test("what each role sees and can change", () => {
    expect(visibleAreas("student", [])).toEqual([]);
    expect(visibleAreas("viewer", [])).toEqual(["pendaftaran", "komunikasi", "konten"]);
    expect(writableAreas("viewer", all)).toEqual([]);
    expect(visibleAreas("editor", [])).toEqual([]);
    expect(writableAreas("editor", [])).toEqual([]);
    expect(visibleAreas("editor", ["konten"])).toEqual(["konten"]);
    expect(writableAreas("editor", ["konten"])).toEqual(["konten"]);
    expect(visibleAreas("editor", ["konten", "pendaftaran"])).toEqual(["pendaftaran", "konten"]); // sidebar order
    expect(writableAreas("editor", ["konten", "pendaftaran"])).toEqual(["pendaftaran", "konten"]);
    expect(visibleAreas("super_admin", [])).toEqual(["pendaftaran", "komunikasi", "konten", "sistem"]);
    expect(writableAreas("super_admin", [])).toEqual(["pendaftaran", "komunikasi", "konten", "sistem"]);
  });

  test("for an editor, what they see is exactly what they were granted (and the same as what they can change)", () => {
    for (const grants of subsets) {
      expect(visibleAreas("editor", grants), `editor [${grants}]`).toEqual(grants);
      expect(writableAreas("editor", grants), `editor [${grants}]`).toEqual(grants);
    }
    // A stray "sistem" row changes nothing.
    expect(visibleAreas("editor", ["sistem", "konten"])).toEqual(["konten"]);
  });

  test("writable is always inside visible", () => {
    for (const role of userRoles) {
      for (const grants of subsets) {
        const visible = visibleAreas(role, grants);
        for (const area of writableAreas(role, grants)) expect(visible).toContain(area);
      }
    }
  });
});

describe("area names", () => {
  test("Sistem is an area but cannot be granted", () => {
    expect([...adminAreas]).toEqual(["pendaftaran", "komunikasi", "konten", "sistem"]);
    expect([...grantableAreas]).toEqual(["pendaftaran", "komunikasi", "konten"]);
    expect(isAdminArea("sistem")).toBe(true);
    expect(isGrantableArea("sistem")).toBe(false);
    expect(isGrantableArea("konten")).toBe(true);
    expect(isGrantableArea("Konten")).toBe(false);
  });
});

describe("menu to area map (docs/cloudflare/admin-ia.md section 3.1)", () => {
  test("the sidebar of the IA, in order, with the area of each menu", () => {
    expect(menuItems.map((item) => `${item.area}/${item.key}:${item.label}`)).toEqual([
      "pendaftaran/batches:Batch",
      "pendaftaran/applications:Pendaftar",
      "pendaftaran/resources:Pusat Dokumen",
      "komunikasi/messages:Pesan",
      "komunikasi/announcements:Pengumuman",
      "konten/blog:Blog",
      "konten/reports:Laporan",
      "konten/team:Tim",
      "konten/shortlinks:Shortlink",
      "sistem/audit:Aktivitas",
      "sistem/settings:Pengaturan",
    ]);
  });

  test("every area has at least one menu and a label; menu keys are unique", () => {
    for (const area of adminAreas) {
      expect(menuItems.some((item) => item.area === area), area).toBe(true);
      expect(areaLabels[area]).toBeTruthy();
    }
    expect(new Set(menuItems.map((item) => item.key)).size).toBe(menuItems.length);
  });

  test("the menu each role gets: Sistem (Aktivitas and Pengaturan) only for super_admin", () => {
    const keys = (role: string, grants: string[] = []) => visibleMenu(role, grants).map((item) => item.key);
    expect(keys("student")).toEqual([]);
    expect(keys("viewer")).toEqual(["batches", "applications", "resources", "messages", "announcements", "blog", "reports", "team", "shortlinks"]);
    expect(keys("viewer", all)).toEqual(keys("viewer"));
    expect(keys("super_admin")).toHaveLength(menuItems.length);
    for (const grants of subsets) {
      expect(keys("editor", grants)).not.toContain("audit");
      expect(keys("editor", grants)).not.toContain("settings");
    }
  });

  test("an editor gets the menus of the areas granted to them and no others", () => {
    const keys = (grants: string[]) => visibleMenu("editor", grants).map((item) => item.key);
    expect(keys([])).toEqual([]);
    expect(keys(["pendaftaran"])).toEqual(["batches", "applications", "resources"]);
    expect(keys(["komunikasi"])).toEqual(["messages", "announcements"]);
    expect(keys(["konten"])).toEqual(["blog", "reports", "team", "shortlinks"]);
    expect(keys(["konten", "pendaftaran"])).toEqual(["batches", "applications", "resources", "blog", "reports", "team", "shortlinks"]);
    expect(keys(all)).toEqual(["batches", "applications", "resources", "messages", "announcements", "blog", "reports", "team", "shortlinks"]);
    // Every item of the menu an editor gets belongs to an area they hold.
    for (const grants of subsets) for (const item of visibleMenu("editor", grants)) expect(grants).toContain(item.area);
  });
});
