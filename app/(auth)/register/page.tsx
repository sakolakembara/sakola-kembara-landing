import type { Metadata } from "next";
import Link from "next/link";
import { authStatus, signIn } from "@/auth";
import { GoogleButton } from "../login/_google-button";
import { RegisterForm } from "./_register-form";

export const metadata: Metadata = {
  title: "Daftar Akun",
  description:
    "Buat akun Sakola Kembara untuk mendaftar sebagai calon siswa dan mengecek status pendaftaran kamu.",
  robots: { index: false, follow: false },
};

interface RegisterPageProps {
  searchParams: Promise<{ from?: string }>;
}

export default async function RegisterPage({ searchParams }: RegisterPageProps) {
  const { from } = await searchParams;
  const safeFrom = from && from.startsWith("/") && !from.startsWith("//") ? from : null;

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
            className="inline-block font-[family-name:var(--font-display)] text-2xl text-gray-900 hover:opacity-80 transition-opacity"
          >
            Sakola Kembara
          </Link>
          <p className="text-sm text-gray-500 mt-1">
            Buat akun untuk mendaftar sebagai calon siswa.
          </p>
        </div>

        <div className="bg-white rounded-2xl shadow-lg p-8 space-y-6">
          <div>
            <h1 className="font-[family-name:var(--font-display)] text-xl text-gray-900 mb-1">
              Daftar akun baru
            </h1>
            <p className="text-sm text-gray-600">
              Data pendaftaran kamu akan tersimpan pada akun ini agar bisa
              dibuka kembali kapan saja.
            </p>
          </div>

          {authStatus.googleConfigured && (
            <>
              <form action={signInWithGoogle}>
                <GoogleButton />
              </form>
              <div className="relative">
                <div className="absolute inset-0 flex items-center">
                  <span className="w-full border-t border-gray-200" />
                </div>
                <div className="relative flex justify-center text-xs">
                  <span className="bg-white px-3 text-gray-400 uppercase tracking-wider">
                    atau daftar dengan email
                  </span>
                </div>
              </div>
            </>
          )}

          <RegisterForm from={safeFrom} />
        </div>

        <p className="text-center text-sm text-gray-600 mt-6">
          Sudah punya akun?{" "}
          <Link
            href={safeFrom ? `/login?from=${encodeURIComponent(safeFrom)}` : "/login"}
            className="text-primary-blue font-semibold hover:underline"
          >
            Masuk di sini
          </Link>
        </p>
      </div>
    </main>
  );
}
