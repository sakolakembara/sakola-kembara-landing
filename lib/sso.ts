import "server-only";
import { SignJWT, jwtVerify, errors as joseErrors } from "jose";
import { env } from "@/lib/env";
import type { UserRole } from "@/lib/db/schema";

// Cross-subdomain session token consumed by services on *.sakolakembara.org
// (currently: the LMS at lms.sakolakembara.org). Distinct from Auth.js's
// own session cookie — we deliberately don't try to make external services
// parse Auth.js's JWE format. This is a plain HS256 JWT with a small,
// documented claim set. Contract lives in docs/architecture/lms-integration.md.
//
// EVERYTHING in this file is server-only. The signing secret must never
// leave the server bundle.

export const COOKIE_NAME = "sakem-session";
export const ISSUER = "sakolakembara.org";
export const AUDIENCE = "sakolakembara-services";
export const ALGORITHM = "HS256";

/**
 * Token lifetime. Long enough that day-to-day users don't get bounced back
 * to sign-in constantly; short enough that acceptance / revocation changes
 * propagate within a reasonable window without a manual refresh flow.
 */
export const TOKEN_MAX_AGE_SECONDS = 30 * 24 * 60 * 60; // 30 days

export interface SsoClaims {
  /** landing.users.id */
  sub: string;
  email: string;
  name: string | null;
  emailVerified: boolean;
  /** Advisory only. LMS must not read this for authorization decisions. */
  landingRole: UserRole;
  /** admission_batches.id list where user has an accepted, published application. */
  acceptedInBatches: string[];
}

function secretKey(): Uint8Array {
  if (!env.SSO_JWT_SECRET) {
    throw new Error(
      "SSO_JWT_SECRET is not set. Generate one with `openssl rand -base64 32` and add it to .env.local.",
    );
  }
  return new TextEncoder().encode(env.SSO_JWT_SECRET);
}

/**
 * Sign a fresh SSO JWT. Caller supplies the domain claims; iat/exp/iss/aud
 * are added here so no route handler forgets them.
 */
export async function signSsoToken(claims: SsoClaims): Promise<string> {
  return new SignJWT({ ...claims })
    .setProtectedHeader({ alg: ALGORITHM })
    .setIssuedAt()
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setExpirationTime(`${TOKEN_MAX_AGE_SECONDS}s`)
    .sign(secretKey());
}

/**
 * Verify a token and return its claims. Returns null on any failure —
 * bad signature, expired, wrong issuer/audience, malformed. Callers
 * should treat null as "no valid session" and never try to distinguish
 * the failure mode (that's an attacker's oracle).
 */
export async function readSsoToken(token: string | undefined): Promise<SsoClaims | null> {
  if (!token) return null;
  if (!env.SSO_JWT_SECRET) return null;
  try {
    const { payload } = await jwtVerify(token, secretKey(), {
      issuer: ISSUER,
      audience: AUDIENCE,
      algorithms: [ALGORITHM],
    });
    // Structural check — jose validates iss/aud/exp but not our custom claims.
    if (
      typeof payload.sub === "string" &&
      typeof payload.email === "string" &&
      typeof payload.emailVerified === "boolean" &&
      typeof payload.landingRole === "string" &&
      Array.isArray(payload.acceptedInBatches)
    ) {
      return {
        sub: payload.sub,
        email: payload.email,
        name: typeof payload.name === "string" ? payload.name : null,
        emailVerified: payload.emailVerified,
        landingRole: payload.landingRole as UserRole,
        acceptedInBatches: payload.acceptedInBatches.filter(
          (v): v is string => typeof v === "string",
        ),
      };
    }
    return null;
  } catch (err) {
    // Silence expected verification errors — noisy in tests, unhelpful in
    // prod logs. Real bugs (e.g. bad secret encoding) still throw and get
    // caught by the caller's error boundary + Sentry.
    if (err instanceof joseErrors.JOSEError) return null;
    throw err;
  }
}

export interface CookieOptions {
  name: string;
  httpOnly: true;
  secure: boolean;
  sameSite: "lax";
  path: "/";
  domain?: string;
  maxAge: number;
}

/**
 * Cookie options for the SSO session cookie. Domain is set from
 * SSO_COOKIE_DOMAIN when present (must be `.sakolakembara.org` in prod so
 * the LMS subdomain sees it); host-only otherwise.
 */
export function ssoCookieOptions(): CookieOptions {
  return {
    name: COOKIE_NAME,
    httpOnly: true,
    secure: env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    domain: env.SSO_COOKIE_DOMAIN,
    maxAge: TOKEN_MAX_AGE_SECONDS,
  };
}

/**
 * Cookie options that clear the SSO cookie. Same Domain as the setter —
 * otherwise the browser considers it a different cookie and keeps the
 * original around.
 */
export function clearSsoCookieOptions(): CookieOptions {
  return { ...ssoCookieOptions(), maxAge: 0 };
}
