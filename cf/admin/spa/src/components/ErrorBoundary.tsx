import type { ReactNode } from "react";
import { ErrorBoundary as SharedErrorBoundary } from "../../../shared/spa/ErrorBoundary";

// The crash screen is the shared one (cf/admin/shared/spa/ErrorBoundary.tsx, also used by the student portal's SPA);
// this keeps the admin's own words and the old import path.
const COPY = {
  title: "Gagal memuat halaman admin",
  body: "Terjadi kesalahan di browser. Coba lagi atau muat ulang halaman. Jika terus terjadi, hubungi tim teknis.",
  homeLabel: "Dashboard",
};

export function ErrorBoundary({
  children,
  resetKey,
  variant,
}: {
  children: ReactNode;
  /** Changing this (e.g. the pathname) clears a caught error, so leaving a broken page recovers. */
  resetKey?: string;
  /** "page" sits inside the shell; "app" covers the whole screen. */
  variant?: "page" | "app";
}) {
  return (
    <SharedErrorBoundary copy={COPY} resetKey={resetKey} variant={variant}>
      {children}
    </SharedErrorBoundary>
  );
}
