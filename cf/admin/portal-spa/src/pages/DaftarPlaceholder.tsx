import { Button } from "@/components/ui/button";
import { Container } from "@/components/ui/container";
import { Heading } from "@/components/ui/heading";
import { usePageTitle } from "~/lib/hooks";

/**
 * `/daftar` until the wizard exists: the home page's "Mulai daftar" and the public site's "Daftar Sekarang" already
 * point here, so the route has to answer. It says so plainly and shows nothing else. The wizard task (P3) replaces
 * the one line of App.tsx that mounts this with its own page, in src/pages/daftar/, and deletes this file.
 */
export function DaftarPlaceholderPage() {
  usePageTitle("Formulir Pendaftaran");
  return (
    <Container size="focused" className="px-4 py-16 md:px-6 md:py-24">
      <div className="mx-auto max-w-[560px] rounded-3xl border border-gray-100 bg-white p-8 text-center shadow-sm md:p-12">
        <Heading level="subsection" as="h1" className="mb-2 text-gray-900">
          Belum tersedia
        </Heading>
        <p className="mb-6 leading-relaxed text-gray-600">Formulir pendaftaran masih dalam proses dipindahkan ke portal baru. Belum ada yang bisa diisi di sini.</p>
        <Button href="/" variant="neutral">
          Kembali ke beranda portal
        </Button>
      </div>
    </Container>
  );
}
