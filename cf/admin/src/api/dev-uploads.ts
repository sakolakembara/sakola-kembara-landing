import type { Context } from "hono";
import type { AppEnv } from "../context";
import { KEY_PATTERN } from "../uploads/key";

/**
 * GET /uploads/<key>, LOCAL DEVELOPMENT ONLY: serves an object from the local
 * R2 emulation so the admin SPA and `cf/web` can show uploaded files without a
 * public domain (set UPLOADS_BASE_URL=http://localhost:8787 in cf/web's
 * .dev.vars, and the Vite dev server proxies /uploads here).
 *
 * In production visitors never come here: files are served by R2 from its own
 * public domain, so a Worker is not run per download and nothing needs a
 * deploy. This route therefore answers 404 unless ENVIRONMENT is exactly
 * "development" (the same switch as GET /api/dev/mailbox), and it only ever
 * looks up a key of the exact shape src/uploads/key.ts produces, so it cannot
 * be made to read any other object.
 */
export async function serveDevUpload(c: Context<AppEnv>): Promise<Response> {
  if (c.env.ENVIRONMENT !== "development") return c.json({ error: "not_found" }, 404);
  const key = c.req.path.slice(1);
  if (!KEY_PATTERN.test(key)) return c.json({ error: "not_found" }, 404);
  const object = await c.env.UPLOADS.get(key);
  if (!object) return c.json({ error: "not_found" }, 404);

  const headers = new Headers();
  object.writeHttpMetadata(headers); // Content-Type and the immutable Cache-Control stored at upload
  headers.set("etag", object.httpEtag);
  // The type was found in the bytes at upload; a browser must not second-guess it.
  headers.set("x-content-type-options", "nosniff");
  return new Response(object.body, { headers });
}
