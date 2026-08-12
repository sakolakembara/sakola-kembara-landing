"use server";

import { AuthError } from "next-auth";
import { redirect } from "next/navigation";
import { signIn } from "@/auth";
import { rateLimit } from "@/lib/rate-limit";

export async function adminSignIn(formData: FormData): Promise<void> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  const from = String(formData.get("from") ?? "");
  const safeFrom = from.startsWith("/") && !from.startsWith("//") ? from : "/admin";

  // Throttle attempts per IP + email so a credential-stuffing attempt gets
  // shut down quickly without locking a real admin out from every device.
  const limit = await rateLimit({
    action: "admin.signin",
    limit: 5,
    windowSeconds: 300,
    extraKey: email || "anon",
  });
  if (!limit.allowed) {
    redirect("/login?error=RateLimited");
  }

  try {
    // `redirect: false` so NextAuth throws instead of redirecting inside the
    // action — we want to control the destination based on role.
    await signIn("admin-credentials", {
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
