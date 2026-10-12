// The signed-in user as the SPA sees it. `GET /api/me` answers
// `{ user: { id, email, name, role, emailVerified, areas } }`; this file is the
// only place that turns that payload into a `Me`. The server stays the
// authority (it checks role and area on every write); the UI uses `Me` only to
// decide what to show.

export const ROLES = ["student", "viewer", "editor", "super_admin"] as const;
export type Role = (typeof ROLES)[number];

/**
 * The work areas an editor can be granted (docs/cloudflare/admin-ia.md). Each
 * maps to a sidebar group: pendaftaran = Pendaftaran, komunikasi = Komunikasi,
 * konten = Konten Situs. "Sistem" is not an area: only super_admin has it.
 */
export const AREAS = ["pendaftaran", "komunikasi", "konten"] as const;
export type Area = (typeof AREAS)[number];

export interface Me {
  id: string;
  email: string;
  name: string;
  role: Role;
  emailVerified: boolean;
  /** Areas an `editor` may change things in. Ignored for every other role. */
  areas: Area[];
}

function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value);
}

function isArea(value: unknown): value is Area {
  return typeof value === "string" && (AREAS as readonly string[]).includes(value);
}

/**
 * Reads the `/api/me` body. Unknown or missing pieces fall to the least
 * privileged value, the same rule the Worker applies to an unknown role:
 *  - an unknown role becomes `student` (no admin access at all);
 *  - a missing or malformed `areas` becomes `[]` (an editor then sees every
 *    screen read-only until the server says otherwise);
 *  - areas the SPA does not know are dropped.
 * `areas` is read from `user.areas`, with `areas` next to `user` accepted too,
 * so a backend that puts it either way works.
 */
export function parseMe(body: unknown): Me | null {
  if (typeof body !== "object" || body === null) return null;
  const root = body as { user?: unknown; areas?: unknown };
  const user = root.user;
  if (typeof user !== "object" || user === null) return null;
  const raw = user as Record<string, unknown>;
  if (typeof raw.id !== "string" || typeof raw.email !== "string") return null;

  const rawAreas = Array.isArray(raw.areas) ? raw.areas : Array.isArray(root.areas) ? root.areas : [];
  const areas = [...new Set(rawAreas.filter(isArea))];

  return {
    id: raw.id,
    email: raw.email,
    name: typeof raw.name === "string" ? raw.name : "",
    role: isRole(raw.role) ? raw.role : "student",
    emailVerified: raw.emailVerified === true,
    areas,
  };
}

/** Name for greetings: the display name, else the part of the email before "@". */
export function displayName(me: Pick<Me, "name" | "email">): string {
  const name = me.name.trim();
  if (name) return name;
  return me.email.split("@")[0] || "Admin";
}
