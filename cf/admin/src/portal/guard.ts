import type { Context, MiddlewareHandler } from "hono";
import { STUDENT_AUDIENCE } from "../auth/audience";
import { currentUser } from "../auth/session";
import type { AppEnv, AuthUser } from "../context";
import { checkLimits, limitedResponse, type LimitName } from "../security/rate-limit";

// The guard of a student route: steps 2 to 5 of the pipeline in docs/cloudflare/portal-api.md, section 1. Step 1 (the
// same-origin guard on every write) is mounted for the whole API in src/portal/worker.ts, before anything here runs.
// A route file puts it in front of its handlers:
//
//   routes.get("/overview", requireStudent("portalRead"), handler);
//   routes.put("/applications/current/steps/:step", requireStudent("portalSave"), handler);
//
// In order, each step stopping the request, none of them reading the body:
//   2. the session                       401 unauthenticated (a deactivated account has none: src/auth/session.ts)
//   3. the role: `student` and only it   403 student_only (an admin account may sign in on the apex, and gets this on
//                                        every data route; `GET /portal/api/me` is the one route that does not check it)
//   4. a verified email                  403 email_not_verified (defence in depth: an unverified student cannot sign in)
//   5. the route's limiter, by USER ID   429 rate_limited (never by address or email: a school shares one address)
//
// What a route may rely on afterwards: `c.get("user")` is a signed-in, verified student.

/** The limiters a student route may name (src/security/rate-limit.ts). */
export type StudentLimit = Extract<LimitName, "portalRead" | "portalSave" | "portalUpload" | "portalSubmit">;

export const STUDENT_ONLY_MESSAGE = "Halaman ini hanya untuk calon siswa. Pengurus yayasan masuk lewat halaman admin.";
export const EMAIL_NOT_VERIFIED_MESSAGE = "Verifikasi email kamu dulu sebelum melanjutkan. Cek inbox atau folder spam untuk tautan verifikasi.";

/** The role a student data route is for. The only place the portal compares a role (the admin's are in src/auth/permissions.ts). */
const STUDENT_ROLE = "student";

const SESSION_COOKIE_SUFFIX = `${STUDENT_AUDIENCE.cookiePrefix}.session_token=`;

/**
 * Does the request carry the portal's session cookie at all? A header substring, decided before anything is built or
 * read. The name ends the same in development (`sakem-student.session_token`), production (`__Host-` in front) and
 * with COOKIE_DOMAIN (`__Secure-` in front). A request without it has no session, whatever else it carries (the
 * admin's cookie is another name), so nothing that needs Better Auth, a D1 read or a limiter is worth starting.
 */
export function hasStudentSessionCookie(c: Context<AppEnv>): boolean {
  const cookie = c.req.header("cookie");
  return cookie !== undefined && cookie.includes(SESSION_COOKIE_SUFFIX);
}

/**
 * The signed-in account, or null. Without the portal's cookie it is null and costs nothing: Better Auth is not
 * built (a signed-out visitor, a bot, a request that only carries the admin's cookie). With it, exactly
 * `currentUser` of src/auth/session.ts.
 */
export async function currentStudentUser(c: Context<AppEnv>): Promise<AuthUser | null> {
  return hasStudentSessionCookie(c) ? currentUser(c) : null;
}

export function requireStudent(limit?: StudentLimit): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const user = await currentStudentUser(c);
    if (!user) return c.json({ error: "unauthenticated" }, 401);
    if (user.role !== STUDENT_ROLE) return c.json({ error: "student_only", message: STUDENT_ONLY_MESSAGE }, 403);
    if (!user.emailVerified) return c.json({ error: "email_not_verified", message: EMAIL_NOT_VERIFIED_MESSAGE }, 403);
    if (limit) {
      // Key: the limiter's name and the user id. Nothing about the person is in it.
      const result = await checkLimits(c.env, [{ name: limit, key: `${limit}:${user.id}` }]);
      if (!result.allowed) return limitedResponse(result);
    }
    c.set("user", user);
    await next();
  };
}
