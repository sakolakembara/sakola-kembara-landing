import { AUTH_PATHS, safeFrom } from "@shared/spa/safe-from";
import { isStudent, type Me } from "./me";

// Pure decisions behind the route guard (components/RequireStudent.tsx), so they can be tested without a DOM.

export type SessionState =
  | { status: "loading" }
  /** `/portal/api/me` failed for a reason other than "not signed in" (offline, 5xx). */
  | { status: "error" }
  /** `byUser` is true right after pressing Keluar: go to /login without a `from`. */
  | { status: "signed-out"; byUser: boolean }
  | { status: "ready"; me: Me };

export type GuardDecision =
  | { kind: "loading" }
  | { kind: "error" }
  | { kind: "login"; to: string }
  /** Signed in, but the account is not a student (an admin account: it signs in on the apex too). */
  | { kind: "not-student"; me: Me }
  | { kind: "allow"; me: Me };

/**
 * Pages that are never a sign-in destination: the admin's list and `/register`, which the portal adds (it would
 * send a student who just signed in to the sign-up form).
 */
export const PORTAL_AUTH_PATHS = [...AUTH_PATHS, "/register"];

/**
 * The path to go to after signing in, from the `from` query parameter, relative to the router's basename (`/daftar`,
 * not `/portal/daftar`). Only a same-origin path is accepted; anything else gives null (see shared/spa/safe-from.ts).
 *
 * An old link (the legacy `/login?from=/portal/status`, which the public site redirects here with its query) carries the
 * ABSOLUTE path of the legacy portal. The router's paths have no `/portal`, so that prefix is taken off before the check:
 * `/portal/status` is `/status`, `/portal` is `/`.
 */
export function portalSafeFrom(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  const rest = raw.replace(/^\/portal(?=$|[/?#])/, "");
  const relative = raw.startsWith("/portal") && (rest === "" || /^[?#]/.test(rest)) ? `/${rest}` : rest;
  return safeFrom(relative, PORTAL_AUTH_PATHS);
}

/** `/login`, carrying the page that was asked for unless it is the front page. */
export function loginPath(from?: string | null): string {
  const safe = portalSafeFrom(from);
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
      return isStudent(state.me) ? { kind: "allow", me: state.me } : { kind: "not-student", me: state.me };
  }
}
