import { AsyncLocalStorage } from "node:async_hooks";
import type { Context, MiddlewareHandler } from "hono";
import type { AppEnv, AuthUser } from "../context";
import type { Bindings } from "../env";
import { isUserRole } from "./roles";
import { createAuth, type Auth } from "./factory";

/**
 * What Better Auth needs from the request it is serving: the way to keep a promise alive after the response
 * (`ctx.waitUntil`, for the emails it sends and the audit rows it writes). The Better Auth instance is shared by
 * every request of the isolate (below), so this cannot be captured when the instance is built: it is looked up, per
 * call, in the scope `authContext` opens around the rest of the request.
 */
interface RequestScope {
  waitUntil: (promise: Promise<unknown>) => void;
}
const requestScope = new AsyncLocalStorage<RequestScope>();

function waitUntilOfCurrentRequest(promise: Promise<unknown>): void {
  const scope = requestScope.getStore();
  if (scope) return scope.waitUntil(promise);
  // Only reachable from code that uses the shared instance outside a request (nothing does today). The promise is
  // already running, so the work still happens; it just is not held open past the response. Never a throw: a missing
  // scope must not turn a sign-up into a 500.
  console.error("[auth] background task outside a request scope");
  promise.catch(() => undefined);
}

/**
 * Better Auth, one instance per (D1 binding, configuration, origin) for the life of the isolate.
 *
 * It used to be built on every request, and a profile of the Worker's own JavaScript showed that construction, plus
 * the first call that initialises it (the auth context, the tables, ~40 endpoints with their schemas), as the main
 * per-request cost of every signed-in route and, before the no-cookie shortcut below, of every 401 too
 * (docs/cloudflare/free-plan-audit.md, "CPU on the hot routes"). The instance keeps nothing about a request:
 * sessions are read from D1 on every call (no cookie cache), the per-request state lives in Better Auth's own
 * request-state store, and this is how Better Auth is meant to run on a long-lived server.
 *
 * What an instance depends on is in its key: the D1 binding (its WeakMap), every text variable and secret of the
 * environment (`configKey`) and the origin of the request. Change one of them (a test does, a redeploy does) and a
 * new instance is built; nothing is shared across keys. The number of instances per binding is capped: a request can
 * name any `Host` it likes, and that must not grow memory without bound, so past the cap an instance is built for
 * the one request and dropped, which is the old behaviour.
 */
const MAX_INSTANCES_PER_BINDING = 8;
const instances = new WeakMap<object, Map<string, Auth>>();
let created = 0;

/**
 * Every text variable and secret of the environment, plus the origin. Better Auth and the mail sender read only
 * those (the secret, the origins, the cookie domain, the environment name, the Google credentials, the mail key and
 * sender), so listing all of them, instead of the ones read today, keeps the next one that is read from being missed:
 * change any value and the key changes. Bindings (D1, R2, the rate limits) are objects and are not part of it.
 */
function configKey(env: Bindings, origin: string): string {
  let key = origin;
  for (const [name, value] of Object.entries(env)) if (typeof value === "string") key += `\0${name}=${value}`;
  return key;
}

/** The shared Better Auth for this environment and origin. Exported for the tests; routes use `c.get("auth")()`. */
export function sharedAuth(env: Bindings, origin: string): Auth {
  const key = configKey(env, origin);
  let byKey = instances.get(env.DB);
  if (!byKey) {
    byKey = new Map();
    instances.set(env.DB, byKey);
  }
  const found = byKey.get(key);
  if (found) return found;
  const auth = createAuth(env, { baseURL: origin, waitUntil: waitUntilOfCurrentRequest });
  created += 1;
  if (byKey.size < MAX_INSTANCES_PER_BINDING) byKey.set(key, auth);
  return auth;
}

/** How many Better Auth instances this isolate has built (tests and the CPU measurement read it). */
export function authInstancesBuilt(): number {
  return created;
}

/**
 * Makes `c.get("auth")()` available. Better Auth is looked up on first call, so a request that never touches auth
 * (a 404, a 401 without a session cookie) pays nothing for it, and the rest of the request runs in the scope that
 * gives Better Auth this request's `waitUntil`.
 */
export const authContext: MiddlewareHandler<AppEnv> = async (c, next) => {
  c.set("auth", () => sharedAuth(c.env, new URL(c.req.url).origin));
  await requestScope.run({ waitUntil: (promise) => c.executionCtx.waitUntil(promise) }, next);
};

/**
 * Whether a request can carry a Better Auth session at all: its Cookie header names a `session_token` cookie
 * (`better-auth.session_token`, and the `__Secure-` and `__Host-` forms of it, which all contain the text). A request
 * without one has no session to look up, and Better Auth answers "no session" to it without reading D1, so asking it
 * is pure overhead: the cheap answer is exactly the same answer. Anything that merely looks like a session cookie goes
 * to Better Auth, which checks the signature and D1 as before.
 */
export function mayCarrySession(headers: Pick<Headers, "get">): boolean {
  return headers.get("cookie")?.includes("session_token") === true;
}

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
  if (!mayCarrySession(c.req.raw.headers)) return null;
  const session = await c.get("auth")().api.getSession({ headers: c.req.raw.headers });
  if (!session) return null;
  const { id, email, name, emailVerified } = session.user;
  if ((session.user as { deactivatedAt?: unknown }).deactivatedAt) return null;
  const role: unknown = (session.user as { role?: unknown }).role;
  // An unknown role is treated as the least privileged one.
  return { id, email, name, emailVerified, role: isUserRole(role) ? role : "student" };
}
