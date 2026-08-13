import { eq } from "drizzle-orm";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { rateLimit } from "@/lib/rate-limit";
import { sendUserVerificationEmail } from "@/lib/verification-flow";

// Signed-in user requests a fresh verification email. Called by the
// "Kirim ulang tautan verifikasi" button on the portal banner.
//
// Tight rate limit per user (2 per hour) — one legitimate resend covers
// dropped inboxes; more than that is either abuse or someone testing.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(): Promise<Response> {
  const jsonHeaders = { "Content-Type": "application/json" };

  const session = await auth();
  const email = session?.user?.email?.toLowerCase();
  if (!email) {
    return new Response(JSON.stringify({ reason: "unauthorized" }), {
      status: 401,
      headers: jsonHeaders,
    });
  }

  const limit = await rateLimit({
    action: "account.resend-verification",
    limit: 2,
    windowSeconds: 60 * 60,
    extraKey: email,
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

  const row = await db.query.users.findFirst({
    where: eq(users.email, email),
    columns: { id: true, email: true, emailVerifiedAt: true },
  });
  if (!row) {
    return new Response(JSON.stringify({ reason: "unauthorized" }), {
      status: 401,
      headers: jsonHeaders,
    });
  }

  // Already verified — silent success so the UI doesn't confuse a user
  // who just clicked the button in a stale tab.
  if (row.emailVerifiedAt) {
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: jsonHeaders,
    });
  }

  const sent = await sendUserVerificationEmail(row.id, row.email);
  return new Response(
    JSON.stringify({ ok: sent }),
    { status: sent ? 200 : 502, headers: jsonHeaders },
  );
}
