import { Hono } from "hono";
import type { Bindings } from "../../env";
import { CACHE_NONE } from "../../public/cache";
import type { ContactDeps } from "../../public/contact-deps";
import { resolveContactDeps } from "../../public/contact-deps";
import { createContactRoutes } from "./contact";
import { markServiceBindingCall } from "./internal";
import { publicReadRoutes } from "./read";
import { publicShortlinkRoutes } from "./shortlink";

export { publicReadRoutes } from "./read";
export { createContactRoutes } from "./contact";

export const PUBLIC_BASE_PATH = "/api/public";

/**
 * The public half, mounted by the default export (src/worker.ts), which is what
 * a route, workers.dev or a custom domain reaches: NOTHING under /api/public.
 * Neither the read endpoints nor the contact route are served to the internet.
 * The only consumer is the Astro Worker, which calls them through the service
 * binding (the `PublicApi` entrypoint, below), so there is nothing for anyone
 * else to reach: a URL under /api/public gets the Worker's ordinary JSON 404
 * before any database is touched, and a query string nobody uses (`?x=1`,
 * `?x=2`, ...) cannot make D1 read a single row, which is how the daily D1 read
 * budget (5 million rows) used to be spendable from the internet
 * (docs/cloudflare/public-api.md). It is kept as a function, empty on purpose,
 * so the invariant has one name: test/public-face.test.ts pins it and
 * scripts/negative-checks.mjs breaks it to prove the test notices.
 */
export function createPublicApp() {
  const app = new Hono<{ Bindings: Bindings }>();
  return app;
}

/**
 * The internal half, served by the `PublicApi` entrypoint to a caller that
 * holds the service binding: the read endpoints and the contact route, the
 * only place either exists. Every request is marked as a service binding call
 * before anything else, which is what lets the contact route trust
 * X-Sakem-Client-Ip.
 */
export function createInternalApp(deps: (env: Bindings) => ContactDeps = resolveContactDeps) {
  const app = new Hono<{ Bindings: Bindings }>();
  app.use("*", markServiceBindingCall);
  app.route(PUBLIC_BASE_PATH, publicReadRoutes);
  app.route(PUBLIC_BASE_PATH, publicShortlinkRoutes);
  app.route(PUBLIC_BASE_PATH, createContactRoutes(deps));
  // The same JSON 404 and 500 as the public Worker, never cacheable.
  app.notFound((c) => c.json({ error: "not_found" }, 404, { "Cache-Control": CACHE_NONE }));
  app.onError((error, c) => {
    console.error(`[public-api] unhandled error: ${error.name}`);
    return c.json({ error: "internal" }, 500, { "Cache-Control": CACHE_NONE });
  });
  return app;
}
