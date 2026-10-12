// Role names, ported from the legacy app (lib/db/schema/users.ts,
// docs/architecture/authentication.md). What each role may do in each area is
// not decided here but in src/auth/permissions.ts (`can`), which is the only
// place a role is compared against an area and an action. Never compare role
// strings elsewhere.

export const userRoles = ["student", "viewer", "editor", "super_admin"] as const;
export type UserRole = (typeof userRoles)[number];

export const adminRoles = ["viewer", "editor", "super_admin"] as const;
export type AdminRole = (typeof adminRoles)[number];

export function isUserRole(role: unknown): role is UserRole {
  return typeof role === "string" && (userRoles as readonly string[]).includes(role);
}

export function isAdminRole(role: unknown): role is AdminRole {
  return typeof role === "string" && (adminRoles as readonly string[]).includes(role);
}
