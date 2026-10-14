import type { MiddlewareHandler } from "hono";
import { STUDENT_AUDIENCE } from "../auth/audience";
import { createAuth, type Auth } from "../auth/factory";
import type { AppEnv } from "../context";

// Makes `c.get("auth")()` available on the portal Worker, for the student audience. The same closure as `authContext`
// of src/auth/session.ts (the admin's), on purpose a copy in the portal's own folder: the admin's file is the one a
// performance change reworks, and the portal must not make that change harder. If `authContext` is changed (the
// instance cached, built differently), mirror it here.
//
// Lazy, like the admin's: Better Auth is built on the first call, so a request that never touches auth (a 404, a
// `config`, a request without the portal's cookie: see src/portal/guard.ts) pays nothing for it.

export const studentAuthContext: MiddlewareHandler<AppEnv> = async (c, next) => {
  let auth: Auth | undefined;
  c.set("auth", () => {
    auth ??= createAuth(c.env, {
      baseURL: new URL(c.req.url).origin,
      waitUntil: (promise) => c.executionCtx.waitUntil(promise),
      audience: STUDENT_AUDIENCE,
    });
    return auth;
  });
  await next();
};
