import "server-only";
import { env } from "@/lib/env";
import { signAccountToken } from "@/lib/account-tokens";
import { sendVerificationEmail } from "@/lib/email";

/**
 * Sign a verification token for the given user and send them the email
 * with the click-to-verify link. Best-effort — never throws, so a caller
 * (e.g. the signup path) can proceed even if the vendor is temporarily
 * down. Logs failures for later investigation via Sentry.
 *
 * Returns true when the send succeeded (or was logged in dev fallback),
 * false when the vendor call failed. Callers can use this to decide
 * whether to nudge the user to hit "resend" immediately.
 */
export async function sendUserVerificationEmail(
  userId: string,
  email: string,
): Promise<boolean> {
  try {
    const token = await signAccountToken({
      sub: userId,
      email,
      purpose: "verify-email",
    });
    const url = buildVerificationUrl(token);
    const result = await sendVerificationEmail(email, url);
    if (!result.ok) {
      console.error("[verification] send failed:", result.reason);
      return false;
    }
    return true;
  } catch (err) {
    console.error("[verification] unexpected error:", err);
    return false;
  }
}

function buildVerificationUrl(token: string): string {
  const base = env.APP_URL ?? env.NEXTAUTH_URL;
  const url = new URL("/verify-email", base);
  url.searchParams.set("token", token);
  return url.toString();
}
