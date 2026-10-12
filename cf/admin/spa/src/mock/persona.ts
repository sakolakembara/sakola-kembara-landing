import { AREAS, type Area, type Role, ROLES } from "~/lib/me";

// MOCK, local development only (see mock/install.ts). Not part of any build
// that ships.

export interface Persona {
  role: Role;
  areas: Area[];
}

const FALLBACK: Persona = { role: "super_admin", areas: [] };

/**
 * Reads the `?mock=` value that picks who the mock signs in as:
 *   viewer · editor · editor:konten,komunikasi · editor:- (no areas) ·
 *   super_admin · student
 * `editor` alone is granted every area. Anything unrecognised is super_admin.
 */
export function parsePersona(raw: string | null | undefined): Persona {
  if (!raw) return FALLBACK;
  const [role, rest] = raw.split(":");
  if (!(ROLES as readonly string[]).includes(role ?? "")) return FALLBACK;
  const typedRole = role as Role;
  if (typedRole !== "editor") return { role: typedRole, areas: [] };
  if (rest === undefined) return { role: "editor", areas: [...AREAS] };
  const areas = rest
    .split(",")
    .map((area) => area.trim())
    .filter((area): area is Area => (AREAS as readonly string[]).includes(area));
  return { role: "editor", areas };
}
