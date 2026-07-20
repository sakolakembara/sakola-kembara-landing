import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowLeft,
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
      <section className="bg-gradient-to-br from-primary-blue to-accent-navy text-white pb-16 pt-[var(--hero-top,8rem)]">
        <div className="max-w-[1100px] mx-auto px-6">
          <Link
            href="/gabung-siswa"
            className="inline-flex items-center gap-1.5 text-sm text-white/80 hover:text-white transition-colors mb-4"
          >
            <ArrowLeft size={14} /> Kembali ke halaman informasi
          </Link>
          <h1 className="font-[var(--font-display)] text-4xl md:text-5xl mb-4">
            Pusat Dokumen &amp; Berkas
          </h1>
          <p className="text-lg text-white/90 max-w-[700px]">
            Semua panduan, template berkas, poster, twibbon, dan bahan lain yang
            perlu kamu siapkan selama proses pendaftaran ada di sini. Kalau kamu
            baru mulai mendaftar, buka{" "}
            <Link
              href="/gabung-siswa/form"
              className="underline font-semibold hover:text-white"
            >
              formulir pendaftaran
            </Link>{" "}
            di tab lain agar bisa lihat berkas + isi formulir bersamaan.
          </p>
        </div>
      </section>

      {/* Table of contents */}
      {hasAnything && (
        <section className="py-8 bg-white border-b border-gray-100">
          <div className="max-w-[1100px] mx-auto px-6">
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
          </div>
        </section>
      )}

      {/* Content */}
      <section className="py-14 md:py-16">
        <div className="max-w-[1100px] mx-auto px-6">
          {!hasAnything && (
            <div className="bg-white border border-gray-200 rounded-2xl p-12 text-center">
              <FileText size={32} className="mx-auto text-gray-300 mb-4" />
              <h2 className="text-xl font-bold text-gray-900 mb-2">
                Dokumen akan segera tersedia
              </h2>
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
                  <h2
                    id={`heading-${category}`}
                    className="font-[var(--font-display)] text-2xl md:text-3xl text-gray-900"
                  >
                    {RESOURCE_CATEGORY_LABEL[category]}
                  </h2>
                  <p className="text-sm md:text-base text-gray-600 mt-1 max-w-[720px]">
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
        </div>
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
          <a
            href={item.filePath}
            target="_blank"
            rel="noopener noreferrer"
            download
            className="inline-flex items-center gap-2 px-4 py-2 bg-primary-blue text-white text-sm font-semibold rounded-lg hover:bg-primary-blue-dark transition-colors shrink-0"
          >
            <Download size={14} /> Unduh
          </a>
        )}
        {item.contentType === "url" && item.externalUrl && (
          <a
            href={item.externalUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 px-4 py-2 bg-primary-blue text-white text-sm font-semibold rounded-lg hover:bg-primary-blue-dark transition-colors shrink-0"
          >
            <ExternalLink size={14} /> Buka
          </a>
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
