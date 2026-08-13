import type { Metadata } from "next";
import Link from "next/link";
import { ForgotForm } from "./_form";

export const metadata: Metadata = {
  title: "Lupa Password",
  robots: { index: false, follow: false },
};

export default function ForgotPasswordPage() {
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
        </div>

        <div className="bg-white rounded-2xl shadow-lg p-8 space-y-5">
          <div>
            <h1 className="font-[var(--font-display)] text-xl text-gray-900 mb-1">
              Lupa password?
            </h1>
            <p className="text-sm text-gray-600">
              Masukkan email akun kamu. Kami akan mengirim tautan untuk
              mengatur ulang password ke inbox tersebut.
            </p>
          </div>

          <ForgotForm />

          <p className="text-center text-xs text-gray-500 pt-2 border-t border-gray-100">
            Ingat lagi password kamu?{" "}
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
