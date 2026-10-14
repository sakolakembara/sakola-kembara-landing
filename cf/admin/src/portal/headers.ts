import type { MiddlewareHandler } from "hono";
import type { AppEnv } from "../context";

// The headers of every answer of the portal API (docs/cloudflare/portal-api.md, section 1; portal-architecture.md, 6.4):
// never cached (the answers depend on a session), never sniffed, no referrer. The outermost middleware of
// src/portal/worker.ts, so the refusals of the guards carry them too.
//
// A route that needs a different value sets it itself and is left alone: a file answer is `Cache-Control: private,
// no-store` (src/portal/files.ts), which this must not overwrite with a plain `no-store`.

export const API_HEADERS = {
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
} as const;

export const apiHeaders: MiddlewareHandler<AppEnv> = async (c, next) => {
  await next();
  for (const [name, value] of Object.entries(API_HEADERS)) if (!c.res.headers.has(name)) c.header(name, value);
};
