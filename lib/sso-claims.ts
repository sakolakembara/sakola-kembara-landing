import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { getAcceptedPublishedBatchIds } from "@/lib/student-applications";
import type { SsoClaims } from "@/lib/sso";

/**
 * Read the user's current landing state and shape it into the SSO JWT
 * claims. Called on sign-in, by POST /api/sso/register, and on every
 * GET /api/sso/session so consumers can get state fresher than the
 * 30-day cookie snapshot.
 *
 * Returns null when the user has been deleted between minting the auth.js
 * session and calling this — treat as "no valid session".
 */
export async function buildSsoClaims(userId: string): Promise<SsoClaims | null> {
  const row = await db.query.users.findFirst({
    where: eq(users.id, userId),
    columns: {
      id: true,
      email: true,
      name: true,
      role: true,
      emailVerifiedAt: true,
    },
  });
  if (!row) return null;

  const acceptedInBatches = await getAcceptedPublishedBatchIds(row.id);

  return {
    sub: row.id,
    email: row.email,
    name: row.name,
    emailVerified: row.emailVerifiedAt !== null,
    landingRole: row.role,
    acceptedInBatches,
  };
}
