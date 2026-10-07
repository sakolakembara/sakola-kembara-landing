import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Button, buttonVariants } from "@/components/ui/button";
import { Container } from "@/components/ui/container";
import { Eyebrow } from "@/components/ui/eyebrow";
import { Heading } from "@/components/ui/heading";
import { SectionHeader } from "@/components/ui/section-header";
import { Tag } from "@/components/ui/tag";

/**
 * Living catalog of the design-system components (SAKEM-031 D9). It renders
 * only when DESIGN_CATALOG=1, which previews set and production never does;
 * the env is read per request, so the page is dynamic.
 */
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Design system",
  robots: { index: false, follow: false },
};

function Block({ title, dark = false, children }: { title: string; dark?: boolean; children: React.ReactNode }) {
  return (
    <section className={dark ? "bg-gradient-to-br from-primary-blue to-accent-navy py-12 text-white" : "py-12"}>
      <Container>
        <h2 className={`mb-6 text-xs font-bold uppercase tracking-wider ${dark ? "text-white/70" : "text-gray-500"}`}>
          {title}
        </h2>
        {children}
      </Container>
    </section>
  );
}

const row = "flex flex-wrap items-center gap-4";

export default function DesignCatalog() {
  if (process.env.DESIGN_CATALOG !== "1") notFound();

  return (
    <main className="min-h-screen bg-white">
      <Container className="py-12">
        <Eyebrow>Design system</Eyebrow>
        <Heading level="page" className="mt-4 text-gray-900">
          Komponen Sakola Kembara
        </Heading>
        <p className="mt-4 max-w-[600px] text-gray-600">
          Katalog komponen di <code>components/ui/</code>. Aturan pemakaiannya ada di DESIGN.md.
        </p>
      </Container>

      <Block title="Button · size md (default)">
        <div className={row}>
          <Button>Daftar Sekarang</Button>
          <Button variant="outline">Lihat Detail</Button>
          <Button variant="subtle">Hubungi Kami</Button>
          <Button variant="neutral">Masuk</Button>
          <Button disabled>Mengirim…</Button>
        </div>
      </Block>

      <Block title="Button · sizes">
        <div className={row}>
          <Button size="sm" variant="neutral">Masuk (sm, header)</Button>
          <Button size="md">Lihat Detail (md)</Button>
          <Button size="lg">Kirim Pesan (lg)</Button>
        </div>
      </Block>

      <Block title="Button · links">
        <div className={row}>
          <Button href="/program/pembinaan" variant="outline">Lanjut ke Tahap 2</Button>
          <Button href="https://instagram.com/sakolakembara" variant="subtle">Instagram (tab baru)</Button>
          <Button href="/files/pitchdeck-sakola-kembara.pdf" download>Download PitchDeck</Button>
        </div>
      </Block>

      <Block title="Button · on navy" dark>
        <div className={row}>
          <Button variant="yellow-on-navy">Download PitchDeck</Button>
          <Button variant="outline-on-navy">Mengapa ini terjadi?</Button>
        </div>
      </Block>

      <Block title="Button style inside a card that is one link (buttonVariants on a span)">
        <a href="#" className="group block max-w-xs rounded-2xl border border-gray-100 p-6">
          <p className="mb-4 text-xl font-bold text-gray-900">Pembelajaran Intensif</p>
          <span className={buttonVariants({ fullWidth: true, className: "group-hover:bg-primary-blue-dark" })}>
            Lihat Detail
          </span>
        </a>
      </Block>

      <Block title="Heading levels">
        <div className="space-y-4 text-gray-900">
          <Heading level="display" as="p">display · Membuka Pintu Pendidikan Tinggi</Heading>
          <Heading level="page" as="p">page · Pahlawan di Balik Sakola Kembara</Heading>
          <Heading level="article" as="p">article · Judul artikel blog yang panjang</Heading>
          <Heading level="section" as="p">section · Pencapaian Sakola Kembara</Heading>
          <Heading level="subsection" as="p">subsection · Tim Pengurus</Heading>
          <Heading level="panel" as="p">panel · Cara Berdonasi</Heading>
          <Heading level="card" as="p">card · Roadshow &amp; Seleksi</Heading>
        </div>
      </Block>

      <Block title="Eyebrow + SectionHeader · light">
        <SectionHeader
          eyebrow="Program Kami"
          title="Apa saja yang dilalui penerima manfaat Sakola Kembara?"
          lead="Program pembinaan komprehensif dari penjangkauan siswa hingga pendampingan alumni."
        />
      </Block>

      <Block title="Eyebrow + SectionHeader · dark" dark>
        <SectionHeader tone="dark" eyebrow="Dampak Kami" title="Pencapaian Sakola Kembara" />
      </Block>

      <Block title="Tag">
        <div className={row}>
          <Tag>Pembinaan</Tag>
          <Tag size="sm">News</Tag>
          <Tag tone="soft">290+ jam belajar setahun</Tag>
        </div>
      </Block>

      <Block title="Container sizes">
        <div className="space-y-3">
          {(["page", "focused", "reading"] as const).map((size) => (
            <Container key={size} size={size} className="rounded-lg bg-gray-100 py-3 text-sm text-gray-600">
              {size}
            </Container>
          ))}
        </div>
      </Block>
    </main>
  );
}
