import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { AuthShell } from "./AuthShell";

/** Where Better Auth sends the browser when an auth link or OAuth step fails (`onAPIError.errorURL`). */
export function AuthErrorPage() {
  return (
    <AuthShell title="Gagal masuk" subtitle="Masuk untuk mengelola konten Sakola Kembara.">
      <Alert>Gagal masuk. Silakan coba lagi.</Alert>
      <Button href="/login" size="lg" fullWidth>
        Kembali ke halaman masuk
      </Button>
    </AuthShell>
  );
}
