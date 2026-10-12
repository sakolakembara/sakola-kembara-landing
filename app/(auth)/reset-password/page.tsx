import type { Metadata } from "next";
import Link from "next/link";
import { Alert } from "@/components/ui/alert";
import { AUTH_LINK, AuthShell } from "../_auth-shell";
import { ResetForm } from "./_form";

export const metadata: Metadata = {
  title: "Reset Password",
  robots: { index: false, follow: false },
};

interface PageProps {
  searchParams: Promise<{ token?: string }>;
}

export default async function ResetPasswordPage({ searchParams }: PageProps) {
  const { token } = await searchParams;

  const backToSignIn = (
    <Link href="/login" className={AUTH_LINK}>
      Kembali ke halaman masuk
    </Link>
  );

  // Without a token there is no form to give instructions for, so the page
  // is just the title and the warning.
  if (!token) {
    return (
      <AuthShell title="Reset password" footer={backToSignIn}>
        <Alert tone="warning">
          Tautan reset tidak lengkap. Silakan minta tautan baru di{" "}
          <Link href="/forgot-password" className="font-semibold underline">
            halaman lupa password
          </Link>
          .
        </Alert>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Reset password"
      description="Pilih password baru. Setelah disimpan, kamu langsung masuk ke portal siswa."
      footer={backToSignIn}
    >
      <ResetForm token={token} />
    </AuthShell>
  );
}
