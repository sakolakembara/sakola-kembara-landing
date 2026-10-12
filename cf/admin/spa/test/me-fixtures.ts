import { visibleAreas, writableAreas } from "../../src/auth/permissions";
import { AREAS, type Area, type Me, type MeAreas, type Role } from "~/lib/me";

// Test payloads built with the Worker's own functions (src/auth/permissions.ts,
// the ones behind GET /api/me), so what the SPA tests feed it is what the real
// API would answer for that role and those grants.

/** Every set of grants an editor could have: the eight subsets of the three areas. */
export const GRANT_SETS: Area[][] = Array.from({ length: 1 << AREAS.length }, (_, mask) =>
  AREAS.filter((_, index) => mask & (1 << index)),
);

/** The `areas` part of `/api/me`. Only an editor has grants (src/auth/guard.ts `loadAccess`). */
export function areasFor(role: Role, granted: readonly Area[] = []): MeAreas {
  const own = role === "editor" ? [...granted] : [];
  return { granted: own, visible: visibleAreas(role, own), writable: writableAreas(role, own) };
}

export function meFor(role: Role, granted: readonly Area[] = []): Me {
  return { id: "user-1", email: "tester@contoh.test", name: "Tester", role, emailVerified: true, areas: areasFor(role, granted) };
}
