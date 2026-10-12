import type { Context, MiddlewareHandler } from "hono";
import type { AppEnv, AuthUser } from "../context";
import { loadGrantedAreas } from "../db/grants";
import { can, type AdminArea, type AreaAction, type GrantableArea } from "./permissions";
import { currentUser } from "./session";

export interface Access {
  user: AuthUser;
  /** The editor's area grants; empty for every other role (their rights come from the role alone). */
  grantedAreas: GrantableArea[];
}

/**
 * Who is calling and what they were granted, read from D1 now: Better Auth
 * reads the session and the user row (role) on every call (no cookie cache),
 * and an editor's grants are queried here. Nothing is remembered between
 * requests, so a demotion or a revoked grant applies to the very next one.
 *
 * Only editors have grants worth reading; the query is skipped for the other
 * roles, which keeps viewer and super_admin requests one read cheaper.
 */
export async function loadAccess(c: Context<AppEnv>): Promise<Access | null> {
  const user = await currentUser(c);
  if (!user) return null;
  const grantedAreas = user.role === "editor" ? await loadGrantedAreas(c.env.DB, user.id) : [];
  return { user, grantedAreas };
}

/**
 * Route guard: 401 when nobody is signed in, 403 when (role, area grants) do
 * not allow `action` in `area`. This is the port of requireAdmin /
 * requireSuperAdmin from lib/auth-helpers.ts, extended with areas; the rules
 * are in src/auth/permissions.ts. Put it on every admin route:
 *
 *   reads    requireArea("komunikasi", "read")    viewer, editor, super_admin
 *   changes  requireArea("komunikasi", "write")   an editor granted `komunikasi`, super_admin
 *   system   requireArea("sistem", "read" | "write")   super_admin only
 */
export function requireArea(area: AdminArea, action: AreaAction): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const access = await loadAccess(c);
    if (!access) return c.json({ error: "unauthenticated" }, 401);
    if (!can(access.user.role, access.grantedAreas, area, action)) return c.json({ error: "forbidden" }, 403);
    c.set("user", access.user);
    c.set("grantedAreas", access.grantedAreas);
    await next();
  };
}
