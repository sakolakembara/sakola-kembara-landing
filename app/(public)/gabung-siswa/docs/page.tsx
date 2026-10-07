import type { Metadata } from "next";
import Link from "next/link";
import {
  Download,
  ExternalLink,
  FileText,
  Link as LinkIcon,
  Type,
} from "lucide-react";
import { getResourcesByCategory } from "@/lib/site-resources";
import {
  RESOURCE_CATEGORY_DESCRIPTION,
  RESOURCE_CATEGORY_LABEL,
  RESOURCE_CATEGORY_ORDER,
} from "@/lib/site-resources-config";
import { Button } from "@/components/ui/button";
import { Container } from "@/components/ui/container";
import { Heading } from "@/components/ui/heading";
import type { SiteResource } from "@/lib/db/schema";
import { formatBytes } from "@/lib/report-types";
import { buildPageMetadata } from "@/lib/seo";
import { CopyButton } from "./_copy-button";

// Reads the DB, which is only reachable at runtime (on the VPS), not during
// the CI build. Render per-request instead of prerendering.
export const dynamic = "force-dynamic";

export const metadata: Metadata = buildPageMetadata({
  title: "Pusat Dokumen & Berkas",
  description:
    "Panduan pendaftaran, template berkas, dan bahan marketing yang perlu disiapkan calon siswa Sakola Kembara.",
  path: "/gabung-siswa/docs",
});

export default async function DocsPage() {
  const groups = await getResourcesByCategory();
  const hasAnything = groups.length > 0;

  return (
    <main className="min-h-screen bg-gray-50">
      {/* Hero */}
      <section className="bg-gradient-to-br from-primary-blue to-accent-navy text-white pb-12 md:pb-16 pt-[var(--hero-top,8rem)]">
        <Container>
          <Link
            href="/gabung-siswa"
            className="inline-block text-sm text-white/80 hover:text-white transition-colors mb-4"
          >
            Kembali ke halaman informasi
          </Link>
          <Heading level="page" className="mb-4">
            Pusat Dokumen &amp; Berkas
          </Heading>
          <p className="text-base md:text-lg text-white/90 max-w-[600px]">
            Semua panduan, template berkas, poster, twibbon, dan bahan lain yang
            perlu kamu siapkan selama proses pendaftaran ada di sini. Kalau kamu
            baru mulai mendaftar, buka{" "}
            <Link
              href="/portal/daftar"
              className="underline font-semibold hover:text-white"
            >
              formulir pendaftaran
            </Link>{" "}
            di tab lain agar bisa lihat berkas + isi formulir bersamaan.
          </p>
        </Container>
      </section>

      {/* Table of contents */}
      {hasAnything && (
        <section className="py-8 bg-white border-b border-gray-100">
          <Container>
            <nav
              aria-label="Kategori dokumen"
              className="flex flex-wrap gap-2"
            >
              {RESOURCE_CATEGORY_ORDER.filter((c) =>
                groups.some((g) => g.category === c),
              ).map((cat) => (
                <a
                  key={cat}
                  href={`#${cat}`}
                  className="inline-flex items-center px-3 py-1.5 text-xs font-semibold rounded-full border border-gray-200 hover:border-primary-blue hover:text-primary-blue transition-colors text-gray-700"
                >
                  {RESOURCE_CATEGORY_LABEL[cat]}
                </a>
              ))}
            </nav>
          </Container>
        </section>
      )}

      {/* Content */}
      <section className="py-14 md:py-16">
        <Container>
          {!hasAnything && (
            <div className="bg-white border border-gray-200 rounded-2xl p-12 text-center">
              <FileText size={32} className="mx-auto text-gray-300 mb-4" />
              <Heading level="card" as="h2" className="text-gray-900 mb-2">
                Dokumen akan segera tersedia
              </Heading>
              <p className="text-gray-600 max-w-md mx-auto">
                Tim kami sedang menyiapkan bahan-bahan pendaftaran. Silakan cek
                kembali halaman ini dalam beberapa waktu ke depan.
              </p>
            </div>
          )}

          <div className="space-y-14">
            {groups.map(({ category, items }) => (
              <section
                key={category}
                id={category}
                className="scroll-mt-24"
                aria-labelledby={`heading-${category}`}
              >
                <header className="mb-5">
                  <Heading
                    level="subsection"
                    id={`heading-${category}`}
                    className="text-gray-900"
                  >
                    {RESOURCE_CATEGORY_LABEL[category]}
                  </Heading>
                  <p className="text-sm md:text-base text-gray-600 mt-1 max-w-[760px]">
                    {RESOURCE_CATEGORY_DESCRIPTION[category]}
                  </p>
                </header>
                <div className="grid gap-4">
                  {items.map((item) => (
                    <ResourceCard key={item.id} item={item} />
                  ))}
                </div>
              </section>
            ))}
          </div>
        </Container>
      </section>
    </main>
  );
}

function ResourceCard({ item }: { item: SiteResource }) {
  return (
    <article className="bg-white rounded-2xl border border-gray-100 p-6 hover:shadow-md transition-shadow">
      <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-xs text-gray-500 mb-2 font-medium">
            {item.contentType === "file" ? (
              <>
                <FileText size={12} />
                <span>
                  File{item.fileSize ? ` · ${formatBytes(item.fileSize)}` : ""}
                </span>
              </>
            ) : item.contentType === "url" ? (
              <>
                <LinkIcon size={12} />
                <span>Link eksternal</span>
              </>
            ) : (
              <>
                <Type size={12} />
                <span>Teks · siap disalin</span>
              </>
            )}
          </div>
          <h3 className="text-lg font-bold text-gray-900 leading-snug">
            {item.title}
          </h3>
          {item.description && (
            <p className="text-sm text-gray-600 mt-1.5 leading-relaxed">
              {item.description}
            </p>
          )}
        </div>
        {item.contentType === "file" && item.filePath && (
          <Button
            href={item.filePath}
            target="_blank"
            rel="noopener noreferrer"
            download
            className="shrink-0"
          >
            <Download size={16} /> Unduh
          </Button>
        )}
        {item.contentType === "url" && item.externalUrl && (
          <Button href={item.externalUrl} className="shrink-0">
            <ExternalLink size={16} /> Buka
          </Button>
        )}
      </div>
      {item.contentType === "text" && item.bodyText && (
        <div className="mt-4">
          <div className="flex items-center justify-end mb-2">
            <CopyButton text={item.bodyText} />
          </div>
          <pre className="whitespace-pre-wrap break-words text-sm text-gray-800 bg-gray-50 border border-gray-200 rounded-lg p-4 leading-relaxed font-mono">
            {item.bodyText}
          </pre>
        </div>
      )}
    </article>
  );
}
