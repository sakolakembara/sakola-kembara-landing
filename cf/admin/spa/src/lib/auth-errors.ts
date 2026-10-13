// Every failure the auth pages can meet, as Indonesian text: the shared file (cf/admin/shared/spa/auth-errors.ts, also
// used by the student portal's SPA) at its old path, plus the two `?error=` codes only the admin's sign-in page gets.
// Pure, like the shared file: the Worker's contract test imports it (test/spa-contract.test.ts).
import { queryErrorMessage as sharedQueryErrorMessage } from "../../../shared/spa/auth-errors";

export * from "../../../shared/spa/auth-errors";

// Legacy (app/(auth)/login/page.tsx)
const ADMIN_QUERY_ERRORS: Record<string, string> = {
  "admin-only": "Halaman itu hanya untuk pengurus yayasan.",
  domain: "Akun ini tidak diizinkan mengakses halaman tersebut.",
};

/** Text for `?error=` on `/login` and `/auth/error`; see the shared function. */
export function queryErrorMessage(code: string | null | undefined): string {
  return sharedQueryErrorMessage(code, ADMIN_QUERY_ERRORS);
}
