// The one place that says which paths the Astro Worker does NOT own and
// forwards to the legacy Next app (the "old origin"). Everything here is
// matched on a path-segment boundary: "/portal" matches "/portal" and
// "/portal/status", never "/portal-x".
//
// Two lists, because they age differently:
//
//   LEGACY_PATHS   permanent for this phase: dynamic, auth-gated or
//                  user-uploaded things the legacy app keeps owning until the
//                  admin/portal rewrite (phase 3) replaces them.
//   NOT_YET_PORTED public pages that still render on Next. Delete an entry
//                  in the same PR that adds its Astro page.
//
// Paths no list names are the Worker's own (the ported pages, /sitemap.xml,
// /robots.txt, the 404). One more case lives in src/pages/[slug].astro: an
// unknown single-segment path may be an admin-managed shortlink, which only
// the legacy app (Postgres) can resolve.

export interface LegacyPath {
  /** Path prefix, no trailing slash. */
  path: string;
  /** Why the Worker must not answer this itself. */
  why: string;
}

export const LEGACY_PATHS: readonly LegacyPath[] = [
  // Auth pages (Auth.js on the legacy app; cookies are scoped to this host).
  { path: '/login', why: 'Sign-in page and form (server action).' },
  { path: '/register', why: 'Student sign-up page and form.' },
  { path: '/forgot-password', why: 'Password reset request.' },
  { path: '/reset-password', why: 'Password reset form (token in the query string).' },
  { path: '/verify-email', why: 'Email verification landing (token in the query string).' },
  // Signed-in areas.
  { path: '/portal', why: 'Student portal, auth-gated by the legacy proxy.ts.' },
  { path: '/admin', why: 'Admin dashboard, auth-gated by the legacy proxy.ts.' },
  // Everything dynamic the legacy pages call from the browser.
  {
    path: '/api',
    why: 'Auth.js (/api/auth/*), SSO to the LMS (/api/sso/*), account, announcements, admin and portal APIs. Also called by the new navbar script.',
  },
  // Static files the legacy pages need from the same host.
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

export const NOT_YET_PORTED: readonly LegacyPath[] = [
  { path: '/laporan', why: 'Impact reports (reads Postgres).' },
  { path: '/kontak', why: 'Contact page with the message form (server action + Postgres).' },
  { path: '/gabung-siswa', why: 'Student recruitment page and /gabung-siswa/docs (reads Postgres).' },
];

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

/**
 * Same grammar as validateSlug() in the root lib/shortlinks.ts: lowercase
 * letters, digits, single inner hyphens, at most 64 characters. A single
 * segment that fits is handed to the legacy app, which looks it up in
 * Postgres and redirects (307) or answers its own 404.
 */
export const SHORTLINK_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const SHORTLINK_MAX_LENGTH = 64;

export function isShortlinkCandidate(slug: string): boolean {
  return slug.length <= SHORTLINK_MAX_LENGTH && SHORTLINK_SLUG.test(slug);
}
