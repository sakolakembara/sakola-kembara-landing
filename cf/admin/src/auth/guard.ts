import type { MiddlewareHandler } from "hono";
import type { AppEnv } from "../context";
import { can, type Access } from "./roles";
import { currentUser } from "./session";

/**
 * Route guard, the port of requireAdmin / requireSuperAdmin from
 * lib/auth-helpers.ts. 401 when nobody is signed in, 403 when the role is not
 * enough. `viewer` passes "admin-read" only, which is what makes viewer
 * read-only (SAKEM-013).
 */
export function requireAccess(access: Access): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const user = await currentUser(c);
    if (!user) return c.json({ error: "unauthenticated" }, 401);
    if (!can(user.role, access)) return c.json({ error: "forbidden" }, 403);
    c.set("user", user);
    await next();
  };
}
