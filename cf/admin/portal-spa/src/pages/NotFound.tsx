import { Button } from "@/components/ui/button";
import { Container } from "@/components/ui/container";
import { Heading } from "@/components/ui/heading";
import { usePageTitle } from "~/lib/hooks";

/** 404, inside the shell. The assets layer answers 200 with this SPA for every path (the SPA fallback), so this is the only 404 there is. */
export function NotFoundPage() {
  usePageTitle("Halaman tidak ditemukan");
  return (
    <Container size="focused" className="px-4 py-16 md:px-6 md:py-24">
      <div className="mx-auto max-w-[560px] rounded-3xl border border-gray-100 bg-white p-8 text-center shadow-sm md:p-12">
        <Heading level="subsection" as="h1" className="mb-2 text-gray-900">
          Halaman tidak ditemukan
        </Heading>
        <p className="mb-6 leading-relaxed text-gray-600">Halaman yang dicari tidak ada atau sudah dipindahkan.</p>
        <Button href="/" variant="neutral">
          Kembali ke beranda portal
        </Button>
      </div>
    </Container>
  );
}
