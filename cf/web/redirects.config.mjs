// Redirect rules, ported from the root next.config.ts (`redirects()`) plus two
// rules added by SAKEM-075, the five auth pages that moved into the portal
// (SAKEM-083, taken out again for Phase A of the cutover by SAKEM-103) and the
// WordPress pages and archives found by the SEO parity run (SAKEM-090). One table,
// four consumers:
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

import { assetUrl } from './assets.config.mjs';

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

  // Old CTA addresses still linked from external sites, QR codes and bios: `/daftar` and `/apply` are NOT here. They are admin
  // shortlinks (D1, a 307 to wherever the admin points them, src/pages/[...path].astro). `/daftar` is the registration form (SAKEM-103), so
  // a new cohort changes the shortlink's target in the admin and nothing is deployed. `/apply` used to be a 308 to /gabung-siswa; it is
  // free since SAKEM-107 so that an admin can make a custom link of it, and until one exists it is the site's own 404.
  // The registration form of the abandoned portal address goes where every "Daftar Sekarang" goes: the shortlink.
  '/gabung-siswa/form': to('/daftar'),
  // `/login`, `/register`, `/forgot-password`, `/reset-password` and `/verify-email` are NOT here any more (SAKEM-103, Phase A of
  // the cutover: the student portal is not live yet). They used to be 308s into /portal/<name> (SAKEM-083). `/login` is WordPress's
  // now (src/lib/legacy-paths.ts forwards it), and the other four are the site's own 404, like on the live site. Phase B brings the
  // 308s back (docs/cloudflare/web-skeleton.md, "The student portal switch").
  // "About" page rename: the public team page took over.
  '/tentang-kami': to('/tim'),
  '/about': to('/tim'),
  // Internal rename, and then SAKEM-105: the reports are a section of /donasi, so the old page (`/laporan`) and the
  // older `/impact-reports` go straight to that section, one hop each. The fragment is part of the destination: the
  // assets layer accepts it in `_redirects` and puts the query before it (checked locally by scripts/e2e.mjs; on a
  // real zone by the runbook's T-37).
  '/impact-reports': to('/donasi#laporan'),
  '/impact-reports/[...path]': to('/donasi#laporan'),
  '/laporan': to('/donasi#laporan'),
  // WordPress paginated archives (/blog/page/3/) → /blog?page=3.
  '/blog/page/[page]': to('/blog?page=[page]'),
  // Common WordPress entry points that should not 404 at cutover.
  '/feed': to('/blog'),
  '/feed/[...path]': to('/blog'),
  '/index.php': to('/'),

  // Added by SAKEM-075 (not in next.config.ts):
  // Image URLs from the WordPress media library (SAKEM-060): the migrated files live under /blog/images/<yyyy>/<mm>/ with the
  // same relative path. Since SAKEM-103 there is no splat rule for /wp-content/uploads/*: WordPress stays behind the same
  // hostname (Phase A) and answers every upload this site did not mirror, so only the files that exist under /blog/images
  // are redirected, one rule each, written at build time (mirroredUploadRules, toUnderscoreRedirects).
  // There is no /program index; send it to the first stage. Temporary on
  // purpose: an overview page may replace it.
  '/program': to('/program/prapembinaan', TEMPORARY),

  // Added by SAKEM-090, from the SEO parity run against the live WordPress site (2026-10-13, docs/cloudflare/seo-audit.md):
  // every URL the live sitemap lists that the new site has no page for. Permanent, one hop, destinations approved by Dzul.
  // The pages are Elementor templates and WordPress defaults (the live titles are "Home", "What We Do", "Donate",
  // "Sample Page"...), so each goes to the page of the new site that does the same job. Plain `to()` rules, written twice
  // (with and without the trailing slash WordPress used) by toUnderscoreRedirects().
  '/home': to('/'),
  '/sample-page': to('/'),
  // /tentang-kami is itself a rule of this table (to /tim, above), so pointing at it would be a two-hop chain: these go to
  // the page it ends on. (The approved wording says "/tentang-kami"; the page the visitor reaches is the same.)
  '/who-we-are': to('/tim'),
  '/our-partners': to('/tim'),
  '/contact-us': to('/kontak'),
  '/donate': to('/donasi'),
  '/donation-confirmation': to('/donasi'),
  '/donation-confirmation-2': to('/donasi'),
  '/donation-failed': to('/donasi'),
  '/donation-failed-2': to('/donasi'),
  '/donor-dashboard': to('/donasi'),
  '/donor-dashboard-2': to('/donasi'),
  '/work-with-us': to('/gabung-siswa'),
  // The 7 category archives and 77 tag archives of the live sitemap, and anything below them (/category/news/feed/,
  // /tag/x/page/2/): the blog index is the only listing the new site has. A splat, so a tag added later is covered too.
  '/category/[...path]': to('/blog'),
  '/tag/[...path]': to('/blog'),
  // The one slug that articles still link to and that is not an article: the founder story was published as
  // "...-rommy-mendirikan-sakola-kembara-untuk-pendidikan-inklusif" and later renamed; WordPress redirected the old
  // address, and 8 article bodies (content/blog) still carry the old link. Listed by the SEO audit's broken-link check.
  '/blog/perjalanan-seorang-founder-rommy-mendirikan-sakola-kembara-untuk-pendidikan-inklusif': to('/blog/perjalanan-seorang-founder'),
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
 * WordPress pagination URL is not worth a second code path. A destination may
 * end in a fragment (`/donasi#laporan`, SAKEM-105): the carried query is put
 * before it, which is also where the assets layer puts it.
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
    if (search && search !== '?' && !location.includes('?')) {
      // The query goes BEFORE a fragment (`/donasi?utm=x#laporan`): after it, it would be part of the fragment and lost.
      const fragment = location.indexOf('#');
      location = fragment < 0 ? location + search : `${location.slice(0, fragment)}${search}${location.slice(fragment)}`;
    }
    return { status: rule.status, location };
  }
  return null;
}

