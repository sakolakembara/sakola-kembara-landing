// The `from` of a sign-in link, shared by the admin's SPA and the student portal's. Pure (no DOM, no React):
// the Worker's contract tests import the admin's guard, which re-exports this.

/** Pages that must never be a sign-in destination (it would loop or confuse). */
export const AUTH_PATHS = ["/login", "/forgot-password", "/reset-password", "/verify-email", "/auth"];

/**
 * The path to go to after signing in, from the `from` query parameter. Only a
 * same-origin path is accepted: anything else (another site, a protocol
 * relative `//host`, a backslash trick, control characters, an auth page)
 * gives null, so a crafted link cannot send someone off-site after login.
 *
 * `authPaths` is the list of pages that are never a destination; a SPA with
 * more of them (the portal's `/register`) passes its own.
 */
export function safeFrom(raw: string | null | undefined, authPaths: readonly string[] = AUTH_PATHS): string | null {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//") || raw.includes("\\")) return null;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(raw)) return null;
  let url: URL;
  try {
    url = new URL(raw, "http://admin.invalid");
  } catch {
    return null;
  }
  if (url.origin !== "http://admin.invalid") return null;
  const path = url.pathname;
  if (authPaths.some((auth) => path === auth || path.startsWith(`${auth}/`))) return null;
  return `${url.pathname}${url.search}${url.hash}`;
}
