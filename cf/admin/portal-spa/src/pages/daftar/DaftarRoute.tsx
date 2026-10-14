import { lazy, Suspense } from "react";
import { Container } from "@/components/ui/container";
import { LoadingBlock } from "~/components/LoadState";

// The wizard is its own chunk (docs/cloudflare/portal-architecture.md#53): the seven steps, the rules, the file field and
// the local copy are loaded only when a student opens /daftar, so the first load of the portal (the sign-in pages, the front
// page) does not carry them. This file is all of the wizard that is in the first load: a Suspense and a loading line.

/** One more try after a short pause: a phone on a weak connection often fails the first request for a file and not the second. */
export function importWithRetry<T>(load: () => Promise<T>): Promise<T> {
  return load().catch(() => new Promise<T>((resolve, reject) => setTimeout(() => load().then(resolve, reject), 800)));
}

const DaftarPage = lazy(() => importWithRetry(() => import("./DaftarPage")));

export function DaftarRoute() {
  return (
    <Suspense
      fallback={
        <Container size="focused" className="px-4 py-12 md:px-6 md:py-16">
          <LoadingBlock label="Memuat formulir pendaftaran…" />
        </Container>
      }
    >
      <DaftarPage />
    </Suspense>
  );
}
