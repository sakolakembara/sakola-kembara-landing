// One Better Auth, two audiences (docs/cloudflare/auth.md#base-path-and-audience). The admin Worker serves the `admin`
// audience on `admin.<domain>/api/auth`, the portal Worker serves the `student` audience on `<apex>/portal/api/auth`.
// They share the user, session and account tables, so what keeps a student's cookie out of the admin and an admin's out
// of the portal is not the database but these three things, per audience:
//   * the mount point (`basePath`) and the SPA page an auth failure lands on (`errorPath`),
//   * the cookie name (`cookiePrefix`): `better-auth` for the admin, `sakem-student` for the portal, because cookies on
//     `localhost` ignore the port and the two dev servers would otherwise sign each other out,
//   * the signing secret: each Worker has its own `BETTER_AUTH_SECRET` (a deploy step; a test cannot see it), so a token
//     that is valid for one audience is refused by the other even if a cookie is copied or planted.
// Who may use the DATA routes is decided elsewhere: by role and area on the admin (src/auth/guard.ts), by role `student`
// on the portal (src/portal/guard.ts). Any account may sign in at either: the portal answers an admin account with
// `403 student_only` on its data routes and shows a screen that links to the admin.
//
// A file of its own, with no import, so that src/auth/factory.ts (the one a performance change would rework) carries
// only a handful of changed lines for the audience. The admin's values are the literals the constants of factory.ts
// (`AUTH_BASE_PATH`, `AUTH_ERROR_PATH`) have always had; test/portal-auth.test.ts pins that they are equal.

export interface AuthAudience {
  name: "admin" | "student";
  /** Better Auth's mount point. The SPA and the email links use this prefix. */
  basePath: string;
  /** SPA route Better Auth sends the browser to when an auth call fails. */
  errorPath: string;
  /** Start of the session cookie's name (`<prefix>.session_token`). In production it gets `__Host-` in front. */
  cookiePrefix: string;
}

export const ADMIN_AUDIENCE: AuthAudience = { name: "admin", basePath: "/api/auth", errorPath: "/auth/error", cookiePrefix: "better-auth" };
export const STUDENT_AUDIENCE: AuthAudience = { name: "student", basePath: "/portal/api/auth", errorPath: "/portal/auth/error", cookiePrefix: "sakem-student" };
