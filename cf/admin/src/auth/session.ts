import type { Context, MiddlewareHandler } from "hono";
import type { AppEnv, AuthUser } from "../context";
import { isUserRole } from "./roles";
import { createAuth, type Auth } from "./factory";

/**
 * Makes `c.get("auth")()` available. Better Auth is created on first call, so
 * a request that never touches auth (a 404) pays nothing for it.
 */
export const authContext: MiddlewareHandler<AppEnv> = async (c, next) => {
  let auth: Auth | undefined;
  c.set("auth", () => {
    auth ??= createAuth(c.env, {
      baseURL: new URL(c.req.url).origin,
      waitUntil: (promise) => c.executionCtx.waitUntil(promise),
    });
    return auth;
  });
  await next();
};

/**
 * The signed-in user for this request, or null. Better Auth reads the session
 * and the user row from D1 on every call (no cookie cache), so a role changed
 * in the database applies to the very next request.
 *
 * A deactivated account is null even if a session row is still around:
 * deactivating deletes the sessions and the session hook refuses new ones, and
 * this check is the third line (it closes the window where a sign-in that
 * started before the deactivation finishes after it).
 */
export async function currentUser(c: Context<AppEnv>): Promise<AuthUser | null> {
  const session = await c.get("auth")().api.getSession({ headers: c.req.raw.headers });
  if (!session) return null;
  const { id, email, name, emailVerified } = session.user;
  if ((session.user as { deactivatedAt?: unknown }).deactivatedAt) return null;
  const role: unknown = (session.user as { role?: unknown }).role;
  // An unknown role is treated as the least privileged one.
  return { id, email, name, emailVerified, role: isUserRole(role) ? role : "student" };
}
