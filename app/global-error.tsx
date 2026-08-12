"use client";

// Last-resort boundary for the root layout. Only fires when a route/segment
// boundary above (app/error.tsx or an area-level error.tsx) also fails, or
// when the crash happens outside any segment (e.g. in the root layout
// itself). Must render its own <html>/<body>.

import { useEffect } from "react";
import * as Sentry from "@sentry/nextjs";

interface Props {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function GlobalError({ error, reset }: Props) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="id">
      <body
        style={{
          minHeight: "100dvh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: "system-ui, -apple-system, sans-serif",
          background: "#f9fafb",
          margin: 0,
          padding: "1rem",
        }}
      >
        <div style={{ maxWidth: 480, textAlign: "center" }}>
          <h1 style={{ fontSize: "1.5rem", marginBottom: "0.5rem", color: "#111827" }}>
            Terjadi kesalahan tak terduga
          </h1>
          <p style={{ color: "#4b5563", marginBottom: "1.5rem" }}>
            Tim kami sudah dikabarkan otomatis. Silakan coba lagi atau kembali
            ke halaman utama.
          </p>
          {error.digest && (
            <p
              style={{
                fontSize: "0.75rem",
                color: "#9ca3af",
                fontFamily: "monospace",
                marginBottom: "1.5rem",
              }}
            >
              Kode: {error.digest}
            </p>
          )}
          <button
            type="button"
            onClick={reset}
            style={{
              padding: "0.625rem 1.25rem",
              background: "#122E76",
              color: "white",
              border: "none",
              borderRadius: "0.5rem",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Coba lagi
          </button>
        </div>
      </body>
    </html>
  );
}
