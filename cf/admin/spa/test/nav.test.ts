import { describe, expect, test } from "vitest";
import { accessToPath, NAV, NAV_ITEMS, navItemFor, QUICK_ACTIONS, visibleNav, visibleQuickActions } from "~/lib/nav";

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
});

describe("visibleNav", () => {
  test("super_admin sees all five groups and all twelve entries", () => {
    const groups = visibleNav({ role: "super_admin", areas: [] });
    expect(groups.map((group) => group.label)).toEqual([null, "Pendaftaran", "Komunikasi", "Konten Situs", "Sistem"]);
    expect(labels(groups)).toHaveLength(12);
    expect(groups.flatMap((group) => group.items).every((item) => item.access === "write")).toBe(true);
  });

  test("viewer sees every group except Sistem, all read-only", () => {
    const groups = visibleNav({ role: "viewer", areas: [] });
    expect(groups.map((group) => group.label)).toEqual([null, "Pendaftaran", "Komunikasi", "Konten Situs"]);
    expect(labels(groups)).not.toContain("Aktivitas");
    expect(labels(groups)).not.toContain("Pengaturan");
    expect(groups.flatMap((group) => group.items).every((item) => item.access === "read")).toBe(true);
  });

  test("editor sees every group except Sistem, and writes only in granted areas", () => {
    const groups = visibleNav({ role: "editor", areas: ["konten"] });
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

  test("an editor with no areas is a read-only editor", () => {
    const items = visibleNav({ role: "editor", areas: [] }).flatMap((group) => group.items);
    expect(items.every((item) => item.access === "read")).toBe(true);
  });

  test("a student, or nobody, sees no menu", () => {
    expect(visibleNav({ role: "student", areas: [] })).toEqual([]);
    expect(visibleNav(null)).toEqual([]);
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
    expect(accessToPath({ role: "editor", areas: ["konten"] }, "/blog/new")).toBe("write");
    expect(accessToPath({ role: "editor", areas: ["konten"] }, "/messages")).toBe("read");
    expect(accessToPath({ role: "viewer", areas: [] }, "/audit")).toBe("none");
    expect(accessToPath({ role: "super_admin", areas: [] }, "/audit")).toBe("write");
  });
  test("an unknown path is none", () => {
    expect(accessToPath({ role: "super_admin", areas: [] }, "/nowhere")).toBe("none");
  });
});

describe("visibleQuickActions", () => {
  const hrefs = (me: Parameters<typeof visibleQuickActions>[0]) => visibleQuickActions(me).map((action) => action.href);

  test("a viewer gets none", () => {
    expect(hrefs({ role: "viewer", areas: [] })).toEqual([]);
    expect(hrefs({ role: "viewer", areas: ["konten", "komunikasi"] })).toEqual([]);
  });

  test("an editor gets the ones in granted areas only", () => {
    expect(hrefs({ role: "editor", areas: ["konten"] })).toEqual(["/blog/new", "/reports/new", "/team/new"]);
    expect(hrefs({ role: "editor", areas: ["komunikasi"] })).toEqual(["/announcements/new"]);
    expect(hrefs({ role: "editor", areas: ["pendaftaran"] })).toEqual([]);
  });

  test("super_admin gets all of them", () => {
    expect(hrefs({ role: "super_admin", areas: [] })).toEqual(QUICK_ACTIONS.map((action) => action.href));
  });

  test("every shortcut leads to a path under a menu entry", () => {
    for (const action of QUICK_ACTIONS) expect(navItemFor(action.href)).not.toBeNull();
  });
});
