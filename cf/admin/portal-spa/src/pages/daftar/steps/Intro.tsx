import { BookOpen, CheckCircle2, ClipboardList, Clock, MessageCircle, ShieldCheck } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { contactHref, type WizardConfig } from "~/lib/wizard/config";
import { StepHeader } from "../form";

// Screen 1 of 8, "Sebelum Mulai" (legacy: _steps/intro.tsx). Two lines changed because a document is uploaded now and
// not linked from Google Drive: the description of the last section, and the end of the card about the document center.

const SECTIONS = [
  { label: "Identitas Pribadi", desc: "Data dasar, kontak, cabang" },
  { label: "Keluarga & Ekonomi", desc: "Orang tua, penghasilan, anggota keluarga" },
  { label: "Tempat Tinggal & Hutang", desc: "Status rumah, kendaraan, cicilan" },
  { label: "Organisasi", desc: "Pengalaman berorganisasi (opsional)" },
  { label: "Interview Tertulis", desc: "6 pertanyaan tentang motivasi & komitmen" },
  { label: "Pengumpulan Berkas", desc: "Unggah berkas pendaftaran + marketing" },
];

const NOTES = [
  "Pastikan orang tua/wali mengetahui dan mengizinkan kamu mengikuti seluruh kegiatan Sakola Kembara.",
  "Baca dengan teliti syarat dan alur pendaftaran sebelum mengisi formulir ini.",
  "Data yang kamu isi akan dijaga kerahasiaannya dan hanya digunakan untuk keperluan seleksi.",
];

export function IntroStep({ config }: { config: WizardConfig }) {
  const help =
    config.contactWhatsapp !== "" ? (
      <a
        href={contactHref(config.contactWhatsapp)}
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-start gap-3 rounded-xl border border-gray-200 bg-white p-4 transition-colors hover:border-primary-blue/40 hover:bg-primary-blue/5"
      >
        <HelpBody>
          Chat Kesiswaan Sakola Kembara di WhatsApp <span className="font-semibold text-primary-blue">+{config.contactWhatsapp}</span>.
        </HelpBody>
      </a>
    ) : (
      <a
        href={`${config.siteUrl}/kontak`}
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-start gap-3 rounded-xl border border-gray-200 bg-white p-4 transition-colors hover:border-primary-blue/40 hover:bg-primary-blue/5"
      >
        <HelpBody>Hubungi Kesiswaan Sakola Kembara lewat halaman Kontak.</HelpBody>
      </a>
    );

  return (
    <div className="space-y-8">
      <StepHeader
        title="Sebelum Mulai Pendaftaran"
        subtitle="Halo! Selamat datang di pendaftaran Sakola Kembara Gen 6. Sebelum mengisi formulir, baca dulu informasi di bawah supaya proses pendaftaranmu lancar."
      />

      {/* Prominent Pusat Dokumen CTA */}
      <a
        href={`${config.siteUrl}/gabung-siswa/docs`}
        target="_blank"
        rel="noopener noreferrer"
        className="group block rounded-2xl bg-gradient-to-br from-primary-blue to-accent-navy p-6 text-white shadow-lg transition-shadow hover:shadow-xl md:p-7"
      >
        <div className="flex items-start gap-4">
          <div className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-white/15">
            <BookOpen size={22} aria-hidden />
          </div>
          <div className="min-w-0 flex-1">
            <div className="mb-1.5 flex items-center gap-2">
              <span className="rounded-full bg-white/20 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wider">Wajib dibuka</span>
            </div>
            <h3 className="mb-1.5 font-[family-name:var(--font-display)] text-xl leading-tight md:text-2xl">Buka Pusat Dokumen &amp; Berkas dulu</h3>
            <p className="mb-3 text-sm leading-relaxed text-white/90 md:text-base">
              Sebelum mulai, unduh dulu template surat izin, surat penghasilan, poster, twibbon, dan caption Instagram. Siapkan semuanya dalam satu folder di HP atau komputermu supaya kamu
              tidak bolak-balik saat isi formulir.
            </p>
            <span className="inline-flex items-center gap-1.5 text-sm font-bold underline decoration-white/50 underline-offset-4 transition-colors group-hover:decoration-white">Buka Pusat Dokumen</span>
          </div>
        </div>
      </a>

      {/* Catatan penting */}
      <section className="rounded-xl border border-amber-200 bg-amber-50 p-5">
        <div className="mb-3 flex items-center gap-2">
          <ShieldCheck size={18} className="text-amber-700" aria-hidden />
          <h3 className="text-sm font-bold uppercase tracking-wide text-amber-900">Catatan Penting</h3>
        </div>
        <ul className="space-y-2">
          {NOTES.map((note) => (
            <li key={note} className="flex gap-2 text-sm leading-relaxed text-amber-900">
              <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-amber-700" aria-hidden />
              <span>{note}</span>
            </li>
          ))}
        </ul>
      </section>

      {/* Sections preview */}
      <section>
        <div className="mb-3 flex items-center gap-2">
          <ClipboardList size={18} className="text-primary-blue" aria-hidden />
          <h3 className="text-sm font-bold uppercase tracking-wide text-gray-800">Yang akan kamu isi</h3>
        </div>
        <ol className="grid gap-2 sm:grid-cols-2">
          {SECTIONS.map((section, i) => (
            <li key={section.label} className="flex items-start gap-3 rounded-xl border border-gray-200 bg-gray-50/60 p-3">
              <span aria-hidden className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary-blue/10 text-xs font-bold text-primary-blue">
                {i + 1}
              </span>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-gray-900">{section.label}</p>
                <p className="mt-0.5 text-xs text-gray-600">{section.desc}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      {/* Meta info */}
      <section className="grid gap-3 sm:grid-cols-2">
        <div className="flex items-start gap-3 rounded-xl border border-gray-200 bg-white p-4">
          <Clock size={18} className="mt-0.5 shrink-0 text-primary-blue" aria-hidden />
          <div>
            <p className="text-sm font-bold text-gray-900">Estimasi waktu</p>
            <p className="mt-0.5 text-xs leading-relaxed text-gray-600">
              ~30 menit kalau semua berkas sudah siap. Progres kamu tersimpan otomatis di browser ini, jadi aman kalau harus lanjut nanti. Setiap bagian yang lengkap juga disimpan ke server saat kamu
              menekan Selanjutnya, jadi bisa dilanjutkan dari perangkat lain.
            </p>
          </div>
        </div>
        {help}
      </section>

      <Alert tone="info">
        Klik <b>Selanjutnya</b> untuk mulai mengisi formulir. Kamu bisa kembali ke bagian ini kapan saja lewat menu sidebar.
      </Alert>
    </div>
  );
}

function HelpBody({ children }: { children: React.ReactNode }) {
  return (
    <>
      <MessageCircle size={18} className="mt-0.5 shrink-0 text-primary-blue" aria-hidden />
      <div>
        <p className="text-sm font-bold text-gray-900">Butuh bantuan?</p>
        <p className="mt-0.5 text-xs leading-relaxed text-gray-600">{children}</p>
      </div>
    </>
  );
}
