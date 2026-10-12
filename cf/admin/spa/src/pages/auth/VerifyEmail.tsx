import { CheckCircle2, XCircle } from "lucide-react";
import { useSearchParams } from "react-router";
import { Button } from "@/components/ui/button";
import { Eyebrow } from "@/components/ui/eyebrow";
import { verifyOutcome } from "~/lib/auth-errors";
import { usePageTitle } from "~/lib/hooks";

/**
 * Result of an email-verification link. The link in the email points at Better
 * Auth, which verifies and then redirects here with `?status=success` or
 * `?error=<CODE>`, so this page only reports; it calls nothing. Layout and
 * copy follow the legacy page (app/(auth)/verify-email/page.tsx).
 */
export function VerifyEmailPage() {
  usePageTitle("Verifikasi Email");
  const [params] = useSearchParams();
  const outcome = verifyOutcome({ status: params.get("status"), error: params.get("error") });

  return (
    <main className="min-h-screen flex items-center justify-center bg-gray-50 px-4 py-12">
      <div className="w-full max-w-md">
        <div className="bg-white rounded-2xl shadow-lg p-8 text-center">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-gray-50 mb-5">
            {outcome.ok ? (
              <CheckCircle2 size={40} className="text-secondary-green" aria-hidden="true" />
            ) : (
              <XCircle size={40} className="text-red-600" aria-hidden="true" />
            )}
          </div>
          <Eyebrow className="mb-3">{outcome.ok ? "Terverifikasi" : "Gagal"}</Eyebrow>
          <h1 className="font-[family-name:var(--font-display)] text-2xl md:text-3xl text-gray-900 leading-tight mb-3">
            {outcome.headline}
          </h1>
          <p role={outcome.ok ? "status" : "alert"} className="text-gray-600 leading-relaxed mb-6">
            {outcome.body}
          </p>
          <Button href="/login">Masuk</Button>
        </div>
      </div>
    </main>
  );
}
