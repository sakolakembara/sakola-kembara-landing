import type { ReactNode } from "react";
import { ErrorBoundary as SharedErrorBoundary } from "@shared/spa/ErrorBoundary";

// The crash screen is the shared one (cf/admin/shared/spa/ErrorBoundary.tsx, the admin's too) with the legacy portal's
// words (app/(portal)/error.tsx). The wizard's data is on the server by step, which is what the second sentence says.
const COPY = {
  title: "Portal siswa bermasalah",
  body: "Tenang, pendaftaran kamu tidak terhapus. Data tersimpan di server dan bisa dibuka lagi setelah halaman berhasil dimuat.",
  homeLabel: "Ke beranda",
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
