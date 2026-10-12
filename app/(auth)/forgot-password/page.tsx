import type { Metadata } from "next";
import Link from "next/link";
import { AUTH_LINK, AuthShell } from "../_auth-shell";
import { ForgotForm } from "./_form";

export const metadata: Metadata = {
  title: "Lupa Password",
  robots: { index: false, follow: false },
};

export default function ForgotPasswordPage() {
  return (
    <AuthShell
      title="Lupa password?"
      description="Masukkan email akun kamu. Kami akan mengirim tautan untuk mengatur ulang password ke inbox tersebut."
      footer={
        <>
          Ingat lagi password kamu?{" "}
          <Link href="/login" className={AUTH_LINK}>
            Kembali ke halaman masuk
          </Link>
        </>
      }
    >
      <ForgotForm />
    </AuthShell>
  );
}
