import { cookies } from "next/headers";
import { corsHeadersFor, optionsPreflight } from "@/lib/cors";
import { COOKIE_NAME, readSsoToken } from "@/lib/sso";

// LMS-facing session probe. Returns the current SSO claims (as `user`) or
// `{ authenticated: false }`. Namespaced under /api/sso/* (not /api/auth/*)
// so we don't shadow Auth.js's own catch-all handler at
// /api/auth/[...nextauth]/route.ts.
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

export async function GET(request: Request): Promise<Response> {
  const store = await cookies();
  const raw = store.get(COOKIE_NAME)?.value;
  const claims = await readSsoToken(raw);

  const headers = {
    "Content-Type": "application/json",
    "Cache-Control": "private, no-store",
    ...corsHeadersFor(request),
  };

  if (!claims) {
    return new Response(JSON.stringify({ authenticated: false }), {
      status: 200,
      headers,
    });
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
