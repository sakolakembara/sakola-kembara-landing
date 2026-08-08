"use server";

import { AuthError } from "next-auth";
import { redirect } from "next/navigation";
import { signIn } from "@/auth";

export async function adminSignIn(formData: FormData): Promise<void> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  const from = String(formData.get("from") ?? "");
  const safeFrom = from.startsWith("/") && !from.startsWith("//") ? from : "/admin";

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
