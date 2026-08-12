import type { Metadata } from "next";
import Link from "next/link";
import { authStatus, signIn } from "@/auth";
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

  return (
    <main className="min-h-screen flex items-center justify-center bg-gray-50 px-4 py-12">
      <div className="w-full max-w-md">
        <div className="mb-6 text-center">
          <Link
            href="/"
            className="inline-block font-[var(--font-display)] text-2xl text-gray-900 hover:opacity-80 transition-opacity"
          >
            Sakola Kembara
          </Link>
          <p className="text-sm text-gray-500 mt-1">
            Masuk untuk mendaftar sebagai calon siswa Sakola Kembara.
          </p>
        </div>

        <div className="bg-white rounded-2xl shadow-lg p-8 space-y-6">
          <div>
            <h1 className="font-[var(--font-display)] text-xl text-gray-900 mb-1">
              Selamat datang kembali
            </h1>
            <p className="text-sm text-gray-600">
              Gunakan akun Google atau email + password kamu untuk melanjutkan.
            </p>
          </div>

          {errorMessage && (
            <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
              {errorMessage}
            </div>
          )}

          {authStatus.googleConfigured && (
            <form action={signInWithGoogle}>
              <GoogleButton />
            </form>
          )}

          {authStatus.googleConfigured && (
            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <span className="w-full border-t border-gray-200" />
              </div>
              <div className="relative flex justify-center text-xs">
                <span className="bg-white px-3 text-gray-400 uppercase tracking-wider">
                  atau
                </span>
              </div>
            </div>
          )}

          <CredentialsForm from={safeFrom} />
        </div>

        <p className="text-center text-sm text-gray-600 mt-6">
          Belum punya akun?{" "}
          <Link
            href={safeFrom ? `/register?from=${encodeURIComponent(safeFrom)}` : "/register"}
            className="text-primary-blue font-semibold hover:underline"
          >
            Daftar di sini
          </Link>
        </p>
      </div>
    </main>
  );
}
