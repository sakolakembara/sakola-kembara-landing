// Permission model for the admin API (SAKEM-081, editor rule changed in SAKEM-082).
// Pure: no I/O, no Hono, no database. The guard in src/auth/guard.ts loads the
// user's role and area grants from D1 on every request and asks this module.
//
// Decided by Dzul (IA admin, docs/cloudflare/admin-ia.md, SAKEM-081 comment of
// 2026-10-12; the editor row follows the SAKEM-082 decision of the same day):
//
//   role          pendaftaran    komunikasi     konten         sistem
//   student       -              -              -              -
//   viewer        read           read           read           -
//   editor        read, write*   read, write*   read, write*   -
//   super_admin   read, write    read, write    read, write    read, write
//
//   * only in the areas granted to that editor (admin_area_grants), and
//     nothing at all (not even a read) in the other areas.
//
// - `viewer` is strictly read-only, whatever rows exist in admin_area_grants.
// - `editor` reads and writes inside the areas granted to them and has no
//   access outside them: those menus are hidden in the SPA and their API reads
//   are refused with 403. An editor with no grants can open the dashboard and
//   nothing else (the dashboard has no area: every admin role may open it).
// - `sistem` (Pengaturan: admin users and area grants, Aktivitas: audit log)
//   is `super_admin` only, and cannot be granted.
// - `student` uses the portal only and never reaches this API's admin areas.
// - Unknown roles, areas and actions get nothing.

import { isUserRole } from "./roles";

/** Areas an editor can be granted. `sistem` is deliberately not one of them. */
export const grantableAreas = ["pendaftaran", "komunikasi", "konten"] as const;
export type GrantableArea = (typeof grantableAreas)[number];

export const adminAreas = [...grantableAreas, "sistem"] as const;
export type AdminArea = (typeof adminAreas)[number];

export const areaActions = ["read", "write"] as const;
export type AreaAction = (typeof areaActions)[number];

export type AreaLevel = "none" | "read" | "write";

export function isAdminArea(value: unknown): value is AdminArea {
  return typeof value === "string" && (adminAreas as readonly string[]).includes(value);
}

export function isGrantableArea(value: unknown): value is GrantableArea {
  return typeof value === "string" && (grantableAreas as readonly string[]).includes(value);
}

function isAreaAction(value: unknown): value is AreaAction {
  return typeof value === "string" && (areaActions as readonly string[]).includes(value);
}

/**
 * What `role` may do in `area`. `grantedAreas` is the editor's rows from
 * admin_area_grants; it only matters for editors, and anything in it that is
 * not a grantable area name is ignored.
 */
export function levelIn(role: unknown, grantedAreas: readonly unknown[], area: unknown): AreaLevel {
  if (!isUserRole(role) || !isAdminArea(area)) return "none";
  switch (role) {
    case "super_admin":
      return "write";
    case "viewer":
      return area === "sistem" ? "none" : "read";
    case "editor":
      if (area === "sistem") return "none";
      return grantedAreas.includes(area) ? "write" : "none";
    case "student":
      return "none";
  }
}

/** The one place a (role, grants, area, action) question is answered. */
export function can(role: unknown, grantedAreas: readonly unknown[], area: AdminArea, action: AreaAction): boolean {
  if (!isAreaAction(action)) return false;
  const level = levelIn(role, grantedAreas, area);
  return action === "read" ? level !== "none" : level === "write";
}

/** Areas whose menus this user can open (read or write), in sidebar order. */
export function visibleAreas(role: unknown, grantedAreas: readonly unknown[]): AdminArea[] {
  return adminAreas.filter((area) => levelIn(role, grantedAreas, area) !== "none");
}

/** Areas where this user can change things, in sidebar order. */
export function writableAreas(role: unknown, grantedAreas: readonly unknown[]): AdminArea[] {
  return adminAreas.filter((area) => levelIn(role, grantedAreas, area) === "write");
}

export const areaLabels: Record<AdminArea, string> = {
  pendaftaran: "Pendaftaran",
  komunikasi: "Komunikasi",
  konten: "Konten Situs",
  sistem: "Sistem",
};

/**
 * Sidebar of docs/cloudflare/admin-ia.md section 3.1, one entry per menu with
 * the area it belongs to. `key` is the path segment of the IA site map, which
 * is also the resource name of the API. "Dashboard" is not here: every admin
 * role may open it (viewer, editor, super_admin).
 */
export const menuItems = [
  { key: "batches", label: "Batch", area: "pendaftaran" },
  { key: "applications", label: "Pendaftar", area: "pendaftaran" },
  { key: "resources", label: "Pusat Dokumen", area: "pendaftaran" },
  { key: "messages", label: "Pesan", area: "komunikasi" },
  { key: "announcements", label: "Pengumuman", area: "komunikasi" },
  { key: "blog", label: "Blog", area: "konten" },
  { key: "reports", label: "Laporan", area: "konten" },
  { key: "team", label: "Tim", area: "konten" },
  { key: "shortlinks", label: "Shortlink", area: "konten" },
  { key: "audit", label: "Aktivitas", area: "sistem" },
  { key: "settings", label: "Pengaturan", area: "sistem" },
] as const satisfies readonly { key: string; label: string; area: AdminArea }[];

export type MenuKey = (typeof menuItems)[number]["key"];

/** The menu entries this user can open, in sidebar order. */
export function visibleMenu(role: unknown, grantedAreas: readonly unknown[]) {
  const areas = visibleAreas(role, grantedAreas);
  return menuItems.filter((item) => areas.includes(item.area));
}
