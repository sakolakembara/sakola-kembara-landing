// The public origin the files are served from, as the SPA needs it to show an
// uploaded image (`GET /api/config` answers `uploadsBaseUrl`). The same rule as
// the public site's `uploadsBase` (cf/web/src/lib/uploads.ts): an http(s)
// origin without a trailing slash, or "" for "same origin" (local development,
// where `/uploads/...` is served by the dev route through the Vite proxy). A
// value that is not a plain origin is treated as unset, so a typo can break
// images but can never put a quote or `javascript:` into an attribute.

/** An http(s) origin: scheme, host, optional port. No path, query, userinfo, quote, angle bracket or space. */
const ORIGIN = /^https?:\/\/[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?(:\d{1,5})?$/;

/** The usable base (no trailing slash), or "" when there is none. */
export function uploadsBase(value: string | undefined | null): string {
  const trimmed = (value ?? "").trim().replace(/\/+$/, "");
  return ORIGIN.test(trimmed) ? trimmed : "";
}
