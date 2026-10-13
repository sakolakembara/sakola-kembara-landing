import { MailCheck } from "lucide-react";
import { REGISTER_CALLBACK } from "~/lib/paths";
import { ResendVerification } from "./ResendVerification";

/**
 * The legacy banner (app/(portal)/portal/_verify-email-banner.tsx) for a signed-in account whose email is not
 * verified. The Worker does not let an unverified student sign in, so this is defence in depth: it only shows when
 * `GET /portal/api/me` says `emailVerified: false` anyway, and gives the way out.
 */
export function VerifyEmailBanner({ email }: { email: string }) {
  return (
    <section
      aria-labelledby="verify-banner-title"
      className="relative overflow-hidden rounded-2xl border border-warning-border bg-warning-bg px-4 py-3 md:px-6 md:py-4"
    >
      <div className="flex items-start gap-3">
        <MailCheck className="mt-0.5 shrink-0 text-amber-600" size={20} aria-hidden />
        <div className="min-w-0 flex-1 space-y-3">
          <div>
            <p id="verify-banner-title" className="text-sm font-semibold text-amber-900">
              Verifikasi email kamu untuk mengaktifkan seluruh fitur
            </p>
            <p className="mt-0.5 text-xs text-amber-800/90">
              Cek inbox <span className="break-all font-mono">{email}</span>. Tautan verifikasi berlaku 24 jam.
            </p>
          </div>
          <ResendVerification email={email} callbackURL={REGISTER_CALLBACK} />
        </div>
      </div>
    </section>
  );
}
