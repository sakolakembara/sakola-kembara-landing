// Edge-runtime Sentry init (middleware, edge route handlers). Loaded via
// instrumentation.ts. No-op when SENTRY_DSN is unset.

import * as Sentry from "@sentry/nextjs";
import { env } from "@/lib/env";

if (env.SENTRY_DSN) {
  Sentry.init({
    dsn: env.SENTRY_DSN,
    environment: env.NODE_ENV,
    tracesSampleRate: env.NODE_ENV === "production" ? 0.1 : 0,
    sendDefaultPii: false,
  });
}
