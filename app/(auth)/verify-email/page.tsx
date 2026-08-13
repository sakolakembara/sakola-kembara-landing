import type { Metadata } from "next";
import Link from "next/link";
import { CheckCircle2, XCircle } from "lucide-react";
import { verifyEmailByToken } from "@/lib/account-service";
import { writeAudit } from "@/lib/audit";

export const metadata: Metadata = {
  title: "Verifikasi Email",
  robots: { index: false, follow: false },
};

// Server component redeems the token on load. Token is single-use in
// spirit (side effect is idempotent) but we still let repeat clicks
// succeed so refreshing the tab doesn't spook the user.

interface PageProps {
  searchParams: Promise<{ token?: string }>;
}

export default async function VerifyEmailPage({ searchParams }: PageProps) {
  const { token } = await searchParams;
  const result = await verifyEmailByToken(token);

  if (result.ok) {
    await writeAudit({
      actorEmail: "system",
      action: "user.email_verified",
    });
    return (
      <Shell
        icon={<CheckCircle2 size={40} className="text-secondary-green" />}
        eyebrow="Terverifikasi"
        headline="Email kamu berhasil diverifikasi"
        body="Akun kamu sekarang sudah aktif sepenuhnya. Kamu bisa langsung mengisi formulir pendaftaran dari portal siswa."
        primaryLabel="Ke Portal Siswa"
        primaryHref="/portal"
      />
    );
  }

  const messages: Record<Exclude<typeof result, { ok: true }>["reason"], string> = {
    invalid_token:
      "Tautan verifikasi tidak valid atau sudah kadaluarsa. Silakan kirim ulang dari halaman portal setelah masuk.",
    user_not_found:
      "Akun yang terkait tautan ini sudah tidak ada. Silakan daftar kembali.",
    email_changed:
      "Email kamu sudah berubah sejak tautan ini dibuat. Silakan kirim ulang tautan verifikasi dari portal.",
  };

  return (
    <Shell
      icon={<XCircle size={40} className="text-red-600" />}
      eyebrow="Gagal"
      headline="Tautan verifikasi tidak dapat diproses"
      body={messages[result.reason]}
      primaryLabel="Masuk"
      primaryHref="/login"
    />
  );
}

function Shell({
  icon,
  eyebrow,
  headline,
  body,
  primaryLabel,
  primaryHref,
}: {
  icon: React.ReactNode;
  eyebrow: string;
  headline: string;
  body: string;
  primaryLabel: string;
  primaryHref: string;
}) {
  return (
    <main className="min-h-screen flex items-center justify-center bg-gray-50 px-4 py-12">
      <div className="w-full max-w-md">
        <div className="bg-white rounded-2xl shadow-lg p-8 text-center">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-gray-50 mb-5">
            {icon}
          </div>
          <div className="inline-flex items-center gap-2 text-xs font-semibold text-primary-blue uppercase tracking-wider mb-3">
            <span className="w-2 h-2 bg-secondary-yellow rounded-full" />
            {eyebrow}
          </div>
          <h1 className="font-[var(--font-display)] text-2xl md:text-3xl text-gray-900 leading-tight mb-3">
            {headline}
          </h1>
          <p className="text-gray-600 leading-relaxed mb-6">{body}</p>
          <Link
            href={primaryHref}
            className="inline-flex items-center justify-center px-6 py-3 bg-primary-blue text-white font-semibold rounded-lg hover:bg-primary-blue-dark transition-colors"
          >
            {primaryLabel}
          </Link>
        </div>
      </div>
    </main>
  );
}
