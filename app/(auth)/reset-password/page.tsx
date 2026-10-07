import type { Metadata } from "next";
import Link from "next/link";
import { ResetForm } from "./_form";
import { Alert } from "@/components/ui/alert";

export const metadata: Metadata = {
  title: "Reset Password",
  robots: { index: false, follow: false },
};

interface PageProps {
  searchParams: Promise<{ token?: string }>;
}

export default async function ResetPasswordPage({ searchParams }: PageProps) {
  const { token } = await searchParams;

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
        </div>

        <div className="bg-white rounded-2xl shadow-lg p-8 space-y-5">
          <div>
            <h1 className="font-[family-name:var(--font-display)] text-xl text-gray-900 mb-1">
              Reset password
            </h1>
            <p className="text-sm text-gray-600">
              Pilih password baru. Setelah disimpan, kamu langsung masuk ke
              portal siswa.
            </p>
          </div>

          {token ? (
            <ResetForm token={token} />
          ) : (
            <Alert tone="warning">
              Tautan reset tidak lengkap. Silakan minta tautan baru di{" "}
              <Link href="/forgot-password" className="font-semibold underline">
                halaman lupa password
              </Link>
              .
            </Alert>
          )}

          <p className="text-center text-xs text-gray-500 pt-2 border-t border-gray-100">
            <Link
              href="/login"
              className="text-primary-blue font-semibold hover:underline"
            >
              Kembali ke halaman masuk
            </Link>
          </p>
        </div>
      </div>
    </main>
  );
}
