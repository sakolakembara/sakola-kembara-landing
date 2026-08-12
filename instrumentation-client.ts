// Client-side Sentry init. Next.js auto-loads instrumentation-client.ts
// on every route. No-op when NEXT_PUBLIC_SENTRY_DSN is unset — we intentionally
// keep the browser DSN separate from the server DSN so a rotate of one
// doesn't invalidate the other.

import * as Sentry from "@sentry/nextjs";

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV,
    tracesSampleRate: process.env.NODE_ENV === "production" ? 0.1 : 0,
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 0.1,
    sendDefaultPii: false,
  });
}

// Make sure client-side navigation errors get propagated through Sentry.
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
