import type { Metadata } from "next";
import Link from "next/link";
import { authStatus, signIn } from "@/auth";
import { AdminCredentialsForm } from "./_admin-form";
import { GoogleButton } from "./_google-button";

export const metadata: Metadata = {
  title: "Masuk",
  description:
    "Masuk ke akun Sakola Kembara — untuk siswa yang ingin mendaftar dan mengecek status, dan admin yayasan.",
  robots: { index: false, follow: false },
};

const ERRORS: Record<string, string> = {
  domain: "Akun ini tidak diizinkan mengakses halaman tersebut.",
  "admin-only": "Halaman admin hanya untuk pengurus yayasan.",
  CredentialsSignin: "Email atau password admin salah.",
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
    // Post-login redirect is decided in the callback of NextAuth — for
    // students it lands them on /portal; for admins the middleware kicks in.
    // Here we honor the `from` param when it points somewhere sensible.
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
            Masuk untuk mendaftar sebagai calon siswa atau mengelola dashboard.
          </p>
        </div>

        <div className="bg-white rounded-2xl shadow-lg p-8 space-y-6">
          <div>
            <h1 className="font-[var(--font-display)] text-xl text-gray-900 mb-1">
              Selamat datang
            </h1>
            <p className="text-sm text-gray-600">
              Gunakan akun Google untuk melanjutkan. Data pendaftaran kamu akan
              tersimpan pada akun ini agar bisa dibuka kembali kapan saja.
            </p>
          </div>

          {errorMessage && (
            <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
              {errorMessage}
            </div>
          )}

          {authStatus.googleConfigured ? (
            <form action={signInWithGoogle}>
              <GoogleButton />
            </form>
          ) : (
            <div className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-3 text-sm text-amber-800">
              <p className="font-semibold mb-1">
                Login Google belum dikonfigurasi.
              </p>
              <p>
                Set <span className="font-mono">AUTH_GOOGLE_ID</span> dan{" "}
                <span className="font-mono">AUTH_GOOGLE_SECRET</span> di{" "}
                <span className="font-mono">.env.local</span>. Sementara itu,
                admin masih dapat masuk lewat form di bawah.
              </p>
            </div>
          )}

          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <span className="w-full border-t border-gray-200" />
            </div>
            <div className="relative flex justify-center text-xs">
              <span className="bg-white px-3 text-gray-400 uppercase tracking-wider">
                Admin
              </span>
            </div>
          </div>

          <details className="group">
            <summary className="cursor-pointer text-sm text-gray-600 hover:text-gray-900 list-none flex items-center justify-between">
              <span>Masuk sebagai admin (email + password)</span>
              <span className="text-xs text-gray-400 group-open:rotate-180 transition-transform">
                ▾
              </span>
            </summary>
            <div className="mt-4">
              <AdminCredentialsForm from={safeFrom} />
            </div>
          </details>
        </div>

        <p className="text-center text-xs text-gray-500 mt-6">
          Belum punya akun? Cukup masuk dengan Google — akun baru akan otomatis
          dibuat untuk kamu.
        </p>
      </div>
    </main>
  );
}
