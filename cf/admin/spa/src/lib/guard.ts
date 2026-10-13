import { safeFrom } from "../../../shared/spa/safe-from";
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

// `safeFrom` (the `from` of a sign-in link) is shared with the student portal's SPA: cf/admin/shared/spa/safe-from.ts.
// It is re-exported here, where the admin's pages and tests import it from.
export { safeFrom };

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
