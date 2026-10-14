import { Hono, type Context } from "hono";
import type { Bindings } from "../../env";
import { CACHE_NONE } from "../../public/cache";
import { publicQueries } from "../../public/prepared";
import { recordClick } from "../../public/shortlink";
import { isSafeTarget, isShortlinkSlug } from "../../shortlinks/rules";

// GET /api/public/shortlinks/{slug}: where a shortlink goes, for the site's Worker (cf/web), which turns the
// answer into a 307. Mounted on the INTERNAL app only (src/api/public/index.ts), so like every read of the
// public API it is served through the `PublicApi` service binding and not to the internet: a request from the
// internet gets the Worker's ordinary 404 and never reaches D1.
//
// It is the one read with a side effect, on purpose. Resolving a slug and counting the visit happen in ONE call,
// so a redirect costs one subrequest. The count is written AFTER the answer is decided, through `waitUntil`:
// the redirect never waits for the write and never fails because of it (a write that fails is one fixed line in
// the log). Dzul's decision, 2026-10-12: every click is counted, without a limit (docs/cloudflare/admin-konten.md
// has the arithmetic and the risk he accepted).
//
// The answer is never cached by anyone (`no-store`): a cache in front would swallow clicks, and a link that was
// repointed or switched off must work that way at the very next visit.

type ReadEnv = { Bindings: Bindings };

function notFound(c: Context<ReadEnv>) {
  return c.json({ error: "not_found" }, 404, { "Cache-Control": CACHE_NONE });
}

function waitUntilOf(c: Context<ReadEnv>): (promise: Promise<unknown>) => void {
  try {
    const ctx = c.executionCtx;
    return (promise) => ctx.waitUntil(promise);
  } catch {
    // No execution context (a plain call in a unit test): let it run and ignore its result.
    return (promise) => void promise.catch(() => undefined);
  }
}

export const publicShortlinkRoutes = new Hono<ReadEnv>();

publicShortlinkRoutes.get("/shortlinks/:slug", async (c) => {
  const slug = c.req.param("slug");
  // Most 404 traffic of a site is noise (bots, typos, a path that was never a slug): anything that cannot be a slug
  // is answered without touching D1.
  if (!isShortlinkSlug(slug)) return notFound(c);

  const [row] = await publicQueries(c.env.DB).shortlink.all({ slug });
  // Unknown and inactive are the same answer. A target the admin could not have stored is not followed either.
  if (!row || !isSafeTarget(row.targetUrl)) return notFound(c);

  // The answer is decided. Counting comes after it and can fail without anyone noticing but the log.
  waitUntilOf(c)(
    recordClick(c.env.DB, row.id).catch(() => {
      // Fixed text: no id, no slug, no error message.
      console.error("[shortlinks] could not count a click");
    }),
  );
  return c.json({ shortlink: { targetUrl: row.targetUrl } }, 200, { "Cache-Control": CACHE_NONE });
});
