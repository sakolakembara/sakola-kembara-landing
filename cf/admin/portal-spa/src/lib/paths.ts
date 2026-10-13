// Where the portal lives and what it calls. Pure (no DOM, no React): the Worker's contract tests import it
// (test/portal-spa-contract.test.ts, when the portal Worker exists) to prove the two sides still match.

/** Where the Worker `sakem-portal` serves the SPA on the apex, and the router's basename. Pages use paths relative to it. */
export const BASE = "/portal";

/** The student API (docs/cloudflare/portal-api.md). Every call is same-origin and absolute: it carries the prefix. */
export const API = `${BASE}/api`;

/** The auth routes, Better Auth's, under the portal's own base path (docs/cloudflare/portal-api.md#3-auth-routes). */
export const AUTH_API = `${API}/auth`;

export const ENDPOINTS = {
  config: `${API}/config`,
  me: `${API}/me`,
  overview: `${API}/overview`,
  applications: `${API}/applications`,
  signIn: `${AUTH_API}/sign-in/email`,
  signInSocial: `${AUTH_API}/sign-in/social`,
  signOut: `${AUTH_API}/sign-out`,
  register: `${AUTH_API}/register`,
  requestReset: `${AUTH_API}/request-password-reset`,
  resetPassword: `${AUTH_API}/reset-password`,
  sendVerification: `${AUTH_API}/send-verification-email`,
} as const;

/**
 * The address of a page of this SPA as the SERVER wants it (a `callbackURL`, a `redirectTo`): the router's own
 * paths (`/login`) have no prefix, everything sent to the server does (`/portal/login`).
 */
export function serverPath(routerPath: string): string {
  return `${BASE}${routerPath === "/" ? "/" : routerPath}`;
}

/** Where the link in a verification email lands after Better Auth verifies it: a sign-in on an unverified account asks for it. */
export const VERIFY_CALLBACK = serverPath("/verify-email?status=success");

/** Where the link of a registration (and of its "kirim ulang") lands: the sign-in page, with a note that the email is verified. */
export const REGISTER_CALLBACK = serverPath("/login?verified=1");

/** Where the link in the reset email lands, with `?token=` (or `?error=`). */
export const RESET_PAGE = serverPath("/reset-password");

/** The destination Google sends the browser to once it is done: the page the student came from, or the portal's front page. */
export function googleCallback(from: string | null): string {
  return from ? serverPath(from) : serverPath("/");
}
