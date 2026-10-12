import type { Metadata } from "next";
import { verifyEmailByToken } from "@/lib/account-service";
import { writeAudit } from "@/lib/audit";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { AuthShell } from "../_auth-shell";

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
      <Outcome
        tone="success"
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
    <Outcome
      tone="danger"
      headline="Tautan verifikasi tidak dapat diproses"
      body={messages[result.reason]}
      primaryLabel="Masuk"
      primaryHref="/login"
    />
  );
}

// The result of the link: the headline says what happened, the colored
// banner carries the details, and one button goes on.
function Outcome({
  tone,
  headline,
  body,
  primaryLabel,
  primaryHref,
}: {
  tone: "success" | "danger";
  headline: string;
  body: string;
  primaryLabel: string;
  primaryHref: string;
}) {
  return (
    <AuthShell title={headline}>
      <Alert tone={tone}>{body}</Alert>
      <Button href={primaryHref} size="lg" fullWidth>
        {primaryLabel}
      </Button>
    </AuthShell>
  );
}
