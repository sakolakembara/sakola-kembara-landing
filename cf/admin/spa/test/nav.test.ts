import { describe, expect, test } from "vitest";
import { menuItems, visibleMenu } from "../../src/auth/permissions";
import { accessToPath, NAV, NAV_ITEMS, navItemFor, QUICK_ACTIONS, visibleNav, visibleQuickActions } from "~/lib/nav";
import type { Role } from "~/lib/me";
import { GRANT_SETS, meFor } from "./me-fixtures";

const labels = (groups: { items: { label: string }[] }[]) => groups.flatMap((group) => group.items.map((item) => item.label));

describe("the menu definition (docs/cloudflare/admin-ia.md, proposal A)", () => {
  test("groups and labels are exactly the approved ones, in order", () => {
    expect(NAV.map((group) => group.label)).toEqual([null, "Pendaftaran", "Komunikasi", "Konten Situs", "Sistem"]);
    expect(labels(NAV as never)).toEqual([
      "Dashboard",
      "Batch",
      "Pendaftar",
      "Pusat Dokumen",
      "Pesan",
      "Pengumuman",
      "Blog",
      "Laporan",
      "Tim",
      "Shortlink",
      "Aktivitas",
      "Pengaturan",
    ]);
  });

  test("the renamed entry is Pusat Dokumen, not Berkas Pendaftaran", () => {
    expect(NAV_ITEMS.map((item) => item.label)).not.toContain("Berkas Pendaftaran");
    expect(NAV_ITEMS.find((item) => item.path === "/resources")?.label).toBe("Pusat Dokumen");
  });

  test("Batch keeps its full page title", () => {
    expect(NAV_ITEMS.find((item) => item.path === "/batches")?.title).toBe("Batch Pendaftaran");
  });

  test("paths are unique and absolute", () => {
    const paths = NAV_ITEMS.map((item) => item.path);
    expect(new Set(paths).size).toBe(paths.length);
    for (const path of paths) expect(path.startsWith("/")).toBe(true);
  });

  test("is the Worker's menu (menuItems in src/auth/permissions.ts): same entries, labels, order and areas", () => {
    const spa = NAV_ITEMS.filter((item) => item.path !== "/").map((item) => ({
      key: item.path.slice(1),
      label: item.label,
      area: item.section,
    }));
    expect(spa).toEqual(menuItems.map((item) => ({ key: item.key, label: item.label, area: item.area })));
  });
});

describe("visibleNav", () => {
  test("super_admin sees all five groups and all twelve entries", () => {
    const groups = visibleNav(meFor("super_admin"));
    expect(groups.map((group) => group.label)).toEqual([null, "Pendaftaran", "Komunikasi", "Konten Situs", "Sistem"]);
    expect(labels(groups)).toHaveLength(12);
    // The dashboard is read-only for everyone; the rest is writable for super_admin.
    const access = groups.flatMap((group) => group.items).map((item) => [item.label, item.access]);
    expect(access.filter(([label]) => label !== "Dashboard").every(([, level]) => level === "write")).toBe(true);
  });

  test("viewer sees every group except Sistem, all read-only", () => {
    const groups = visibleNav(meFor("viewer"));
    expect(groups.map((group) => group.label)).toEqual([null, "Pendaftaran", "Komunikasi", "Konten Situs"]);
    expect(labels(groups)).not.toContain("Aktivitas");
    expect(labels(groups)).not.toContain("Pengaturan");
    expect(groups.flatMap((group) => group.items).every((item) => item.access === "read")).toBe(true);
  });

  test("editor sees every group except Sistem, and writes only in granted areas", () => {
    const groups = visibleNav(meFor("editor", ["konten"]));
    expect(groups.map((group) => group.label)).toEqual([null, "Pendaftaran", "Komunikasi", "Konten Situs"]);
    const access = Object.fromEntries(groups.flatMap((group) => group.items).map((item) => [item.label, item.access]));
    expect(access).toEqual({
      Dashboard: "read",
      Batch: "read",
      Pendaftar: "read",
      "Pusat Dokumen": "read",
      Pesan: "read",
      Pengumuman: "read",
      Blog: "write",
      Laporan: "write",
      Tim: "write",
      Shortlink: "write",
    });
  });

  test("an editor with no grants is a read-only editor", () => {
    const items = visibleNav(meFor("editor")).flatMap((group) => group.items);
    expect(items.every((item) => item.access === "read")).toBe(true);
  });

  test("a student, or nobody, sees no menu", () => {
    expect(visibleNav(meFor("student"))).toEqual([]);
    expect(visibleNav(null)).toEqual([]);
  });

  test("shows exactly the menu the Worker says is visible, for every role and every set of grants", () => {
    const roles: Role[] = ["viewer", "editor", "super_admin"];
    for (const role of roles) {
      for (const granted of GRANT_SETS) {
        const fromWorker = visibleMenu(role, role === "editor" ? granted : []).map((item) => item.label);
        expect(labels(visibleNav(meFor(role, granted))), `${role} [${granted.join(",")}]`).toEqual(["Dashboard", ...fromWorker]);
      }
    }
  });
});

describe("navItemFor", () => {
  test("finds the entry a path belongs to", () => {
    expect(navItemFor("/")?.label).toBe("Dashboard");
    expect(navItemFor("/blog")?.label).toBe("Blog");
    expect(navItemFor("/blog/")?.label).toBe("Blog");
    expect(navItemFor("/blog/new")?.label).toBe("Blog");
    expect(navItemFor("/applications/abc/review")?.label).toBe("Pendaftar");
  });

  test("a path that only starts with a menu path is not that entry", () => {
    expect(navItemFor("/blogger")).toBeNull();
    expect(navItemFor("/nowhere")).toBeNull();
  });
});

describe("accessToPath", () => {
  test("follows the entry the path belongs to", () => {
    expect(accessToPath(meFor("editor", ["konten"]), "/blog/new")).toBe("write");
    expect(accessToPath(meFor("editor", ["konten"]), "/messages")).toBe("read");
    expect(accessToPath(meFor("viewer"), "/audit")).toBe("none");
    expect(accessToPath(meFor("super_admin"), "/audit")).toBe("write");
  });
  test("an unknown path is none", () => {
    expect(accessToPath(meFor("super_admin"), "/nowhere")).toBe("none");
  });
});

describe("visibleQuickActions", () => {
  const hrefs = (me: Parameters<typeof visibleQuickActions>[0]) => visibleQuickActions(me).map((action) => action.href);

  test("a viewer gets none", () => {
    expect(hrefs(meFor("viewer"))).toEqual([]);
    expect(hrefs(meFor("viewer", ["konten", "komunikasi"]))).toEqual([]);
  });

  test("an editor gets the ones in granted areas only", () => {
    expect(hrefs(meFor("editor", ["konten"]))).toEqual(["/blog/new", "/reports/new", "/team/new"]);
    expect(hrefs(meFor("editor", ["komunikasi"]))).toEqual(["/announcements/new"]);
    expect(hrefs(meFor("editor", ["pendaftaran"]))).toEqual([]);
  });

  test("super_admin gets all of them", () => {
    expect(hrefs(meFor("super_admin"))).toEqual(QUICK_ACTIONS.map((action) => action.href));
  });

  test("every shortcut leads to a path under a menu entry", () => {
    for (const action of QUICK_ACTIONS) expect(navItemFor(action.href)).not.toBeNull();
  });
});
