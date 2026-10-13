import { api } from "@shared/spa/api";
import { TurnstileWidget } from "@shared/spa/TurnstileWidget";
import { useTurnstile } from "@shared/spa/turnstile";
import { useState } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { useSubmitLock } from "~/lib/hooks";
import { ENDPOINTS } from "~/lib/paths";
import { usePublicConfig } from "~/lib/public-config";
import { RESENT_MESSAGE, resendFailureMessage } from "~/lib/verification";

/**
 * "Kirim ulang tautan": a fresh verification email for `email` (`POST /portal/api/auth/send-verification-email`, behind
 * the security check, action `resend-verification`). Used after a registration, after a sign-in the Worker refused
 * because the address is not verified, and in the banner of an account that somehow is not. The Worker answers 200
 * for every address, so this says "sent" for every address too; `callbackURL` is where the link will land.
 */
export function ResendVerification({ email, callbackURL }: { email: string; callbackURL: string }) {
  const turnstile = useTurnstile("resend-verification", usePublicConfig().turnstileSiteKey);
  const { pending, run } = useSubmitLock();
  const [notice, setNotice] = useState<{ tone: "success" | "danger"; text: string } | null>(null);

  function resend() {
    // The button is disabled until the check has a token; this covers a call that does not come from it (a script).
    if (turnstile.blocked) return;
    void run(async () => {
      setNotice(null);
      const result = await api(ENDPOINTS.sendVerification, {
        method: "POST",
        json: { email, callbackURL },
        // Spent by this request whatever the answer (the panel stays open and may send again); take() starts the next challenge.
        turnstileToken: turnstile.take(),
      });
      setNotice(result.ok ? { tone: "success", text: RESENT_MESSAGE } : { tone: "danger", text: resendFailureMessage(result) });
    });
  }

  return (
    <div className="space-y-3" aria-busy={pending}>
      {notice && <Alert tone={notice.tone}>{notice.text}</Alert>}
      <TurnstileWidget turnstile={turnstile} />
      <Button type="button" variant="neutral" fullWidth disabled={pending || turnstile.blocked} onClick={resend}>
        {pending ? "Mengirim…" : turnstile.checking ? "Memeriksa…" : "Kirim ulang tautan"}
      </Button>
    </div>
  );
}
