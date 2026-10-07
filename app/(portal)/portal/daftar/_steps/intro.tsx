"use client";

import Link from "next/link";
import {
  BookOpen,
  CheckCircle2,
  ClipboardList,
  Clock,
  MessageCircle,
  ShieldCheck,
} from "lucide-react";
import { StepHeader } from "./identity";
import { Alert } from "@/components/ui/alert";

const SECTIONS = [
  { label: "Identitas Pribadi", desc: "Data dasar, kontak, cabang" },
  { label: "Keluarga & Ekonomi", desc: "Orang tua, penghasilan, anggota keluarga" },
  { label: "Tempat Tinggal & Hutang", desc: "Status rumah, kendaraan, cicilan" },
  { label: "Organisasi", desc: "Pengalaman berorganisasi (opsional)" },
  { label: "Interview Tertulis", desc: "6 pertanyaan tentang motivasi & komitmen" },
  {
    label: "Pengumpulan Berkas",
    desc: "Link Google Drive per berkas pendaftaran + marketing",
  },
];

const NOTES = [
  "Pastikan orang tua/wali mengetahui dan mengizinkan kamu mengikuti seluruh kegiatan Sakola Kembara.",
  "Baca dengan teliti syarat dan alur pendaftaran sebelum mengisi formulir ini.",
  "Data yang kamu isi akan dijaga kerahasiaannya dan hanya digunakan untuk keperluan seleksi.",
];

export function IntroStep() {
  return (
    <div className="space-y-8">
      <StepHeader
        title="Sebelum Mulai Pendaftaran"
        subtitle="Halo! Selamat datang di pendaftaran Sakola Kembara Gen 6. Sebelum mengisi formulir, baca dulu informasi di bawah supaya proses pendaftaranmu lancar."
      />

      {/* Prominent Pusat Dokumen CTA */}
      <Link
        href="/gabung-siswa/docs"
        target="_blank"
        className="group block bg-gradient-to-br from-primary-blue to-accent-navy text-white rounded-2xl p-6 md:p-7 shadow-lg hover:shadow-xl transition-shadow"
      >
        <div className="flex items-start gap-4">
          <div className="shrink-0 w-12 h-12 rounded-xl bg-white/15 flex items-center justify-center">
            <BookOpen size={22} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1.5">
              <span className="text-[11px] font-bold uppercase tracking-wider bg-white/20 rounded-full px-2 py-0.5">
                Wajib dibuka
              </span>
            </div>
            <h3 className="font-[family-name:var(--font-display)] text-xl md:text-2xl mb-1.5 leading-tight">
              Buka Pusat Dokumen &amp; Berkas dulu
            </h3>
            <p className="text-sm md:text-base text-white/90 leading-relaxed mb-3">
              Sebelum mulai, unduh dulu template surat izin, surat penghasilan,
              poster, twibbon, dan caption Instagram. Siapkan semuanya dalam
              satu folder Google Drive supaya kamu tidak bolak-balik saat isi
              formulir.
            </p>
            <span className="inline-flex items-center gap-1.5 text-sm font-bold underline underline-offset-4 decoration-white/50 group-hover:decoration-white transition-colors">
              Buka Pusat Dokumen
            </span>
          </div>
        </div>
      </Link>

      {/* Catatan penting */}
      <section className="bg-amber-50 border border-amber-200 rounded-xl p-5">
        <div className="flex items-center gap-2 mb-3">
          <ShieldCheck size={18} className="text-amber-700" aria-hidden />
          <h3 className="text-sm font-bold text-amber-900 uppercase tracking-wide">
            Catatan Penting
          </h3>
        </div>
        <ul className="space-y-2">
          {NOTES.map((n) => (
            <li key={n} className="flex gap-2 text-sm text-amber-900 leading-relaxed">
              <CheckCircle2
                size={16}
                className="shrink-0 mt-0.5 text-amber-700"
                aria-hidden
              />
              <span>{n}</span>
            </li>
          ))}
        </ul>
      </section>

      {/* Sections preview */}
      <section>
        <div className="flex items-center gap-2 mb-3">
          <ClipboardList size={18} className="text-primary-blue" aria-hidden />
          <h3 className="text-sm font-bold text-gray-800 uppercase tracking-wide">
            Yang akan kamu isi
          </h3>
        </div>
        <ol className="grid sm:grid-cols-2 gap-2">
          {SECTIONS.map((s, i) => (
            <li
              key={s.label}
              className="flex items-start gap-3 rounded-xl border border-gray-200 bg-gray-50/60 p-3"
            >
              <span className="shrink-0 w-7 h-7 rounded-full bg-primary-blue/10 text-primary-blue text-xs font-bold flex items-center justify-center">
                {i + 1}
              </span>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-gray-900">{s.label}</p>
                <p className="text-xs text-gray-600 mt-0.5">{s.desc}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      {/* Meta info */}
      <section className="grid sm:grid-cols-2 gap-3">
        <div className="rounded-xl border border-gray-200 bg-white p-4 flex items-start gap-3">
          <Clock size={18} className="text-primary-blue shrink-0 mt-0.5" aria-hidden />
          <div>
            <p className="text-sm font-bold text-gray-900">Estimasi waktu</p>
            <p className="text-xs text-gray-600 mt-0.5 leading-relaxed">
              ~30 menit kalau semua berkas sudah siap. Progres kamu tersimpan
              otomatis di browser ini, jadi aman kalau harus lanjut nanti.
            </p>
          </div>
        </div>
        <a
          href="https://wa.me/6285660451753"
          target="_blank"
          rel="noopener noreferrer"
          className="rounded-xl border border-gray-200 bg-white p-4 flex items-start gap-3 hover:border-primary-blue/40 hover:bg-primary-blue/5 transition-colors"
        >
          <MessageCircle
            size={18}
            className="text-primary-blue shrink-0 mt-0.5"
            aria-hidden
          />
          <div>
            <p className="text-sm font-bold text-gray-900">Butuh bantuan?</p>
            <p className="text-xs text-gray-600 mt-0.5 leading-relaxed">
              Chat Kesiswaan Sakola Kembara di WhatsApp{" "}
              <span className="font-semibold text-primary-blue">
                +62 856-6045-1753
              </span>
              .
            </p>
          </div>
        </a>
      </section>

      <Alert tone="info">
        Klik <b>Selanjutnya</b> untuk mulai mengisi formulir. Kamu bisa
        kembali ke bagian ini kapan saja lewat menu sidebar.
      </Alert>
    </div>
  );
}
