// The one place that says which paths the Astro Worker does NOT answer with a
// page of its own. Matched on a path-segment boundary, never loosely:
// "/wp-admin" matches "/wp-admin" and "/wp-admin/post.php", never "/wp-admin-x"
// (an entry marked `exact` matches only itself, with or without one trailing slash).
//
// Since SAKEM-103 (Phase A of the cutover: the PUBLIC site and the ADMIN move to
// sakolakembara.org first, the student portal follows later) the origin behind the
// Worker's route is the live WordPress site, not the legacy Next app, which was never
// released. Three lists, because they age differently:
//
//   LEGACY_PATHS        forwarded to the origin (WordPress): the paths that must keep
//                       reaching it while it stays behind the same hostname. Nothing
//                       the new site serves is ever on this list (the tests check it
//                       against every page, redirect and shortlink name).
//   NOT_YET_PORTED      public pages that still render on the origin. Empty: every
//                       public page is the Worker's. The list stays (the matcher and the
//                       tests use it) for a page that is ever added to the origin first.
//   PORTAL_OWNED_PATHS  the signed-in and auth surface that belongs to the student
//                       portal (M4, SAKEM-083), which is NOT live in Phase A. Nothing
//                       here is forwarded. In Phase A these names answer the site's own
//                       404 (docs/cloudflare/web-skeleton.md, "Phase A"), and they stay
//                       RESERVED (no shortlink may take them) and are never looked up as one.
//
// Paths no list names are the Worker's own (the ported pages, /sitemap.xml,
// /robots.txt, the 404). One more case lives in src/pages/[...path].astro: an
// unknown single-segment path may be an admin-managed shortlink, which the API
// Worker resolves (src/lib/shortlink.ts), `/daftar` (the registration form) among them.

export interface LegacyPath {
  /** Path, no trailing slash. */
  path: string;
  /** Why the Worker must not answer this with a page of its own. */
  why: string;
  /**
   * `prefix` (the default): the path and everything below it. `exact`: this path only, with or without one trailing
   * slash: a file (`/wp-login.php`), or a name whose sub-paths are not the origin's (`/login/anything`).
   */
  match?: 'prefix' | 'exact';
}

/**
 * WordPress's own paths, forwarded to the origin untouched (route mode: the Worker's route sits in front of the proxied
 * WordPress record, so `fetch(request)` to the same hostname reaches it, src/lib/legacy-proxy.ts). The live site was read
 * on 2026-10-15 (read-only GETs): `/login/` is a redirect to wp-login.php there.
 *
 * Every entry is a name WordPress owns and the new site has no page, redirect or shortlink for. Look-alikes are not
 * WordPress's: `/wp-adminx`, `/wp-content-x`, `/wp-login`, `/xmlrpc.phpx`, `/login/x`, `/Login` all stay the Worker's.
 */
export const LEGACY_PATHS: readonly LegacyPath[] = [
  { path: '/wp-admin', why: 'The WordPress dashboard (and /wp-admin/admin-ajax.php, which the public pages of the old theme and its plugins call).' },
  { path: '/wp-login.php', match: 'exact', why: 'The WordPress sign-in form, the only way into the dashboard of the site that stays behind this hostname.' },
  {
    path: '/wp-content',
    why: 'Themes, plugins and the media library. The uploads this site copied are redirected before the Worker runs (mirroredUploadRules in redirects.config.mjs); every other upload, and what other sites still hotlink, is WordPress\'s.',
  },
  { path: '/wp-includes', why: 'WordPress core scripts and styles that the pages of the old site, and any page that embeds them, still load.' },
  { path: '/wp-json', why: 'The WordPress REST API (the editors\' apps, the block editor, integrations that call it).' },
  { path: '/xmlrpc.php', match: 'exact', why: 'The WordPress XML-RPC endpoint (the mobile apps and pingbacks of the old site).' },
  { path: '/login', match: 'exact', why: 'The live site sends /login/ to wp-login.php, so staff and old bookmarks keep working. (It was a 308 into /portal/login before Phase A.)' },
];

