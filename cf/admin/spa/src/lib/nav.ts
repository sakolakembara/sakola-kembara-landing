import { type Access, accessTo, type Section } from "./access";
import type { Me } from "./me";

// The menu of docs/cloudflare/admin-ia.md, main proposal (A). To add a page,
// add one item here: the sidebar, the routes, the 403 check and the
// placeholder all read this list (see "SPA shell" in docs/cloudflare/admin-skeleton.md).

export interface NavItem {
  /** Route in the SPA. "/" is the dashboard. */
  path: string;
  /** Text in the sidebar. */
  label: string;
  /** Title of the page when it differs from the label. */
  title?: string;
  /** What a user needs to open it: any access except "none" shows it. */
  section: Section;
}

export interface NavGroup {
  id: string;
  /** Heading above the items; null for the dashboard, which stands alone. */
  label: string | null;
  items: NavItem[];
}

export const NAV: readonly NavGroup[] = [
  { id: "utama", label: null, items: [{ path: "/", label: "Dashboard", section: "umum" }] },
  {
    id: "pendaftaran",
    label: "Pendaftaran",
    items: [
      { path: "/batches", label: "Batch", title: "Batch Pendaftaran", section: "pendaftaran" },
      { path: "/applications", label: "Pendaftar", section: "pendaftaran" },
      // Was "Berkas Pendaftaran"; the name the public page and the wizard use.
      { path: "/resources", label: "Pusat Dokumen", section: "pendaftaran" },
    ],
  },
  {
    id: "komunikasi",
    label: "Komunikasi",
    items: [
      { path: "/messages", label: "Pesan", section: "komunikasi" },
      { path: "/announcements", label: "Pengumuman", section: "komunikasi" },
    ],
  },
  {
    id: "konten",
    label: "Konten Situs",
    items: [
      { path: "/blog", label: "Blog", section: "konten" },
      { path: "/reports", label: "Laporan", section: "konten" },
      { path: "/team", label: "Tim", section: "konten" },
      { path: "/shortlinks", label: "Shortlink", section: "konten" },
    ],
  },
  {
    id: "sistem",
    label: "Sistem",
    items: [
      { path: "/audit", label: "Aktivitas", section: "sistem" },
      { path: "/settings", label: "Pengaturan", section: "sistem" },
    ],
  },
];

export const NAV_ITEMS: readonly NavItem[] = NAV.flatMap((group) => group.items);

export interface VisibleNavItem extends NavItem {
  /** "read" means the page opens but shows no create, edit or delete controls. */
  access: Exclude<Access, "none">;
}

export interface VisibleNavGroup {
  id: string;
  label: string | null;
  items: VisibleNavItem[];
}

/** The sidebar for one user: items they cannot open are left out, empty groups too. */
export function visibleNav(me: Pick<Me, "role" | "areas"> | null | undefined): VisibleNavGroup[] {
  const groups: VisibleNavGroup[] = [];
  for (const group of NAV) {
    const items: VisibleNavItem[] = [];
    for (const item of group.items) {
      const access = accessTo(me, item.section);
      if (access !== "none") items.push({ ...item, access });
    }
    if (items.length > 0) groups.push({ id: group.id, label: group.label, items });
  }
  return groups;
}

/** The menu entry a pathname belongs to ("/blog/new" belongs to "/blog"), or null. */
export function navItemFor(pathname: string): NavItem | null {
  const clean = pathname.replace(/\/+$/, "") || "/";
  return (
    NAV_ITEMS.find((item) => item.path === clean) ??
    NAV_ITEMS.find((item) => item.path !== "/" && clean.startsWith(`${item.path}/`)) ??
    null
  );
}

/** What the user may do on the page at `path` (a menu path or one below it): "none" for an unknown path. */
export function accessToPath(me: Pick<Me, "role" | "areas"> | null | undefined, path: string): Access {
  const item = navItemFor(path);
  return item ? accessTo(me, item.section) : "none";
}

export interface QuickAction {
  href: string;
  label: string;
  section: Section;
  icon: "blog" | "announcement" | "report" | "team";
}

/** "Tindakan Cepat" on the dashboard. Each needs write access to its section. */
export const QUICK_ACTIONS: readonly QuickAction[] = [
  { href: "/blog/new", label: "Tulis artikel", section: "konten", icon: "blog" },
  { href: "/announcements/new", label: "Buat pengumuman", section: "komunikasi", icon: "announcement" },
  { href: "/reports/new", label: "Unggah laporan", section: "konten", icon: "report" },
  { href: "/team/new", label: "Tambah anggota tim", section: "konten", icon: "team" },
];

export function visibleQuickActions(me: Pick<Me, "role" | "areas"> | null | undefined): QuickAction[] {
  return QUICK_ACTIONS.filter((action) => accessTo(me, action.section) === "write");
}
