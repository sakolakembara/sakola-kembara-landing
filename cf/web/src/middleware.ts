import { env } from 'cloudflare:workers';
import { defineMiddleware } from 'astro:middleware';
import { matchRedirect } from '../redirects.config.mjs';
import { canonicalPath } from '~/lib/canonical-path';
import { isLegacyPath } from '~/lib/legacy-paths';
import { forwardToLegacy } from '~/lib/legacy-proxy';
import { withSecurityHeaders } from '~/lib/security-headers';

const redirect = (status: number, location: string) =>
  withSecurityHeaders(new Response(null, { status, headers: { location } }));

/**
 * Runs for every request that reaches the Worker. Prerendered pages and static
 * files are answered by the assets layer first and never get here.
 *
 *  1. Redirect table (redirects.config.mjs). In production the assets layer
 *     answers these from dist/client/_redirects before the Worker runs; this
 *     branch covers `astro dev` and keeps behaviour identical everywhere.
 *  2. Legacy paths (src/lib/legacy-paths.ts): forwarded untouched to the old
 *     Next app (see src/lib/legacy-proxy.ts). Nothing is rendered here, and
 *     the legacy app keeps deciding about its own trailing slashes.
 *  3. One URL per page: trailing slash and `.html` are folded with a 308, like
 *     the Next app does.
 *  4. Everything else is Astro's, with the security headers Caddy used to add.
 */
export const onRequest = defineMiddleware(async (context, next) => {
  // The build renders prerendered pages through this middleware too, asking for
  // URLs like /blog/<slug>.html. None of the runtime rules below apply to that.
  if (context.isPrerendered) return next();

  const { pathname, search } = context.url;

  const hit = matchRedirect(pathname, search);
  if (hit) return redirect(hit.status, hit.location);

  if (isLegacyPath(pathname)) {
    return forwardToLegacy(context.request, env.LEGACY_ORIGIN_URL);
  }

  const canonical = canonicalPath(pathname);
  if (canonical) return redirect(308, `${canonical}${search}`);

  return withSecurityHeaders(await next());
});
