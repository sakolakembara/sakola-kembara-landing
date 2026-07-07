"use client";

import Link from "next/link";
import { CheckCircle2, MessageCircle } from "lucide-react";

const WHATSAPP_GROUP_URL = "https://chat.whatsapp.com/JUt4yzFtUQW5ttFVmF9iY6";

export function SuccessScreen({ applicationId }: { applicationId: string }) {
  return (
    <div className="min-h-screen bg-gray-50 pt-[var(--hero-top,8rem)] pb-16">
      <div className="max-w-[720px] mx-auto px-6">
        <div className="bg-white rounded-2xl border border-gray-100 p-8 md:p-10 text-center">
          <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-emerald-100 flex items-center justify-center">
            <CheckCircle2 size={32} className="text-emerald-600" />
          </div>
          <h1 className="font-[var(--font-display)] text-3xl md:text-4xl text-gray-900 mb-3">
            Pendaftaran Terkirim!
          </h1>
          <p className="text-gray-600 leading-relaxed mb-2">
            Terima kasih sudah mengisi formulir pendaftaran Sakola Kembara
            Gen 6. Tim kesiswaan akan meninjau berkas kamu dan menghubungi
            melalui WhatsApp jika ada informasi lanjutan.
          </p>
          <p className="text-xs text-gray-400 font-mono mb-8 break-all">
            ID: {applicationId}
          </p>

          <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-5 text-left mb-6">
            <h2 className="font-bold text-emerald-900 mb-2 flex items-center gap-2">
              <MessageCircle size={18} />
              Langkah Selanjutnya
            </h2>
            <p className="text-sm text-emerald-900 leading-relaxed mb-3">
              Jangan sampai ketinggalan info berikutnya! Bergabung ke grup
              WhatsApp resmi peserta Gen 6:
            </p>
            <a
              href={WHATSAPP_GROUP_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold rounded-lg transition-colors"
            >
              <MessageCircle size={16} />
              Gabung Grup WhatsApp
            </a>
          </div>

          <Link
            href="/"
            className="text-sm text-primary-blue hover:underline"
          >
            Kembali ke Beranda
          </Link>
        </div>
      </div>
    </div>
  );
}
