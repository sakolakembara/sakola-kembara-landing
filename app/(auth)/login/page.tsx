import type { Metadata } from "next";
import Link from "next/link";
import { authStatus, signIn } from "@/auth";
import { Alert } from "@/components/ui/alert";
import { AUTH_LINK, AuthDivider, AuthShell } from "../_auth-shell";
import { CredentialsForm } from "./_credentials-form";
import { GoogleButton } from "./_google-button";

export const metadata: Metadata = {
  title: "Masuk",
  description:
    "Masuk ke akun Sakola Kembara untuk mendaftar dan mengecek status pendaftaran kamu.",
  robots: { index: false, follow: false },
};

const ERRORS: Record<string, string> = {
  domain: "Akun ini tidak diizinkan mengakses halaman tersebut.",
  "admin-only": "Halaman itu hanya untuk pengurus yayasan.",
  CredentialsSignin: "Email atau password salah.",
  RateLimited:
    "Terlalu banyak percobaan masuk. Silakan tunggu beberapa menit lalu coba lagi.",
  Configuration:
    "Konfigurasi autentikasi belum lengkap. Hubungi tim teknis.",
  Default: "Gagal masuk. Silakan coba lagi.",
};

interface LoginPageProps {
  searchParams: Promise<{ from?: string; error?: string }>;
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const { from, error } = await searchParams;
  // Safe redirect: only allow internal paths so a malicious `from` can't send
  // the user off-site after sign-in.
  const safeFrom = from && from.startsWith("/") && !from.startsWith("//") ? from : null;
  const errorMessage = error ? ERRORS[error] ?? ERRORS.Default : null;

  async function signInWithGoogle() {
    "use server";
    await signIn("google", {
      redirectTo: safeFrom ?? "/portal",
    });
  }

  // Shared by students and admins, so the heading names the site, not a role.
  return (
    <AuthShell
      title="Masuk ke Sakola Kembara"
      footer={
        <>
          Belum punya akun?{" "}
          <Link
            href={safeFrom ? `/register?from=${encodeURIComponent(safeFrom)}` : "/register"}
            className={AUTH_LINK}
          >
            Daftar di sini
          </Link>
        </>
      }
    >
      {errorMessage && <Alert>{errorMessage}</Alert>}

      <CredentialsForm from={safeFrom} />

      {authStatus.googleConfigured && (
        <>
          <AuthDivider />
          <form action={signInWithGoogle}>
            <GoogleButton />
          </form>
        </>
      )}
    </AuthShell>
  );
}
