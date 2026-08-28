import { cookies } from "next/headers";
import { corsHeadersFor, optionsPreflight } from "@/lib/cors";
import { buildSsoClaims } from "@/lib/sso-claims";
import {
  COOKIE_NAME,
  clearSsoCookieOptions,
  signSsoToken,
  ssoClaimsEqual,
  ssoCookieOptions,
  verifySsoToken,
} from "@/lib/sso";

// LMS-facing session probe. Returns the current SSO claims (as `user`) or
// `{ authenticated: false }`. Namespaced under /api/sso/* (not /api/auth/*)
// so we don't shadow Auth.js's own catch-all handler at
// /api/auth/[...nextauth]/route.ts.
//
// This endpoint is AUTHORITATIVE and the cookie is not. The JWT is a
// snapshot taken at sign-in and lives for 30 days, so an acceptance that was
// revoked, a batch that was unpublished, a role that changed or an email
// that was verified since then are all invisible to a consumer that only
// verifies the cookie locally. Here we re-read the database on every call.
//
// Consumers should therefore verify the JWT locally for *identity* (cheap,
// no network) but call this endpoint before any authorization decision that
// depends on `acceptedInBatches`.
//
// The cookie is HttpOnly, so LMS's Nuxt frontend can't read it directly.
// Two integration patterns:
//   1. Django reads the cookie on the request and passes state down to Nuxt
//      via the SSR data (recommended — Django is the trust boundary anyway).
//   2. Nuxt calls this endpoint with `credentials: "include"` to get a JSON
//      view of the session, useful for CSR pages.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const OPTIONS = optionsPreflight;

/** Don't bother re-issuing a cookie that is about to expire anyway. */
const MIN_REISSUE_SECONDS = 60;

export async function GET(request: Request): Promise<Response> {
  const headers = {
    "Content-Type": "application/json",
    "Cache-Control": "private, no-store",
    ...corsHeadersFor(request),
  };
  const unauthenticated = () =>
    new Response(JSON.stringify({ authenticated: false }), {
      status: 200,
      headers,
    });

  const store = await cookies();

  // Verify the signature BEFORE touching the database. Every unauthenticated
  // visitor and every forged token then costs one HMAC check rather than a
  // query, which is what keeps this endpoint safe to leave unthrottled.
  const verified = await verifySsoToken(store.get(COOKIE_NAME)?.value);
  if (!verified) return unauthenticated();

  const claims = await buildSsoClaims(verified.claims.sub);
  if (!claims) {
    // The user was deleted since the token was minted. Clear the cookie so
    // the browser stops presenting credentials for a row that is gone.
    store.set({ ...clearSsoCookieOptions(), value: "" });
    return unauthenticated();
  }

  // Write the refreshed claims back to the cookie so consumers that verify
  // it locally converge too, instead of only callers of this endpoint.
  // Expiry is preserved, never extended: re-issuing must not turn a 30-day
  // absolute session into an indefinitely sliding one.
  const remaining = verified.expiresAt - Math.floor(Date.now() / 1000);
  if (!ssoClaimsEqual(verified.claims, claims) && remaining > MIN_REISSUE_SECONDS) {
    try {
      const token = await signSsoToken(claims, { expiresAt: verified.expiresAt });
      store.set({ ...ssoCookieOptions(), value: token, maxAge: remaining });
    } catch (err) {
      // A failed refresh must not fail the probe — the response body below
      // still carries the live claims, which is what the caller asked for.
      console.error("[sso] failed to refresh session cookie:", err);
    }
  }

  return new Response(
    JSON.stringify({
      authenticated: true,
      user: {
        sub: claims.sub,
        email: claims.email,
        name: claims.name,
        emailVerified: claims.emailVerified,
        landingRole: claims.landingRole,
        acceptedInBatches: claims.acceptedInBatches,
      },
    }),
    { status: 200, headers },
  );
}
