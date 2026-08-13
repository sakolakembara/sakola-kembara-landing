import { cookies } from "next/headers";
import {
  corsHeadersFor,
  isOriginAllowedForStateChange,
  optionsPreflight,
} from "@/lib/cors";
import { clearSsoCookieOptions } from "@/lib/sso";
import { rateLimit } from "@/lib/rate-limit";

// LMS-facing sign-out endpoint. Clears the shared SSO cookie so a
// sign-out on the LMS side also signs the user out of landing.
//
// Doesn't clear Auth.js's own session cookie — Auth.js's cookie is
// scoped to the landing host and won't reach the LMS anyway. When the
// user next hits landing after this call, Auth.js will re-mint its own
// session from scratch OR the missing SSO cookie will trigger a fresh
// sign-in flow. Either way, the LMS-facing state is consistent.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const OPTIONS = optionsPreflight;

export async function POST(request: Request): Promise<Response> {
  const cors = corsHeadersFor(request);
  const headers = { "Content-Type": "application/json", ...cors };

  // Origin allow-list check — signing a user out remotely is state-changing
  // and the browser will attempt it (via a form submit or fetch) even
  // without CORS allowing the response read. Reject unknown origins.
  if (!isOriginAllowedForStateChange(request)) {
    return new Response(
      JSON.stringify({ reason: "forbidden_origin" }),
      { status: 403, headers },
    );
  }

  // Rate limit to blunt anyone spamming sign-outs even from an allow-listed
  // origin. Generous — legit users sign out infrequently.
  const limit = await rateLimit({
    action: "sso.signout",
    limit: 20,
    windowSeconds: 60,
  });
  if (!limit.allowed) {
    return new Response(
      JSON.stringify({ reason: "rate_limited" }),
      { status: 429, headers },
    );
  }

  const store = await cookies();
  store.set({ ...clearSsoCookieOptions(), value: "" });

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers,
  });
}
