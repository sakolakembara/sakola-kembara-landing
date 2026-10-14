import { AuthShell } from "@shared/spa/AuthShell";
import { verifyOutcome } from "@shared/spa/auth-errors";
import { useSearchParams } from "react-router";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { usePageTitle } from "~/lib/hooks";

/**
 * Result of an email-verification link. The link in the email points at Better Auth, which verifies and then
 * redirects here with `?status=success` or `?error=<CODE>` (the callback URL is `VERIFY_CALLBACK` in lib/paths.ts),
 * so this page only reports; it calls nothing. Verifying does not sign anyone in: the way on is "Masuk". The words
 * are the legacy page's (app/(auth)/verify-email/page.tsx), in the login layout.
 */
export function VerifyEmailPage() {
  usePageTitle("Verifikasi Email");
  const [params] = useSearchParams();
  const outcome = verifyOutcome({ status: params.get("status"), error: params.get("error") });

  return (
    <AuthShell title={outcome.headline}>
      <Alert tone={outcome.ok ? "success" : "danger"}>{outcome.body}</Alert>
      <Button href="/login" size="lg" fullWidth>
        Masuk
      </Button>
    </AuthShell>
  );
}
