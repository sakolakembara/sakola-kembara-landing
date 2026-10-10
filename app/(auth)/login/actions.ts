"use server";

import { AuthError } from "next-auth";
import { redirect } from "next/navigation";
import { signIn } from "@/auth";
import { rateLimit } from "@/lib/rate-limit";

/**
 * Sign in with email + password. Works for any account that has a
 * `password_hash` — students who registered locally and admins seeded via
 * the CLI. The middleware routes by role after the session is issued.
 */
export async function credentialsSignIn(formData: FormData): Promise<void> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  const from = String(formData.get("from") ?? "");
  // Default to /portal after credential sign-in — students land there, and
  // the middleware will bounce admins to /admin on their next request.
  const safeFrom = from.startsWith("/") && !from.startsWith("//") ? from : "/portal";

  // Throttle attempts per IP + email so credential-stuffing gets shut down
  // quickly without locking a real user out from every device.
  const limit = await rateLimit({
    action: "credentials.signin",
    limit: 5,
    windowSeconds: 300,
    // Capped at the maximum email length so the key stays bounded.
    extraKey: email.slice(0, 254) || "anon",
  });
  if (!limit.allowed) {
    redirect("/login?error=RateLimited");
  }

  // Second, wider cap per email regardless of IP, so guesses spread across
  // many addresses still add up against one account. Only requests that pass
  // the per-IP check above count here, which keeps a single client from
  // exhausting it on its own.
  if (email) {
    const perAccount = await rateLimit({
      action: "credentials.signin.account",
      limit: 20,
      windowSeconds: 900,
      extraKey: email.slice(0, 254),
      perIp: false,
    });
    if (!perAccount.allowed) {
      redirect("/login?error=RateLimited");
    }
  }

  try {
    await signIn("credentials", {
      email,
      password,
      redirectTo: safeFrom,
    });
  } catch (err) {
    if (err instanceof AuthError) {
      const code =
        err.type === "CredentialsSignin" ? "CredentialsSignin" : "Default";
      redirect(`/login?error=${code}`);
    }
    // Next.js uses a special "NEXT_REDIRECT" error internally when signIn
    // redirects — re-throw so the framework handles it.
    throw err;
  }
}
