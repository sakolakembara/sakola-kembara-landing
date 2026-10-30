// The signed-in user as the SPA sees it. `GET /api/me` answers
//
//   { user: { id, email, name, role, emailVerified },
//     areas: { granted: [...], visible: [...], writable: [...] } }
//
// (src/worker.ts, computed by src/auth/permissions.ts, the same functions the
// route guards use). This file is the only place that turns that payload into a
// `Me`. The server stays the authority (it checks role and area on every
// request); the UI uses `Me` only to decide what to show.

export const ROLES = ["student", "viewer", "editor", "super_admin"] as const;
export type Role = (typeof ROLES)[number];

export const ADMIN_ROLES = ["viewer", "editor", "super_admin"] as const;

/**
 * The work areas an editor can be granted (docs/cloudflare/admin-ia.md). Each
 * maps to a sidebar group: pendaftaran = Pendaftaran, komunikasi = Komunikasi,
 * konten = Konten Situs.
 */
export const AREAS = ["pendaftaran", "komunikasi", "konten"] as const;
export type Area = (typeof AREAS)[number];

/** Every area the server reports on: the grantable ones and "sistem" (Aktivitas, Pengaturan), which cannot be granted. */
export const ADMIN_AREAS = [...AREAS, "sistem"] as const;
export type AdminArea = (typeof ADMIN_AREAS)[number];

export interface MeAreas {
  /** An editor's own grants (Pengaturan shows them). Empty for every other role. */
  granted: Area[];
  /** Areas whose pages this user may open (read or write). */
  visible: AdminArea[];
  /** Areas where this user may change things. */
  writable: AdminArea[];
}

export interface Me {
  id: string;
  email: string;
  name: string;
  role: Role;
  emailVerified: boolean;
  areas: MeAreas;
}

function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value);
}

export function isAdminRole(value: unknown): boolean {
  return typeof value === "string" && (ADMIN_ROLES as readonly string[]).includes(value);
}

function isArea(value: unknown): value is Area {
  return typeof value === "string" && (AREAS as readonly string[]).includes(value);
}

function isAdminArea(value: unknown): value is AdminArea {
  return typeof value === "string" && (ADMIN_AREAS as readonly string[]).includes(value);
}

function names<T>(value: unknown, keep: (item: unknown) => item is T): T[] {
  return Array.isArray(value) ? [...new Set(value.filter(keep))] : [];
}

/**
 * Reads the `/api/me` body. Unknown or missing pieces fall to the least
 * privileged value, the same rule the Worker applies to an unknown role:
 *  - an unknown role becomes `student` (no admin access at all);
 *  - a missing or malformed `areas`, or one list of it, becomes `[]` (nothing
 *    is shown for it until the server says otherwise);
 *  - area names the SPA does not know are dropped.
 */
export function parseMe(body: unknown): Me | null {
  if (typeof body !== "object" || body === null) return null;
  const root = body as { user?: unknown; areas?: unknown };
  const user = root.user;
  if (typeof user !== "object" || user === null) return null;
  const raw = user as Record<string, unknown>;
  if (typeof raw.id !== "string" || typeof raw.email !== "string") return null;

  const areas = typeof root.areas === "object" && root.areas !== null ? (root.areas as Record<string, unknown>) : {};

  return {
    id: raw.id,
    email: raw.email,
    name: typeof raw.name === "string" ? raw.name : "",
    role: isRole(raw.role) ? raw.role : "student",
    emailVerified: raw.emailVerified === true,
    areas: {
      granted: names(areas.granted, isArea),
      visible: names(areas.visible, isAdminArea),
      writable: names(areas.writable, isAdminArea),
    },
  };
}

/** Name for greetings: the display name, else the part of the email before "@". */
export function displayName(me: Pick<Me, "name" | "email">): string {
  const name = me.name.trim();
  if (name) return name;
  return me.email.split("@")[0] || "Admin";
}

/** Two capitals for the avatar: the first letters of the first two words of the name, or the first two letters of a single word. */
export function initials(me: Pick<Me, "name" | "email">): string {
  const words = displayName(me).split(/\s+/).filter(Boolean);
  const letters = words.length > 1 ? words.slice(0, 2).map((word) => [...word][0]) : [...(words[0] ?? "A")].slice(0, 2);
  return letters.join("").toUpperCase();
}
