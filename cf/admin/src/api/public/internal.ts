import type { MiddlewareHandler } from "hono";
import type { Bindings } from "../../env";
import { CACHE_NONE } from "../../public/cache";

// How this Worker tells a call that came through the service binding from a
// request that came from the public internet.
//
// It does not tell them apart by looking at the request. Nothing in a request
// proves where it came from: a header such as X-Sakem-Client-Ip can be set by
// anyone, and a service binding adds no header of its own. The answer is the
// platform's own routing: the Worker's public face (routes, workers.dev, a
// custom domain) always runs the default export, while a named
// WorkerEntrypoint class can only be reached through a service binding that
// names it (`entrypoint` in the caller's wrangler.jsonc) or through
// `ctx.exports` inside this Worker. So:
//
//   - the default export (src/worker.ts) builds the public app: the read
//     endpoints and nothing else. The contact route does not exist there, so
//     `POST /api/public/contact` from the internet is the Worker's ordinary 404;
//   - the `PublicApi` entrypoint (./entrypoint.ts) builds the internal app: the
//     same read endpoints plus the contact route, and it marks every request
//     with `markServiceBindingCall`;
//   - the contact route itself refuses a request that carries no mark
//     (`requireServiceBinding`), so a future edit that mounts it on the public
//     app by mistake still answers 404 instead of trusting a forged header.
//
// Only the internal app ever reads X-Sakem-Client-Ip, and only because a
// caller that can reach that entrypoint has been given the binding.

export type InternalEnv = {
  Bindings: Bindings;
  Variables: {
    /** True only for a request dispatched by the PublicApi entrypoint, i.e. through a service binding. */
    viaBinding?: boolean;
  };
};

export const markServiceBindingCall: MiddlewareHandler<InternalEnv> = async (c, next) => {
  c.set("viaBinding", true);
  await next();
};

export const requireServiceBinding: MiddlewareHandler<InternalEnv> = async (c, next) => {
  if (c.get("viaBinding") !== true) return c.json({ error: "not_found" }, 404, { "Cache-Control": CACHE_NONE });
  await next();
};
