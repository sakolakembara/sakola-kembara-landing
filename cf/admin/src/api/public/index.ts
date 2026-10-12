import { Hono } from "hono";
import type { Bindings } from "../../env";
import { CACHE_NONE } from "../../public/cache";
import type { ContactDeps } from "../../public/contact-deps";
import { resolveContactDeps } from "../../public/contact-deps";
import { createContactRoutes } from "./contact";
import { markServiceBindingCall } from "./internal";
import { publicReadRoutes } from "./read";

export { publicReadRoutes } from "./read";
export { createContactRoutes } from "./contact";

export const PUBLIC_BASE_PATH = "/api/public";

/**
 * The public half: the read endpoints and nothing else. Mounted by the default
 * export (src/worker.ts), so it is what the internet can reach. The contact
 * route is deliberately not here (see ./internal.ts).
 */
export function createPublicApp() {
  const app = new Hono<{ Bindings: Bindings }>();
  app.route(PUBLIC_BASE_PATH, publicReadRoutes);
  return app;
}

/**
 * The internal half, served by the `PublicApi` entrypoint to a caller that
 * holds the service binding: the same read endpoints plus the contact route.
 * Every request is marked as a service binding call before anything else, which
 * is what lets the contact route trust X-Sakem-Client-Ip.
 */
export function createInternalApp(deps: (env: Bindings) => ContactDeps = resolveContactDeps) {
  const app = new Hono<{ Bindings: Bindings }>();
  app.use("*", markServiceBindingCall);
  app.route(PUBLIC_BASE_PATH, publicReadRoutes);
  app.route(PUBLIC_BASE_PATH, createContactRoutes(deps));
  // The same JSON 404 and 500 as the public Worker, never cacheable.
  app.notFound((c) => c.json({ error: "not_found" }, 404, { "Cache-Control": CACHE_NONE }));
  app.onError((error, c) => {
    console.error(`[public-api] unhandled error: ${error.name}`);
    return c.json({ error: "internal" }, 500, { "Cache-Control": CACHE_NONE });
  });
  return app;
}
