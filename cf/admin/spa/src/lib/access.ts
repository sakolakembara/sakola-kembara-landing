import { type AdminArea, isAdminRole, type Me } from "./me";

// The one place that decides what a signed-in user may see and do in the UI.
// The Worker re-checks every request (src/auth/guard.ts): this only hides what
// the server would refuse, so nobody is offered a button that cannot work.
//
// The rules themselves are not written here. The Worker works them out
// (src/auth/permissions.ts: super_admin writes everywhere, an editor writes in
// the areas granted to them and reads the rest except Sistem, a viewer reads
// everything except Sistem, a student nothing) and says the result in
// `GET /api/me` as `areas.visible` and `areas.writable`; this function reads
// those lists. spa/test/access.test.ts checks it against the Worker's own
// functions for every role and every set of grants.

/**
 * A part of the app: one of the Worker's areas (pendaftaran, komunikasi,
 * konten, sistem) or "umum", for pages open to every admin role such as the
 * dashboard.
 */
export type Section = AdminArea | "umum";

export type Access = "none" | "read" | "write";

export function accessTo(me: Pick<Me, "role" | "areas"> | null | undefined, section: Section): Access {
  // Whatever the lists say, an account that is not an admin (a student, a role
  // this build does not know) gets nothing.
  if (!me || !isAdminRole(me.role)) return "none";
  if (section === "umum") return "read";
  if (me.areas.writable.includes(section)) return "write";
  if (me.areas.visible.includes(section)) return "read";
  return "none";
}