/**
 * The signed-in and auth surface of the student portal (docs/cloudflare/portal-architecture.md#66-what-happens-to-the-pass-through-of-cfweb).
 * The Worker forwards none of these, and in Phase A (the portal is not live) it answers none of them with a page:
 *
 *   /portal ...             a Worker of its own (`sakem-portal`) on the route `<apex>/portal/*` once Phase B attaches it: then this
 *                           Worker never sees the request. Until then (and locally, in `astro dev` and the e2e stack) it is the
 *                           site's own 404 page, which says the page does not exist or has moved.
 *   /register, /forgot-password, /reset-password, /verify-email
 *                           the same: the site's own 404 in Phase A (they were static 308s into /portal in M4; Phase B brings those back).
 *   /admin ...              a 308 to the admin host, from the public variable ADMIN_URL (src/lib/admin-redirect.ts).
 *   /api ...                a JSON 404: the apex has no API. The student API is /portal/api/*, the admin's is on the admin host.
 *
 * `/login` is not here any more: the origin's list owns it (above).
 * Reserved slugs: tests/shortlink-reserved.test.ts derives the reserved names from this list.
 */
export const PORTAL_OWNED_PATHS: readonly LegacyPath[] = [
  { path: '/portal', why: 'The student portal: a Worker of its own on the route <apex>/portal/* once Phase B attaches it; the site\'s 404 until then.' },
  { path: '/register', why: 'A portal page (/portal/register): the site\'s 404 in Phase A, a 308 into the portal again in Phase B.' },
  { path: '/forgot-password', why: 'A portal page (/portal/forgot-password): the site\'s 404 in Phase A, a 308 into the portal again in Phase B.' },
  { path: '/reset-password', why: 'A portal page (/portal/reset-password): the site\'s 404 in Phase A, a 308 into the portal again in Phase B.' },
  { path: '/verify-email', why: 'A portal page (/portal/verify-email): the site\'s 404 in Phase A, a 308 into the portal again in Phase B.' },
  { path: '/admin', why: 'Redirected (308) to the admin host (ADMIN_URL) by the middleware, src/lib/admin-redirect.ts.' },
  { path: '/api', why: 'No API on the apex: answered with a JSON 404. The student API is /portal/api/*, the admin API is on the admin host.' },
];

// Empty: /donasi (with the reports), /gabung-siswa* and /kontak are ported. The list stays (the matcher and the tests use it)
// for the next public page that is ever added to the origin before the Worker has it.
export const NOT_YET_PORTED: readonly LegacyPath[] = [];

const matches = (pathname: string, prefix: string) =>
  pathname === prefix || pathname.startsWith(`${prefix}/`);

/** The entry's own rule: a prefix on a segment boundary, or the exact path (one trailing slash allowed). */
const entryMatches = (pathname: string, entry: LegacyPath) =>
  entry.match === 'exact' ? pathname === entry.path || pathname === `${entry.path}/` : matches(pathname, entry.path);

export type LegacyKind = 'legacy' | 'not-yet-ported';

/** Which origin list (if any) claims this pathname. */
export function legacyKind(pathname: string): LegacyKind | null {
  if (LEGACY_PATHS.some((p) => entryMatches(pathname, p))) return 'legacy';
  if (NOT_YET_PORTED.some((p) => entryMatches(pathname, p))) return 'not-yet-ported';
  return null;
}

export const isLegacyPath = (pathname: string): boolean => legacyKind(pathname) !== null;

/** Whether the pathname is one of the portal-owned names above (the same segment-boundary rule). */
export const isPortalOwnedPath = (pathname: string): boolean => PORTAL_OWNED_PATHS.some((p) => entryMatches(pathname, p));

/** `/api` and everything under it. */
export const isApiPath = (pathname: string): boolean => matches(pathname, '/api');

/** `/admin` and everything under it. */
export const isAdminPath = (pathname: string): boolean => matches(pathname, '/admin');

/**
 * Same grammar as validateSlug() in the root lib/shortlinks.ts and in the
 * admin Worker (cf/admin/src/shortlinks/rules.ts): lowercase letters, digits,
 * single inner hyphens, at most 64 characters. A single segment that fits is
 * looked up through the API (src/lib/shortlink.ts): a 307 to the target or the
 * site's 404; anything else is a 404 without a call.
 */
export const SHORTLINK_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const SHORTLINK_MAX_LENGTH = 64;

export function isShortlinkCandidate(slug: string): boolean {
  return slug.length <= SHORTLINK_MAX_LENGTH && SHORTLINK_SLUG.test(slug);
}
