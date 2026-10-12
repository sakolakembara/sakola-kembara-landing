// Role model ported from the legacy app (lib/db/schema/users.ts, docs/architecture/authentication.md).
//
//   role          read admin data   write admin data   settings
//   student       no                no                 no
//   viewer        yes               no (read-only)     no
//   editor        yes               yes                no
//   super_admin   yes               yes                yes
//
// These helpers are the only place the matrix is spelled out. Route guards
// (src/auth/guard.ts) call them; never compare role strings elsewhere.

export const userRoles = ["student", "viewer", "editor", "super_admin"] as const;
export type UserRole = (typeof userRoles)[number];

export const adminRoles = ["viewer", "editor", "super_admin"] as const;
export type AdminRole = (typeof adminRoles)[number];

export type Access = "admin-read" | "admin-write" | "super-admin";

const allowed: Record<Access, readonly UserRole[]> = {
  "admin-read": ["viewer", "editor", "super_admin"],
  "admin-write": ["editor", "super_admin"],
  "super-admin": ["super_admin"],
};

export function isUserRole(role: unknown): role is UserRole {
  return typeof role === "string" && (userRoles as readonly string[]).includes(role);
}

export function isAdminRole(role: unknown): role is AdminRole {
  return typeof role === "string" && (adminRoles as readonly string[]).includes(role);
}

/** Unknown roles (a typo, a row from a newer schema) get no access. */
export function can(role: unknown, access: Access): boolean {
  return isUserRole(role) && allowed[access].includes(role);
}
