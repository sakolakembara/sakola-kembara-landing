import type { Metadata } from "next";
import Link from "next/link";
import { authStatus, signIn } from "@/auth";
import { AUTH_LINK, AuthDivider, AuthShell } from "../_auth-shell";
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
    <AuthShell
      title="Daftar akun baru"
      description="Data pendaftaran kamu akan tersimpan pada akun ini agar bisa dibuka kembali kapan saja."
      footer={
        <>
          Sudah punya akun?{" "}
          <Link
            href={safeFrom ? `/login?from=${encodeURIComponent(safeFrom)}` : "/login"}
            className={AUTH_LINK}
          >
            Masuk di sini
          </Link>
        </>
      }
    >
      <RegisterForm from={safeFrom} />

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