/**
 * The table as a Cloudflare `_redirects` file. Placeholders (:slug) match one
 * segment, a splat (*) the rest, and the query string is forwarded. Each rule
 * is written twice, with and without a trailing slash, because the WordPress
 * URLs end in "/".
 *
 * @param {typeof REDIRECTS} [table]
 * @param {{ slashFolds?: string[], uploadMirrors?: { from: string, to: string }[] }} [options]  slashFolds: paths of
 *   prerendered pages (see slashFoldPaths), each also written as `<path>/  <path>  308`, before every other rule;
 *   uploadMirrors: one rule per WordPress upload this build ships (see mirroredUploadRules), written with the static rules
 */
export function toUnderscoreRedirects(table = REDIRECTS, { slashFolds = [], uploadMirrors = [] } = {}) {
  const isDynamic = (pattern) => pattern.includes('[');
  // Static rules first: Cloudflare evaluates them before placeholder/splat
  // rules anyway, and wrangler warns when the file is ordered otherwise.
  const entries = Object.entries(table).sort(([a], [b]) => Number(isDynamic(a)) - Number(isDynamic(b)));
  const staticEntries = entries.filter(([pattern]) => !isDynamic(pattern));
  const dynamicEntries = entries.filter(([pattern]) => isDynamic(pattern));
  const lines = [];
  const emit = ([pattern, { status, destination }]) => {
    const source = pattern.replace(/\[\.\.\.(\w+)\]/g, '*').replace(/\[(\w+)\]/g, ':$1');
    const target = destination.replace(/\[\.\.\.(\w+)\]/g, ':splat').replace(/\[(\w+)\]/g, ':$1');
    const splat = source.endsWith('*');
    lines.push(`${source}  ${target}  ${status}`);
    if (!splat) lines.push(`${source}/  ${target}  ${status}`);
  };
  // The trailing-slash twin of every prerendered page, folded with a 308 (see slashFoldPaths): static rules, so they come first.
  for (const path of slashFolds) lines.push(`${path}/  ${path}  ${PERMANENT}`);
  staticEntries.forEach(emit);
  // The WordPress uploads this site mirrors are static rules too (no placeholder): after the table's static rules, before its dynamic ones.
  for (const { from, to: target } of uploadMirrors) lines.push(`${from}  ${target}  ${PERMANENT}`);
  dynamicEntries.forEach(emit);
  return `${lines.join('\n')}\n`;
}

/**
 * The WordPress upload addresses of the images this build ships under `blog/images/` (the migrated media library: the
 * path below `/blog/images/` is the path below `/wp-content/uploads/`), each as a one-hop redirect to its copy. Used
 * with `toUnderscoreRedirects(..., { uploadMirrors })`.
 *
 * Why a rule per file and not the splat `/wp-content/uploads/*` it replaced (SAKEM-103, Phase A of the cutover):
 * WordPress stays behind the same hostname, and `/wp-content/*` is forwarded to it (src/lib/legacy-paths.ts), so an upload
 * this site did NOT copy must reach WordPress and be answered there, instead of being sent to a /blog/images address that
 * is a 404. A file this site did copy keeps its permanent redirect to the static copy, answered by the assets layer: no
 * Worker request for the most requested images.
 *
 * A file name with an `@` (five migrated photos) gets the `%40` form as its target (`assetUrl`), so it is one hop and
 * not the 308 plus the assets layer's own 307 it used to take.
 *
 * @param {string[]} files  paths relative to the client folder, with forward slashes (every file and folder, as readdir lists them)
 * @returns {{ from: string, to: string }[]} sorted by address, so the file is the same on every build
 */
export function mirroredUploadRules(files) {
  const PREFIX = 'blog/images/';
  return files
    .filter((file) => file.startsWith(PREFIX) && /[^/]\.[A-Za-z0-9]+$/.test(file.slice(PREFIX.length)))
    .map((file) => ({ from: `/wp-content/uploads/${file.slice(PREFIX.length)}`, to: assetUrl(`/${file}`) }))
    .sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0));
}

/**
 * The paths of the pages the build prerenders (`dist/client/<name>.html`, served at `/<name>` by the assets layer), from the
 * list of the .html files of the client folder: ["donasi.html", "program/pembinaan.html", "index.html", "404.html"] gives
 * ["/donasi", "/program/pembinaan"]. The home page has no twin, and a 404.html is not a page.
 *
 * Why: a request for `/donasi/` is answered by the assets layer's own `html_handling` redirect, a **307** (temporary) that
 * cannot be configured to a 308, and WordPress addresses end in a slash, so those are the likely incoming spellings.
 * `slashFolds` of toUnderscoreRedirects writes `/donasi/  /donasi  308` for each, so the permanent redirect is the one that
 * answers (whether the `_redirects` rule wins over the layer's own redirect is settled by the e2e locally and, on a real
 * zone, by the runbook's T-19).
 *
 * @param {string[]} htmlFiles  paths relative to the client folder, with forward slashes
 */
export function slashFoldPaths(htmlFiles) {
  return htmlFiles
    .filter((file) => file.endsWith('.html') && file !== 'index.html' && file !== '404.html' && !file.endsWith('/index.html'))
    .map((file) => `/${file.slice(0, -'.html'.length)}`)
    .sort();
}
