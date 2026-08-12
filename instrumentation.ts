// Next.js runs this once per runtime at startup. We fan out to the
// runtime-specific Sentry config so we don't accidentally pull node-only
// APIs into the Edge bundle.

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config");
  }
  if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config");
  }
}

// Called by Next 15+ when an uncaught server error happens. Ensures the
// error reaches Sentry even when the app-level error boundary can't run
// (e.g. errors thrown in generateMetadata, streaming responses, etc.).
export { captureRequestError as onRequestError } from "@sentry/nextjs";
