import type { Area, Me } from "./me";

// The one place that decides what a signed-in user may see and do in the UI.
// The Worker re-checks every request (src/auth/guard.ts): this only hides what
// the server would refuse, so nobody is offered a button that cannot work.
//
//   super_admin    write everywhere, including Sistem
//   editor         write in the areas granted to them, read everywhere else;
//                  no Sistem
//   viewer         read everywhere except Sistem; never write
//   student/other  nothing (students use the portal, not this app)

/**
 * A part of the app: a grantable work area, "sistem" (Aktivitas and
 * Pengaturan, super_admin only) or "umum" (pages open to every admin role,
 * such as the dashboard).
 */
export type Section = Area | "sistem" | "umum";

export type Access = "none" | "read" | "write";

const GRANTABLE: readonly Section[] = ["pendaftaran", "komunikasi", "konten"];

export function accessTo(me: Pick<Me, "role" | "areas"> | null | undefined, section: Section): Access {
  if (!me) return "none";
  switch (me.role) {
    case "super_admin":
      return "write";
    case "editor":
      if (section === "sistem") return "none";
      if (!GRANTABLE.includes(section)) return "read";
      return (me.areas as readonly string[]).includes(section) ? "write" : "read";
    case "viewer":
      return section === "sistem" ? "none" : "read";
    default:
      // Students and any role this build does not know.
      return "none";
  }
}
