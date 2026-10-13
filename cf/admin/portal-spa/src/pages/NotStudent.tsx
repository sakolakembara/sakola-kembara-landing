import { Alert } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { Centered } from "~/components/Centered";
import { usePageTitle, useSubmitLock } from "~/lib/hooks";
import type { Me } from "~/lib/me";
import { usePublicConfig } from "~/lib/public-config";
import { useSession } from "~/lib/session";

/** The Worker's own line for `403 student_only` (docs/cloudflare/portal-api.md#13-error-codes). */
export const NOT_STUDENT_MESSAGE = "Halaman ini hanya untuk calon siswa. Pengurus yayasan masuk lewat halaman admin.";

/**
 * Shown, instead of the portal, to a signed-in account that is not a student: an admin account signs in on the apex
 * too, and every data route would answer it `403 student_only`. It says so, links to the admin's host when the
 * deployment knows it, and offers to sign out. Nothing of the portal is drawn and nothing is requested for it.
 */
export function NotStudentPage({ me }: { me: Me }) {
  usePageTitle("Bukan akun siswa");
  const { signOut } = useSession();
  const { adminUrl } = usePublicConfig();
  const { pending, run } = useSubmitLock();

  return (
    <Centered title="Akun ini bukan akun calon siswa">
      <Alert tone="warning">{NOT_STUDENT_MESSAGE}</Alert>
      <p className="text-sm text-gray-600">
        Kamu masuk sebagai <span className="font-medium text-gray-900">{me.email}</span>.
      </p>
      <div className="space-y-3">
        {adminUrl && (
          <a href={adminUrl} className={cn(buttonVariants({ size: "lg", fullWidth: true }))}>
            Buka halaman admin
          </a>
        )}
        <Button variant="neutral" fullWidth disabled={pending} onClick={() => run(async () => void (await signOut()))}>
          Keluar
        </Button>
      </div>
    </Centered>
  );
}
