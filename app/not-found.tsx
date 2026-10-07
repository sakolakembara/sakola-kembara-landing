import type { Metadata } from "next";
import PublicLayout from "./(public)/layout";
import { Button } from "@/components/ui/button";
import { Container } from "@/components/ui/container";
import { Eyebrow } from "@/components/ui/eyebrow";
import { Heading } from "@/components/ui/heading";

export const metadata: Metadata = {
  title: "Halaman tidak ditemukan",
};

/**
 * The site's 404 page: unknown program and blog slugs, shortlinks that don't
 * exist, and any other unknown URL. It lives at the root so that unmatched
 * URLs get it too, and wraps itself in the public layout because the root
 * not-found renders outside app/(public).
 *
 * Unmatched URLs get it rendered on the server. When a page calls notFound()
 * while rendering, Next still answers 404 but sends an empty shell and
 * renders this page in the browser from the flight data.
 */
export default function NotFound() {
  return (
    <PublicLayout>
      <NotFoundContent />
    </PublicLayout>
  );
}

/** The page body without the layout, for Storybook. */
export function NotFoundContent() {
  return (
    <main className="bg-gradient-to-b from-gray-50 to-white pt-[calc(var(--hero-top,8rem)_+_1.25rem)] pb-16 md:pt-[calc(var(--hero-top,8rem)_+_2.5rem)] md:pb-24">
      <Container size="reading" className="text-center">
        <Eyebrow className="mb-4">404</Eyebrow>
        <Heading level="page" className="mb-4 text-gray-900">
          Halaman tidak ditemukan
        </Heading>
        <p className="mx-auto mb-8 max-w-[600px] text-base text-gray-600 md:text-lg">
          Halaman yang Anda cari tidak ada atau sudah dipindahkan.
        </p>
        <div className="flex flex-wrap justify-center gap-4">
          <Button href="/">Kembali ke Beranda</Button>
          <Button href="/kontak" variant="outline">
            Hubungi Kami
          </Button>
        </div>
      </Container>
    </main>
  );
}
