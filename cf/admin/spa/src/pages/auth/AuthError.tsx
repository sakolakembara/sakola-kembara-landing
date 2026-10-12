import { useSearchParams } from "react-router";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { queryErrorMessage } from "~/lib/auth-errors";
import { usePageTitle } from "~/lib/hooks";
import { AuthShell } from "./AuthShell";

/** Where Better Auth sends the browser when an OAuth step fails (`onAPIError.errorURL`), with `?error=<code>`. */
export function AuthErrorPage() {
  usePageTitle("Gagal Masuk");
  const [params] = useSearchParams();
  return (
    <AuthShell title="Gagal masuk" subtitle="Masuk untuk mengelola konten Sakola Kembara.">
      <Alert>{queryErrorMessage(params.get("error"))}</Alert>
      <Button href="/login" size="lg" fullWidth>
        Kembali ke halaman masuk
      </Button>
    </AuthShell>
  );
}
