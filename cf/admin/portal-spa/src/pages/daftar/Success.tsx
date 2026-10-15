import { CheckCircle2, MessageCircle } from "lucide-react";
import { Link } from "react-router";
import { Container } from "@/components/ui/container";
import { Eyebrow } from "@/components/ui/eyebrow";
import { Heading } from "@/components/ui/heading";
import type { Submitted } from "~/lib/wizard/api";
import type { WizardConfig } from "~/lib/wizard/config";

/** After the application is sent: the legacy words (app/(portal)/portal/daftar/_success.tsx). The group invitation is shown when the deployment knows it (`whatsappGroupUrl`). */
export function SuccessScreen({ sent, config }: { sent: Submitted; config: WizardConfig }) {
  return (
    <div className="py-10 md:py-16">
      <Container size="reading" className="px-4 md:px-6">
        <div className="rounded-3xl border border-gray-100 bg-white p-8 text-center shadow-sm md:p-12">
          <div className="mx-auto mb-5 flex size-16 items-center justify-center rounded-full bg-secondary-green/10">
            <CheckCircle2 size={32} className="text-secondary-green" aria-hidden />
          </div>
          <Eyebrow className="mb-3">Terkirim</Eyebrow>
          <Heading level="article" tabIndex={-1} data-step-heading className="mb-3 text-gray-900 focus:outline-none">
            Pendaftaran kamu sudah kami terima
          </Heading>
          <p className="mx-auto mb-2 max-w-[520px] leading-relaxed text-gray-600">
            Terima kasih sudah mengisi formulir pendaftaran. Tim kesiswaan akan meninjau berkas kamu dan menghubungi lewat WhatsApp jika ada informasi lanjutan.
          </p>
          <p className="mb-8 mt-4 break-all font-mono text-xs text-gray-500">ID Pendaftaran: {sent.applicationId}</p>

          {config.whatsappGroupUrl !== "" && (
            <div className="mb-6 rounded-2xl border border-secondary-green/20 bg-secondary-green/5 p-6 text-left">
              <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-gray-900">
                <MessageCircle size={16} className="text-secondary-green" aria-hidden />
                Langkah selanjutnya
              </h2>
              <p className="mb-4 text-sm leading-relaxed text-gray-700">Gabung grup WhatsApp resmi peserta agar tidak ketinggalan pengumuman dari panitia.</p>
              <a
                href={config.whatsappGroupUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-secondary-green px-5 py-2.5 font-semibold text-white transition-colors hover:bg-green-700"
              >
                <MessageCircle size={16} aria-hidden />
                Gabung Grup WhatsApp
              </a>
            </div>
          )}

          <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-sm">
            <Link to="/status" className="inline-flex min-h-11 items-center font-semibold text-primary-blue hover:underline">
              Lihat status pendaftaran
            </Link>
            <span aria-hidden className="text-gray-300">
              ·
            </span>
            <Link to="/" className="inline-flex min-h-11 items-center text-gray-600 hover:text-gray-900">
              Kembali ke portal
            </Link>
          </div>
        </div>
      </Container>
    </div>
  );
}
