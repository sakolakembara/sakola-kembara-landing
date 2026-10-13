// Redirect rules, ported from the root next.config.ts (`redirects()`) plus two
// rules added by SAKEM-075 and the five auth pages that moved into the portal
// (SAKEM-083). One table, four consumers:
//
//   - astro.config.mjs → an integration writes it to dist/client/_redirects
//     (toUnderscoreRedirects below). The Workers assets layer answers those
//     rules BEFORE the Worker runs: no Worker invocation, no CPU, not counted
//     against the 100k requests/day of the Free plan.
//   - src/middleware.ts → matchRedirect() answers the same rules when a
//     request does reach the Worker (astro dev, or if _redirects is ever
//     missing), so behaviour is identical in every environment.
//   - tests/redirects.test.ts → asserts every WordPress sourceUrl in
//     lib/blog-posts.json maps to /blog/<slug> with the intended status.
//   - scripts/e2e.mjs → fires the same rules at a running Worker.
//
// Why not Astro's own `redirects` option: with params ([slug], [...path]) the
// adapter's _redirects generator (@astrojs/underscore-redirects 1.0.3) writes
// `/cerita/:slug /cerita/:slug.html 301` and drops the destination and status.
//
// Plain .mjs (not .ts) so astro.config.mjs can import it without a loader.
// Pattern syntax is Astro's: [slug] is one segment, [...path] is the rest.

/** Legacy WordPress category permalinks (/cerita/<slug>/ and the /cerita/ archive). */
export const WP_BLOG_CATEGORIES = [
  'cerita',
  'education',
  'news',
  'tips',
  'testimonials',
  'career',
  'kiat-kiat',
];

/** Next `permanent: true` answers 308, so the same status is used here. */
const PERMANENT = 308;
/** For rules that may change later: browsers do not cache a 307 forever. */
const TEMPORARY = 307;

const to = (destination, status = PERMANENT) => ({ status, destination });

/** @type {Record<string, { status: 301 | 302 | 303 | 307 | 308; destination: string }>} */
export const REDIRECTS = {
  // Legacy category-prefixed post permalinks → unified /blog/<slug>.
  ...Object.fromEntries(
    WP_BLOG_CATEGORIES.map((cat) => [`/${cat}/[slug]`, to('/blog/[slug]')]),
  ),
  // Legacy category archive pages → /blog index.
  ...Object.fromEntries(WP_BLOG_CATEGORIES.map((cat) => [`/${cat}`, to('/blog')])),

  // Old CTA destinations still linked from external sites, QR codes and bios.
  '/daftar': to('/gabung-siswa'),
  '/apply': to('/gabung-siswa'),
  // Registration form moved under /portal (auth-gated there).
  '/gabung-siswa/form': to('/portal/daftar'),
  // The legacy auth pages moved into the student portal (M4, SAKEM-083: a Worker of its own on the route <apex>/portal/*).
  // Static rules, so the assets layer answers them without a Worker request. An old emailed link or bookmark ends up on
  // the portal's page of the same name; a token in its query is a legacy one, which the portal refuses with its own
  // "tautan tidak valid" page, and a legacy `from=/portal/status` is understood by the portal's sign-in (it accepts the
  // path with or without its /portal prefix).
  '/login': to('/portal/login'),
  '/register': to('/portal/register'),
  '/forgot-password': to('/portal/forgot-password'),
  '/reset-password': to('/portal/reset-password'),
  '/verify-email': to('/portal/verify-email'),
  // "About" page rename: the public team page took over.
  '/tentang-kami': to('/tim'),
  '/about': to('/tim'),
  // Internal rename.
  '/impact-reports': to('/laporan'),
  '/impact-reports/[...path]': to('/laporan'),
  // WordPress paginated archives (/blog/page/3/) → /blog?page=3.
  '/blog/page/[page]': to('/blog?page=[page]'),
  // Common WordPress entry points that should not 404 at cutover.
  '/feed': to('/blog'),
  '/feed/[...path]': to('/blog'),
  '/index.php': to('/'),

  // Added by SAKEM-075 (not in next.config.ts):
  // Image URLs from the WordPress media library (SAKEM-060). The migrated
  // files live under /blog/images/<yyyy>/<mm>/ with the same relative path.
  '/wp-content/uploads/[...path]': to('/blog/images/[...path]'),
  // There is no /program index; send it to the first stage. Temporary on
  // purpose: an overview page may replace it.
  '/program': to('/program/prapembinaan', TEMPORARY),
};

/** Pattern with [slug] / [...path] -> { regex, keys }. A trailing slash on the request is tolerated. */
export function compilePattern(pattern) {
  const keys = [];
  const source = pattern
    .split('/')
    .map((segment) => {
      const spread = segment.match(/^\[\.\.\.(\w+)\]$/);
      if (spread) {
        keys.push(spread[1]);
        return '(.+?)';
      }
      const one = segment.match(/^\[(\w+)\]$/);
      if (one) {
        keys.push(one[1]);
        return '([^/]+)';
      }
      return segment.replace(/[.*+?^${}()|\\]/g, '\\$&');
    })
    .join('/');
  return { regex: new RegExp(`^${source}/?$`), keys };
}

const compiled = Object.entries(REDIRECTS).map(([pattern, rule]) => ({
  pattern,
  rule,
  ...compilePattern(pattern),
}));

/**
 * First matching rule for a request path, or null. The incoming query string
 * is carried over, like _redirects does, unless the destination already has
 * its own query: then the incoming one is dropped (so /blog/page/2?utm=x goes
 * to /blog?page=2). Next would merge the two; a tracking parameter on an old
 * WordPress pagination URL is not worth a second code path.
 *
 * @param {string} pathname  e.g. "/cerita/some-slug/"
 * @param {string} [search]  e.g. "?utm_source=x" (or "")
 * @returns {{ status: number, location: string } | null}
 */
export function matchRedirect(pathname, search = '') {
  for (const { rule, regex, keys } of compiled) {
    const m = pathname.match(regex);
    if (!m) continue;
    let location = rule.destination;
    keys.forEach((key, i) => {
      location = location.replace(new RegExp(`\\[(?:\\.\\.\\.)?${key}\\]`), m[i + 1]);
    });
    if (search && search !== '?' && !location.includes('?')) location += search;
    return { status: rule.status, location };
  }
  return null;
}

/**
 * The table as a Cloudflare `_redirects` file. Placeholders (:slug) match one
 * segment, a splat (*) the rest, and the query string is forwarded. Each rule
 * is written twice, with and without a trailing slash, because the WordPress
 * URLs end in "/".
 */
export function toUnderscoreRedirects(table = REDIRECTS) {
  const isDynamic = (pattern) => pattern.includes('[');
  // Static rules first: Cloudflare evaluates them before placeholder/splat
  // rules anyway, and wrangler warns when the file is ordered otherwise.
  const entries = Object.entries(table).sort(([a], [b]) => Number(isDynamic(a)) - Number(isDynamic(b)));
  const lines = [];
  for (const [pattern, { status, destination }] of entries) {
    const source = pattern.replace(/\[\.\.\.(\w+)\]/g, '*').replace(/\[(\w+)\]/g, ':$1');
    const target = destination.replace(/\[\.\.\.(\w+)\]/g, ':splat').replace(/\[(\w+)\]/g, ':$1');
    const splat = source.endsWith('*');
    lines.push(`${source}  ${target}  ${status}`);
    if (!splat) lines.push(`${source}/  ${target}  ${status}`);
  }
  return `${lines.join('\n')}\n`;
}
