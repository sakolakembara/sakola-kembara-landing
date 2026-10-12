import { accessTo } from "./access";
import type { Me } from "./me";

// Pure decisions behind the route guard (components/RequireAuth.tsx), so they
// can be tested without a DOM.

export type SessionState =
  | { status: "loading" }
  /** `/api/me` failed for a reason other than "not signed in" (offline, 5xx). */
  | { status: "error" }
  /** `byUser` is true right after pressing Keluar: go to /login without a `from`. */
  | { status: "signed-out"; byUser: boolean }
  | { status: "ready"; me: Me };

export type GuardDecision =
  | { kind: "loading" }
  | { kind: "error" }
  | { kind: "login"; to: string }
  /** Signed in, but the account is not an admin (a student, an unknown role). */
  | { kind: "no-admin-access"; me: Me }
  | { kind: "allow"; me: Me };

// Pages that must never be a sign-in destination (it would loop or confuse).
const AUTH_PATHS = ["/login", "/forgot-password", "/reset-password", "/verify-email", "/auth"];

/**
 * The path to go to after signing in, from the `from` query parameter. Only a
 * same-origin path is accepted: anything else (another site, a protocol
 * relative `//host`, a backslash trick, control characters, an auth page)
 * gives null, so a crafted link cannot send someone off-site after login.
 */
export function safeFrom(raw: string | null | undefined): string | null {
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
  if (AUTH_PATHS.some((auth) => path === auth || path.startsWith(`${auth}/`))) return null;
  return `${url.pathname}${url.search}${url.hash}`;
}

/** `/login`, carrying the page that was asked for unless it is the dashboard. */
export function loginPath(from?: string | null): string {
  const safe = safeFrom(from);
  return safe && safe !== "/" ? `/login?from=${encodeURIComponent(safe)}` : "/login";
}

export function decideGuard(
  state: SessionState,
  location: { pathname: string; search?: string; hash?: string },
): GuardDecision {
  switch (state.status) {
    case "loading":
      return { kind: "loading" };
    case "error":
      return { kind: "error" };
    case "signed-out":
      return {
        kind: "login",
        to: state.byUser ? "/login" : loginPath(`${location.pathname}${location.search ?? ""}${location.hash ?? ""}`),
      };
    case "ready":
      return accessTo(state.me, "umum") === "none"
        ? { kind: "no-admin-access", me: state.me }
        : { kind: "allow", me: state.me };
  }
}
