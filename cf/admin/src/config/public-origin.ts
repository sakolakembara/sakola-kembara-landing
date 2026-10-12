// A public origin the Worker hands to the SPA through `GET /api/config`: where uploaded files are served from
// (`UPLOADS_BASE_URL`, src/uploads/base-url.ts) and the address of the public site (`SITE_URL`). The same rule as
// the public site's `uploadsBase` (cf/web/src/lib/uploads.ts): an http(s) origin without a trailing slash, or "" for
// "none". A value that is not a plain origin is treated as unset, so a typo can break a link or an image but can
// never put a quote or `javascript:` into an attribute.

/** An http(s) origin: scheme, host, optional port. No path, query, userinfo, quote, angle bracket or space. */
const ORIGIN = /^https?:\/\/[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?(:\d{1,5})?$/;

/** The usable origin (no trailing slash), or "" when there is none. */
export function publicOrigin(value: string | undefined | null): string {
  const trimmed = (value ?? "").trim().replace(/\/+$/, "");
  return ORIGIN.test(trimmed) ? trimmed : "";
}
