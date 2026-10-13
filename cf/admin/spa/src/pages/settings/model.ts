import type { TagTone } from "@/components/ui/tag";
import { makeStatusMap } from "~/components/crud/StatusTag";
import type { ListSpec } from "~/lib/crud/query";
import type { Area } from "~/lib/me";

// What the Pengaturan screens share: the types, the words, the list's spec and the form's values
// (docs/cloudflare/admin-sistem.md). The wording is the legacy settings page's (app/(admin)/admin/settings/*),
// changed only where the rules changed: an admin is invited, deactivated rather than deleted, and an editor has areas.

export const API_PATH = "/api/admin/users";
export const ROUTE = "/settings";

export type AdminRole = "super_admin" | "editor" | "viewer";
export type AdminStatus = "active" | "invited" | "deactivated";

/** An admin as `GET /api/admin/users` answers it (`present` in src/api/admin-users.ts). */
export interface AdminItem {
  id: string;
  name: string;
  email: string;
  role: AdminRole;
  /** An editor's areas, in the menu's order; empty for every other role. */
  areas: Area[];
  status: AdminStatus;
  emailVerified: boolean;
  deactivatedAt: string | null;
  /** When the newest session that has not expired began. Not a login history: sessions go at sign-out and at expiry. */
  lastSessionAt: string | null;
  createdAt: string;
  /** The version `If-Match` wants back. */
  updatedAt: string;
}

export const ROLES: readonly AdminRole[] = ["super_admin", "editor", "viewer"];

export const ROLE_LABEL: Record<AdminRole, string> = {
  super_admin: "Super Admin",
  editor: "Editor",
  viewer: "Viewer",
};

export const ROLE_TONE: Record<AdminRole, TagTone> = {
  super_admin: "soft",
  editor: "green",
  viewer: "gray",
};

/** The legacy hints, rewritten for the permission model of docs/cloudflare/d1-schema.md: an editor has areas, a viewer reads all but Sistem. */
export const ROLE_HINT: Record<AdminRole, string> = {
  super_admin: "Akses penuh, termasuk Sistem: mengelola admin lain dan melihat log aktivitas.",
  editor: "Bisa melihat dan mengubah area yang dipilih di bawah. Area lain tidak terlihat.",
  viewer: "Hanya bisa membaca semua area, kecuali Sistem. Tidak bisa mengubah apa pun.",
};

/**
 * What the Worker derives and the screen shows (`statusOf` in src/api/admin-users.ts; SAKEM-089):
 *   Aktif     has a way to sign in (an account) and is not deactivated. An admin made with a password is Aktif at
 *             once: nobody has to verify an address, so there is nothing to wait for.
 *   Diundang  an invitation nobody has opened: no account yet. The only state that offers "Kirim ulang undangan".
 *   Nonaktif  deactivated (wins over the others); the way back is "Aktifkan lagi".
 */
export const STATUS = makeStatusMap({
  active: { label: "Aktif", tone: "green" },
  invited: { label: "Diundang", tone: "amber" },
  deactivated: { label: "Nonaktif", tone: "gray" },
});

export const AREAS: readonly Area[] = ["pendaftaran", "komunikasi", "konten"];

/** The sidebar's group names (lib/nav.ts). */
export const AREA_LABEL: Record<Area, string> = {
  pendaftaran: "Pendaftaran",
  komunikasi: "Komunikasi",
  konten: "Konten Situs",
};

/** The menus each area opens (docs/cloudflare/admin-ia.md), so a person ticking a box sees what it gives. */
export const AREA_MENUS: Record<Area, string> = {
  pendaftaran: "Batch, Pendaftar, Pusat Dokumen",
  komunikasi: "Pesan, Pengumuman",
  konten: "Blog, Laporan, Tim, Shortlink",
};

/** What the list offers: the same names as the Worker's filters and sorts (adminListSpec in src/api/admin-users.ts). */
export const LIST_SPEC: ListSpec = {
  filters: ["role", "status"],
  sorts: ["email", "name", "role", "createdAt"],
  defaultSort: "email",
  // A school has a handful of admins: the whole list is one page.
  pageSize: 50,
};

export const FIELD_LABELS: Record<string, string> = {
  email: "Email",
  name: "Nama",
  password: "Password",
  emailConfirm: "Ketik ulang email",
  role: "Peran",
  areas: "Area",
};

// ----------------------------------------------------------------------- the form

export interface AdminValues extends Record<string, string | boolean> {
  email: string;
  name: string;
  password: string;
  /** Typed again when a password is given: that admin signs in at once, never verified by email (SAKEM-089). */
  emailConfirm: string;
  role: AdminRole;
  pendaftaran: boolean;
  komunikasi: boolean;
  konten: boolean;
}

/** A new admin starts as an editor, as in the legacy form. */
export function toValues(item: AdminItem | null): AdminValues {
  return {
    email: item?.email ?? "",
    name: item?.name ?? "",
    password: "",
    emailConfirm: "",
    role: item?.role ?? "editor",
    pendaftaran: item?.areas.includes("pendaftaran") ?? false,
    komunikasi: item?.areas.includes("komunikasi") ?? false,
    konten: item?.areas.includes("konten") ?? false,
  };
}

/**
 * An admin made with a password signs in at once and is never verified by email, so a mistyped address would hand
 * the role to whoever owns it (Dzul's decision, 2026-10-13): the address is typed twice, and the form refuses a
 * difference before anything is sent. Case and surrounding spaces do not count as a difference.
 */
export function emailsDiffer(values: AdminValues): boolean {
  return values.password !== "" && values.email.trim().toLowerCase() !== values.emailConfirm.trim().toLowerCase();
}

/** The areas ticked, if the role is an editor (the other roles have none: the Worker refuses areas for them). */
export function areasOf(values: AdminValues): Area[] {
  return values.role === "editor" ? AREAS.filter((area) => values[area] === true) : [];
}

/** The body of `POST`: the password only when one was typed (without it the admin is invited by email). */
export function toCreateBody(values: AdminValues) {
  return {
    email: values.email.trim(),
    name: values.name,
    role: values.role,
    ...(values.password !== "" ? { password: values.password } : {}),
    ...(values.role === "editor" ? { areas: areasOf(values) } : {}),
  };
}

/** The body of `PUT /:id`: the whole form. */
export function toUpdateBody(values: AdminValues) {
  return { name: values.name, role: values.role, areas: areasOf(values) };
}
