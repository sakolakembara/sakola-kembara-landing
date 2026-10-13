// The one place that says which paths the Astro Worker does NOT answer with a
// page of its own. Everything here is matched on a path-segment boundary:
// "/portal" matches "/portal" and "/portal/status", never "/portal-x".
//
// Three lists, because they age differently:
//
//   LEGACY_PATHS        forwarded to the legacy Next app (the "old origin"):
//                       static files and uploads the legacy app still serves
//                       until the cutover (M5).
//   NOT_YET_PORTED      public pages that still render on Next. Delete an entry
//                       in the same PR that adds its Astro page.
//   PORTAL_OWNED_PATHS  the signed-in and auth surface, which moved with M4 (SAKEM-083):
//                       the student portal is a Worker of its own on the route
//                       `<apex>/portal/*`, the old auth pages redirect into it, the old
//                       admin paths redirect to the admin host, and there is no /api on
//                       the apex any more. Nothing here is forwarded; these names stay
//                       RESERVED (no shortlink may take them) and are never looked up as one.
//
// Paths no list names are the Worker's own (the ported pages, /sitemap.xml,
// /robots.txt, the 404). One more case lives in src/pages/[...path].astro: an
// unknown single-segment path may be an admin-managed shortlink, which the API
// Worker resolves (src/lib/shortlink.ts); the legacy app no longer does.

export interface LegacyPath {
  /** Path prefix, no trailing slash. */
  path: string;
  /** Why the Worker must not answer this with a page of its own. */
  why: string;
}

export const LEGACY_PATHS: readonly LegacyPath[] = [
  // Static files the legacy pages need from the same host. (The auth pages, /portal, /admin and /api are not here any more:
  // PORTAL_OWNED_PATHS below.)
  {
    path: '/_next',
    why: 'Next build output: JS/CSS chunks, hashed media, and the /_next/image optimizer every legacy page hydrates with.',
  },
  {
    path: '/blog/images',
    why: 'Migrated and dashboard-uploaded blog images (not in this Worker: 69 MB of originals, uploads land on the VPS volume).',
  },
  {
    path: '/images',
    why: 'Legacy site photos and uploads such as /images/team/*. Files the Worker also ships (see sync-assets.mjs) are served by the assets layer first.',
  },
  { path: '/files', why: 'PDFs linked from program pages (pitch deck, sample curriculum).' },
  { path: '/reports', why: 'Impact-report PDFs uploaded from /admin/reports.' },
  { path: '/resources', why: 'Documents uploaded from /admin/resources.' },
];

/**
 * The signed-in and auth surface since M4 (docs/cloudflare/portal-architecture.md#66-what-happens-to-the-pass-through-of-cfweb).
 * The Worker answers none of these with a page and forwards none of them:
 *
 *   /portal ...             another Worker (`sakem-portal`) on the route `<apex>/portal/*`: in production this Worker never
 *                           sees the request; locally (astro dev, the e2e stack) it is the site's 404.
 *   /login, /register, /forgot-password, /reset-password, /verify-email
 *                           static 308 redirects to the same name under /portal (redirects.config.mjs, answered by the
 *                           assets layer).
 *   /admin ...              a 308 to the admin host, from the public variable ADMIN_URL (src/lib/admin-redirect.ts).
 *   /api ...                a JSON 404: the apex has no API. The student API is /portal/api/*, the admin's is on the admin host.
 *
 * Reserved slugs: tests/shortlink-reserved.test.ts derives the reserved names from this list.
 */
export const PORTAL_OWNED_PATHS: readonly LegacyPath[] = [
  { path: '/portal', why: 'The student portal: a Worker of its own on the route <apex>/portal/*, never this one in production.' },
  { path: '/login', why: 'Redirected (308) to /portal/login by redirects.config.mjs.' },
  { path: '/register', why: 'Redirected (308) to /portal/register by redirects.config.mjs.' },
  { path: '/forgot-password', why: 'Redirected (308) to /portal/forgot-password by redirects.config.mjs.' },
  { path: '/reset-password', why: 'Redirected (308) to /portal/reset-password by redirects.config.mjs.' },
  { path: '/verify-email', why: 'Redirected (308) to /portal/verify-email by redirects.config.mjs.' },
  { path: '/admin', why: 'Redirected (308) to the admin host (ADMIN_URL) by the middleware, src/lib/admin-redirect.ts.' },
  { path: '/api', why: 'No API on the apex: answered with a JSON 404. The student API is /portal/api/*, the admin API is on the admin host.' },
];

// Empty: /laporan, /gabung-siswa* and /kontak are ported. The list stays (the matcher and the tests use it)
// for the next public page that is ever added to the legacy app before the Worker has it.
export const NOT_YET_PORTED: readonly LegacyPath[] = [];

const matches = (pathname: string, prefix: string) =>
  pathname === prefix || pathname.startsWith(`${prefix}/`);

export type LegacyKind = 'legacy' | 'not-yet-ported';

/** Which legacy list (if any) claims this pathname. */
export function legacyKind(pathname: string): LegacyKind | null {
  if (LEGACY_PATHS.some((p) => matches(pathname, p.path))) return 'legacy';
  if (NOT_YET_PORTED.some((p) => matches(pathname, p.path))) return 'not-yet-ported';
  return null;
}

export const isLegacyPath = (pathname: string): boolean => legacyKind(pathname) !== null;

/** Whether the pathname is one of the portal-owned names above (the same segment-boundary rule). */
export const isPortalOwnedPath = (pathname: string): boolean => PORTAL_OWNED_PATHS.some((p) => matches(pathname, p.path));

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
