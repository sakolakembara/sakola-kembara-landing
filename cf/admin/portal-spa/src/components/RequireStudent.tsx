import { Navigate, Outlet, useLocation } from "react-router";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { decideGuard } from "~/lib/guard";
import { SessionProvider, useSession } from "~/lib/session";
import { NotStudentPage } from "../pages/NotStudent";
import { Centered } from "./Centered";

/**
 * Layout route for everything behind sign-in. It loads the session, and until there is a signed-in STUDENT it shows
 * a status screen or redirects: anyone not signed in goes to `/login` with the page they asked for in `from`, and an
 * account that is not a student (an admin's, which signs in on the apex too) gets the "not a student" screen, not a
 * single page of the portal and not a single data request (the pages below are never rendered).
 */
export function RequireStudent() {
  return (
    <SessionProvider>
      <AuthGate />
    </SessionProvider>
  );
}

function AuthGate() {
  const { state, reload } = useSession();
  const location = useLocation();
  const decision = decideGuard(state, location);

  switch (decision.kind) {
    case "loading":
      return (
        <div className="flex min-h-dvh items-center justify-center bg-gray-50">
          <p role="status" className="text-sm text-gray-500">
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
    case "not-student":
      return <NotStudentPage me={decision.me} />;
    case "allow":
      return <Outlet />;
  }
}
