import { LoaderCircle } from "lucide-react";
import type { ReactNode } from "react";
import { Navigate, Outlet, useLocation } from "react-router";
import { Alert } from "~/components/ui/alert";
import { Button } from "~/components/ui/button";
import { Heading } from "@/components/ui/heading";
import { accessTo, type Section } from "~/lib/access";
import { decideGuard } from "~/lib/guard";
import { useSubmitLock } from "~/lib/hooks";
import { SessionProvider, useMe, useSession } from "~/lib/session";
import { ForbiddenPage } from "../pages/Forbidden";

/**
 * Layout route for everything behind sign-in. It loads the session, and until
 * there is a signed-in admin it shows a status screen or redirects: anyone not
 * signed in goes to `/login` with the page they asked for in `from`.
 */
export function RequireAuth() {
  return (
    <SessionProvider>
      <AuthGate />
    </SessionProvider>
  );
}

function AuthGate() {
  const { state, reload, signOut } = useSession();
  const location = useLocation();
  const decision = decideGuard(state, location);

  switch (decision.kind) {
    case "loading":
      return (
        <div className="flex min-h-dvh items-center justify-center bg-gray-50">
          <p role="status" className="flex items-center gap-2 text-sm text-gray-500">
            <LoaderCircle size={18} aria-hidden="true" className="animate-spin text-primary-blue motion-reduce:animate-none" />
            Memuat…
          </p>
        </div>
      );
    case "error":
      return (
        <Centered title="Tidak dapat memuat akun">
          <Alert>Tidak dapat terhubung ke server. Periksa koneksi internet lalu coba lagi.</Alert>
          <Button onClick={reload} fullWidth>
            Coba lagi
          </Button>
        </Centered>
      );
    case "login":
      return <Navigate to={decision.to} replace />;
    case "no-admin-access":
      return <NoAdminAccess email={decision.me.email} onSignOut={signOut} />;
    case "allow":
      return <Outlet />;
  }
}

/** Layout route for one area of the menu: opens it, or shows the 403 page. */
export function RequireSection({ section }: { section: Section }) {
  const me = useMe();
  return accessTo(me, section) === "none" ? <ForbiddenPage /> : <Outlet />;
}

function Centered({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-gray-50 px-4 py-12">
      <div className="w-full max-w-md space-y-5 rounded-2xl bg-white p-8 shadow-lg">
        <Heading level="subsection" as="h1" className="text-gray-900">
          {title}
        </Heading>
        {children}
      </div>
    </main>
  );
}

/** Signed in, but the account is not an admin (a student, say). There is no menu to show. */
function NoAdminAccess({ email, onSignOut }: { email: string; onSignOut: () => Promise<boolean> }) {
  const { pending, run } = useSubmitLock();
  return (
    <Centered title="Akses ditolak">
      <Alert tone="warning">Halaman itu hanya untuk pengurus yayasan.</Alert>
      <p className="text-sm text-gray-600">
        Kamu masuk sebagai <span className="font-medium text-gray-900">{email}</span>. Masuk dengan akun pengurus untuk
        melanjutkan.
      </p>
      <Button variant="neutral" fullWidth disabled={pending} onClick={() => run(async () => void (await onSignOut()))}>
        Keluar
      </Button>
    </Centered>
  );
}
