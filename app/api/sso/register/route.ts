import { z } from "zod";
import {
  corsHeadersFor,
  isOriginAllowedForStateChange,
  optionsPreflight,
} from "@/lib/cors";
import { rateLimit } from "@/lib/rate-limit";
import { writeAudit } from "@/lib/audit";
import {
  STUDENT_PASSWORD_MIN_LENGTH,
  createStudentAccount,
} from "@/lib/student-signup-service";
import { sendUserVerificationEmail } from "@/lib/verification-flow";
import { buildSsoClaims } from "@/lib/sso-claims";
import { signSsoToken, ssoCookieOptions } from "@/lib/sso";
import { cookies } from "next/headers";

// LMS-facing student registration endpoint. LMS's own Nuxt "Daftar Akun"
// form POSTs here instead of minting its own users — that way there's
// exactly ONE identity per email across landing + LMS, forever.
//
// On success we set the SSO cookie in the response so the caller is
// signed in immediately without an extra round-trip. Works cross-domain
// because the cookie is scoped to `.sakolakembara.org` (see ssoCookieOptions).
//
// MUST be called from the end user's browser (fetch with
// `credentials: "include"`), never proxied through the LMS server. Two
// reasons: the Set-Cookie has to reach the user's own cookie jar, and the
// rate limit below buckets by client IP — a server-side proxy would put
// every signup in the world into one bucket and cap registrations at three
// per five minutes globally.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(STUDENT_PASSWORD_MIN_LENGTH).max(200),
  /** Short enum for audit metadata — where did this signup originate. */
  source: z.enum(["lms", "landing"]).optional(),
});

export const OPTIONS = optionsPreflight;

export async function POST(request: Request): Promise<Response> {
  const cors = corsHeadersFor(request);
  const jsonHeaders = { "Content-Type": "application/json", ...cors };

  // Login-CSRF defense. This endpoint sets a session cookie in the
  // response, so we can't rely on CORS alone (CORS only stops the browser
  // reading the reply; Set-Cookie lands regardless). Only accept POSTs
  // whose Origin is explicitly allow-listed.
  if (!isOriginAllowedForStateChange(request)) {
    return new Response(
      JSON.stringify({ reason: "forbidden_origin" }),
      { status: 403, headers: jsonHeaders },
    );
  }

  const limit = await rateLimit({
    action: "sso.register",
    limit: 3,
    windowSeconds: 300,
  });
  if (!limit.allowed) {
    return new Response(
      JSON.stringify({
        reason: "rate_limited",
        retryAfter: Math.max(1, Math.ceil((limit.resetAt - Date.now()) / 1000)),
      }),
      { status: 429, headers: jsonHeaders },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return new Response(
      JSON.stringify({ reason: "invalid_json" }),
      { status: 400, headers: jsonHeaders },
    );
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return new Response(
      JSON.stringify({
        reason: "invalid_input",
        fieldErrors: parsed.error.flatten().fieldErrors,
      }),
      { status: 400, headers: jsonHeaders },
    );
  }

  const result = await createStudentAccount({
    email: parsed.data.email,
    name: parsed.data.name,
    password: parsed.data.password,
  });

  if (!result.ok) {
    return new Response(JSON.stringify({ reason: result.reason }), {
      status: 409,
      headers: jsonHeaders,
    });
  }

  await writeAudit({
    actorEmail: parsed.data.email,
    actorId: result.id,
    action: "student.register",
    resourceType: "user",
    resourceId: result.id,
    metadata: { source: parsed.data.source ?? "landing" },
  });

  // Best-effort send of the verification email. Failure doesn't fail the
  // signup — the caller can invoke /api/account/resend-verification later.
  await sendUserVerificationEmail(result.id, parsed.data.email);

  // Mint the SSO cookie so the caller is signed in immediately.
  const claims = await buildSsoClaims(result.id);
  if (!claims) {
    // Shouldn't happen (we just inserted the row) — fall back to 201
    // without the cookie so LMS can send them through the sign-in flow.
    return new Response(
      JSON.stringify({
        user: {
          id: result.id,
          email: parsed.data.email,
          name: parsed.data.name,
        },
      }),
      { status: 201, headers: jsonHeaders },
    );
  }

  const token = await signSsoToken(claims);
  const store = await cookies();
  store.set({ ...ssoCookieOptions(), value: token });

  return new Response(
    JSON.stringify({
      user: {
        id: claims.sub,
        email: claims.email,
        name: claims.name,
        landingRole: claims.landingRole,
        emailVerified: claims.emailVerified,
      },
    }),
    { status: 201, headers: jsonHeaders },
  );
}
