"use client";

import Link from "next/link";
import { ArrowRight, CheckCircle2, MessageCircle } from "lucide-react";

const WHATSAPP_GROUP_URL = "https://chat.whatsapp.com/JUt4yzFtUQW5ttFVmF9iY6";

export function SuccessScreen({ applicationId }: { applicationId: string }) {
  return (
    <div className="py-10 md:py-16">
      <div className="max-w-[720px] mx-auto px-4 md:px-6">
        <div className="bg-white rounded-3xl border border-gray-100 p-8 md:p-12 text-center shadow-sm">
          <div className="w-16 h-16 mx-auto mb-5 rounded-full bg-secondary-green/10 flex items-center justify-center">
            <CheckCircle2 size={32} className="text-secondary-green" />
          </div>
          <div className="inline-flex items-center gap-2 text-xs font-semibold text-primary-blue uppercase tracking-wider mb-3">
            <span className="w-2 h-2 bg-secondary-yellow rounded-full" />
            Terkirim
          </div>
          <h1 className="font-[var(--font-display)] text-3xl md:text-4xl text-gray-900 mb-3 leading-tight">
            Pendaftaran kamu sudah kami terima
          </h1>
          <p className="text-gray-600 leading-relaxed mb-2 max-w-[520px] mx-auto">
            Terima kasih sudah mengisi formulir pendaftaran. Tim kesiswaan akan
            meninjau berkas kamu dan menghubungi lewat WhatsApp jika ada
            informasi lanjutan.
          </p>
          <p className="text-xs text-gray-400 font-mono mt-4 mb-8 break-all">
            ID Pendaftaran: {applicationId}
          </p>

          <div className="bg-secondary-green/5 border border-secondary-green/20 rounded-2xl p-6 text-left mb-6">
            <h2 className="text-sm font-semibold text-gray-900 uppercase tracking-wider mb-2 flex items-center gap-2">
              <MessageCircle size={16} className="text-secondary-green" />
              Langkah selanjutnya
            </h2>
            <p className="text-sm text-gray-700 leading-relaxed mb-4">
              Gabung grup WhatsApp resmi peserta agar tidak ketinggalan
              pengumuman dari panitia.
            </p>
            <a
              href={WHATSAPP_GROUP_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-secondary-green text-white font-semibold rounded-lg hover:bg-green-700 transition-colors"
            >
              <MessageCircle size={16} />
              Gabung Grup WhatsApp
            </a>
          </div>

          <div className="flex flex-wrap items-center justify-center gap-4 text-sm">
            <Link
              href="/portal/status"
              className="inline-flex items-center gap-1.5 text-primary-blue font-semibold hover:underline"
            >
              Lihat status pendaftaran <ArrowRight size={14} />
            </Link>
            <span className="text-gray-300">·</span>
            <Link href="/portal" className="text-gray-600 hover:text-gray-900">
              Kembali ke portal
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
