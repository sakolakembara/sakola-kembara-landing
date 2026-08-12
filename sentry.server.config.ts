// Server-side Sentry init. Loaded once at boot via instrumentation.ts.
// No-op when SENTRY_DSN is unset — lets dev machines run without needing
// an account.

import * as Sentry from "@sentry/nextjs";
import { env } from "@/lib/env";

if (env.SENTRY_DSN) {
  Sentry.init({
    dsn: env.SENTRY_DSN,
    environment: env.NODE_ENV,
    // Traces cost quota; keep the sample rate low until we know what we
    // need. Bump for a debug window when hunting a specific issue.
    tracesSampleRate: env.NODE_ENV === "production" ? 0.1 : 0,
    // Rich request context on server errors — useful for reproducing.
    sendDefaultPii: false,
  });
}
