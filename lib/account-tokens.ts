import "server-only";
import { SignJWT, jwtVerify, errors as joseErrors } from "jose";
import { env } from "@/lib/env";

// Short-lived JWTs for email-verification and password-reset links.
// These tokens travel in an email → URL query param and are consumed
// exactly once on the server. They never leave landing's control.
//
// Signed with AUTH_SECRET rather than a dedicated secret because there's
// no benefit to a separate rotation domain — same threat model as the
// Auth.js session token itself, produced and consumed by the same
// codebase.

const ISSUER = "sakolakembara.org";
const AUDIENCE = "sakolakembara-account";
const ALGORITHM = "HS256";

export const VERIFY_EMAIL_MAX_AGE_SECONDS = 24 * 60 * 60; // 24h
export const RESET_PASSWORD_MAX_AGE_SECONDS = 30 * 60; // 30 min

export type TokenPurpose = "verify-email" | "reset-password";

export interface AccountTokenClaims {
  sub: string; // users.id
  email: string; // snapshot at issue time — verified against DB row on redemption
  purpose: TokenPurpose;
}

function secret(): Uint8Array {
  return new TextEncoder().encode(env.AUTH_SECRET);
}

function ttlFor(purpose: TokenPurpose): number {
  return purpose === "verify-email"
    ? VERIFY_EMAIL_MAX_AGE_SECONDS
    : RESET_PASSWORD_MAX_AGE_SECONDS;
}

/**
 * Sign an account-action token. Caller supplies (userId, email, purpose).
 * The email is embedded so a redemption on a row whose email has changed
 * since issuing (e.g. admin edited it in /admin/settings) is rejected —
 * defense against a stolen verification link surviving an email change.
 */
export async function signAccountToken(
  claims: AccountTokenClaims,
): Promise<string> {
  return new SignJWT({
    email: claims.email,
    purpose: claims.purpose,
  })
    .setProtectedHeader({ alg: ALGORITHM })
    .setSubject(claims.sub)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${ttlFor(claims.purpose)}s`)
    .sign(secret());
}

/**
 * Verify a token and return its claims, or null on any failure — bad
 * signature, expired, wrong purpose, malformed. Callers should treat
 * null as "invalid or expired link" without distinguishing the reason
 * (avoids an oracle).
 */
export async function readAccountToken(
  token: string | undefined,
  expectedPurpose: TokenPurpose,
): Promise<AccountTokenClaims | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret(), {
      issuer: ISSUER,
      audience: AUDIENCE,
      algorithms: [ALGORITHM],
    });
    if (
      typeof payload.sub === "string" &&
      typeof payload.email === "string" &&
      payload.purpose === expectedPurpose
    ) {
      return {
        sub: payload.sub,
        email: payload.email,
        purpose: expectedPurpose,
      };
    }
    return null;
  } catch (err) {
    if (err instanceof joseErrors.JOSEError) return null;
    throw err;
  }
}
