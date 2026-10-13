import { Route, Routes } from "react-router";
import { PortalShell } from "./components/PortalShell";
import { RequireStudent } from "./components/RequireStudent";
import { AuthErrorPage } from "./pages/auth/AuthError";
import { ForgotPasswordPage } from "./pages/auth/ForgotPassword";
import { LoginPage } from "./pages/auth/Login";
import { RegisterPage } from "./pages/auth/Register";
import { ResetPasswordPage } from "./pages/auth/ResetPassword";
import { VerifyEmailPage } from "./pages/auth/VerifyEmail";
import { DaftarPlaceholderPage } from "./pages/DaftarPlaceholder";
import { HomePage } from "./pages/Home";
import { NotFoundPage } from "./pages/NotFound";
import { StatusPage } from "./pages/Status";

// The routes of the student portal. Paths are relative to the router's basename (/portal), so `/status` is
// <apex>/portal/status. docs/cloudflare/portal-architecture.md#51-layout-and-base-path lists them.

export function App() {
  return (
    <Routes>
      {/* Open to anyone. */}
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />
      <Route path="/verify-email" element={<VerifyEmailPage />} />
      <Route path="/auth/error" element={<AuthErrorPage />} />

      {/* Signed-in students only: not signed in goes to /login?from=<this page>; another kind of account gets the "not a student" screen. */}
      <Route element={<RequireStudent />}>
        <Route element={<PortalShell />}>
          <Route index element={<HomePage />} />
          <Route path="status" element={<StatusPage />} />
          {/* The wizard (P3) replaces this line with its own page. */}
          <Route path="daftar" element={<DaftarPlaceholderPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Route>
    </Routes>
  );
}
