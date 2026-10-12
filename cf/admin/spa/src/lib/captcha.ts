// What the SPA and the Worker agree on about Turnstile. Pure (no DOM, no React,
// no fetch): like lib/auth-errors.ts, the Worker's contract test imports it
// (test/spa-contract.test.ts) to prove the two sides still match.
//
// The widget only produces a token. The Worker checks it with Siteverify
// (src/security/turnstile.ts, src/auth/gate.ts); nothing here protects anything.

/** The request header the Worker reads the token from (`TURNSTILE_HEADER` in src/security/turnstile.ts; the Worker reads it case-insensitively). */
export const TURNSTILE_HEADER = "X-Turnstile-Token";

/**
 * The widget's `action` (the `data-action` of the docs). Siteverify echoes it
 * back and the Worker refuses a token made for another form, so each page
 * names its own. Must be one of the Worker's `TurnstileAction`s.
 */
export type TurnstileAction = "login" | "forgot-password" | "resend-verification";

/**
 * The route each action protects, as the SPA calls it. The contract test checks
 * that the Worker's route table (`AUTH_POLICIES` in src/auth/gate.ts) asks for
 * exactly this action on exactly these routes.
 *
 * `resend-verification` has no button in the SPA yet: Better Auth sends a fresh
 * link by itself when an unverified account signs in. The name is here so the
 * first page that resends does not invent one.
 */
export const TURNSTILE_ROUTES = {
  login: "/api/auth/sign-in/email",
  "forgot-password": "/api/auth/request-password-reset",
  "resend-verification": "/api/auth/send-verification-email",
} as const satisfies Record<TurnstileAction, string>;

/** `GET /api/config`: what the browser may know before anyone signs in. */
export interface PublicConfig {
  /** Google sign-in is switched on. */
  google: boolean;
  /** The widget's public site key, or null when this deployment has no Turnstile (local runs, the mock). Never a secret. */
  turnstileSiteKey: string | null;
}

export const NO_CONFIG: PublicConfig = { google: false, turnstileSiteKey: null };

/** Reads the answer of `GET /api/config`; anything unexpected means "not configured". */
export function parsePublicConfig(raw: unknown): PublicConfig {
  const body = (raw !== null && typeof raw === "object" ? raw : {}) as { google?: unknown; turnstileSiteKey?: unknown };
  const key = typeof body.turnstileSiteKey === "string" ? body.turnstileSiteKey.trim() : "";
  return { google: body.google === true, turnstileSiteKey: key === "" ? null : key };
}
