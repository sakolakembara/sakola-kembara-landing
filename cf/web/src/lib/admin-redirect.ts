// `/admin` and everything under it used to be the legacy dashboard, forwarded to the old Next app. Since M4 (SAKEM-083)
// the admin lives on its own host (docs/cloudflare/portal-architecture.md#66-what-happens-to-the-pass-through-of-cfweb), and
// this Worker answers the old paths with a 308 to it, so a bookmark of `<apex>/admin/blog` still lands on the blog
// screen: the new admin's routes are the old ones without the `/admin` prefix (`/blog`, `/applications`, `/audit`...), so what
// comes after the prefix is kept, with the query.
//
//   /admin                 -> <ADMIN_URL>/
//   /admin/blog/new?x=1    -> <ADMIN_URL>/blog/new?x=1
//
// `ADMIN_URL` is a public Worker variable (the admin's origin, set per deploy, never in git). Unset, empty or anything that
// is not an http(s) origin: no redirect, and the path is the site's 404 (the old dashboard is gone, and guessing a host would
// send visitors somewhere nobody chose). Pure and injectable, tested in Node (tests/admin-redirect.test.ts).

/** The admin's origin from the variable: an http(s) origin without a path, or null. */
export function adminOrigin(value: string | undefined | null): string | null {
  if (typeof value !== 'string' || value.trim() === '') return null;
  try {
    const url = new URL(value.trim());
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.origin : null;
  } catch {
    return null;
  }
}

/** Where `/admin...` goes, or null when there is no admin host to send it to. `pathname` must be `/admin` or start with `/admin/`. */
export function adminRedirectTarget(adminUrl: string | undefined | null, pathname: string, search = ''): string | null {
  const origin = adminOrigin(adminUrl);
  if (!origin) return null;
  const rest = pathname.slice('/admin'.length); // "" or "/blog/new"
  // `//` after the prefix (`/admin//evil.example`) would be a protocol-relative URL if it were put after the origin's slash.
  const path = `/${rest.replace(/^\/+/, '')}`;
  return `${origin}${path}${search}`;
}
