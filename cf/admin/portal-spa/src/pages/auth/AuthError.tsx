import { AuthShell } from "@shared/spa/AuthShell";
import { queryErrorMessage } from "@shared/spa/auth-errors";
import { useSearchParams } from "react-router";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { usePageTitle } from "~/lib/hooks";

/** Where Better Auth sends the browser when an OAuth step fails (`/portal/auth/error?error=<code>`). Only codes the SPA knows get their own line. */
export function AuthErrorPage() {
  usePageTitle("Gagal Masuk");
  const [params] = useSearchParams();
  return (
    <AuthShell title="Gagal masuk">
      <Alert>{queryErrorMessage(params.get("error"))}</Alert>
      <Button href="/login" size="lg" fullWidth>
        Kembali ke halaman masuk
      </Button>
    </AuthShell>
  );
}
