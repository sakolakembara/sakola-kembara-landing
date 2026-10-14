import { env } from 'cloudflare:workers';
import { defineMiddleware } from 'astro:middleware';
import { matchRedirect } from '../redirects.config.mjs';
import { adminRedirectTarget } from '~/lib/admin-redirect';
import { canonicalPath } from '~/lib/canonical-path';
import { isAdminPath, isApiPath, isLegacyPath } from '~/lib/legacy-paths';
import { forwardToLegacy } from '~/lib/legacy-proxy';
import { cachedForSeconds, pageCache, pageCacheKey, pageCacheSeconds, responseFromEntry } from '~/lib/page-cache';
import { withSecurityHeaders } from '~/lib/security-headers';

const redirect = (status: number, location: string) =>
  withSecurityHeaders(new Response(null, { status, headers: { location } }));

/**
 * There is no API on the apex: the student API is /portal/api/* (its own Worker), the admin's is on the admin host.
 * A JSON 404 here is cheaper than the site's 404 page (no render) and cannot be mistaken for a shortlink.
 */
const apiNotFound = () =>
  withSecurityHeaders(
    new Response(JSON.stringify({ error: 'not_found' }), {
      status: 404,
      headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
    }),
  );

/**
 * Runs for every request that reaches the Worker. Prerendered pages and static
 * files are answered by the assets layer first and never get here.
 *
 *  1. Redirect table (redirects.config.mjs). In production the assets layer
 *     answers these from dist/client/_redirects before the Worker runs; this
 *     branch covers `astro dev` and keeps behaviour identical everywhere.
 *  2. The signed-in and auth surface moved out with M4 (SAKEM-083, PORTAL_OWNED_PATHS in
 *     src/lib/legacy-paths.ts): `/admin` and below is a 308 to the admin host (ADMIN_URL,
 *     src/lib/admin-redirect.ts), `/api` and below is a JSON 404. The old auth pages are static
 *     redirects of the table above, and /portal is another Worker's.
 *  3. Legacy paths (src/lib/legacy-paths.ts): the static files and uploads the old Next app still
 *     serves, forwarded untouched (see src/lib/legacy-proxy.ts). Nothing is rendered here, and
 *     the legacy app keeps deciding about its own trailing slashes.
 *  4. One URL per page: trailing slash and `.html` are folded with a 308, like
 *     the Next app does.
 *  5. Everything else is Astro's, with the security headers Caddy used to add. When `PAGE_CACHE_SECONDS` is set, a page
 *     that depends only on the API's data may be answered from a copy kept in this isolate for that many seconds
 *     (src/lib/page-cache.ts; off by default).
 */
export const onRequest = defineMiddleware(async (context, next) => {
  // The build renders prerendered pages through this middleware too, asking for
  // URLs like /blog/<slug>.html. None of the runtime rules below apply to that.
  if (context.isPrerendered) return next();

  const { pathname, search } = context.url;

  const hit = matchRedirect(pathname, search);
  if (hit) return redirect(hit.status, hit.location);

  if (isAdminPath(pathname)) {
    const target = adminRedirectTarget(env.ADMIN_URL, pathname, search);
    if (target) return redirect(308, target);
    // No admin host configured: the old dashboard is gone, so the path is the site's 404 (the catch-all below).
  } else if (isApiPath(pathname)) {
    return apiNotFound();
  }

  if (isLegacyPath(pathname)) {
    return forwardToLegacy(context.request, env.LEGACY_ORIGIN_URL);
  }

  const canonical = canonicalPath(pathname);
  if (canonical) return redirect(308, `${canonical}${search}`);

  const cacheSeconds = context.request.method === 'GET' ? pageCacheSeconds(env.PAGE_CACHE_SECONDS) : 0;
  const cacheKey = cacheSeconds > 0 ? pageCacheKey(context.url) : null;
  if (cacheKey) {
    const copy = pageCache.get(cacheKey);
    if (copy) return responseFromEntry(copy);
  }

  const response = withSecurityHeaders(await next());
  if (!cacheKey) return response;

  // A render that may be copied is copied after the answer has gone (the body is read from a clone), and says so.
  const keptFor = cachedForSeconds(response, cacheSeconds);
  if (keptFor > 0) {
    response.headers.set('x-page-cache', 'miss');
    const copy = response.clone();
    context.locals.cfContext.waitUntil(
      copy
        .arrayBuffer()
        .then((body) => pageCache.set(cacheKey, { status: copy.status, headers: [...copy.headers], body }, keptFor))
        .catch(() => undefined),
    );
  }
  return response;
});
