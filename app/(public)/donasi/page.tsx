"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { Download, Copy, Check, QrCode, ClipboardCheck, Mail } from "lucide-react";
import Link from "next/link";
import { PageHero } from "@/components/layout/page-hero";
import { Button } from "@/components/ui/button";
import { Container } from "@/components/ui/container";
import { Heading } from "@/components/ui/heading";
import qrisImage from "@/public/images/qris-sakola-kembara.png";

const bankDetails = [
  { label: "Bank", value: "Bank Muamalat" },
  { label: "Kode Bank", value: "147", mono: true },
  { label: "Nomor Rekening", value: "1010 141 940", mono: true },
  { label: "Atas Nama", value: "Sakola Kembara Indonesia" },
];

const ACCOUNT_NUMBER = "1010141940";
/** Repo path, shown verbatim to admins when the QR file is missing. */
const QRIS_PUBLIC_PATH = "/images/qris-sakola-kembara.png";
/** Content-hashed URL — swapping the QR file busts every cache on its own. */
const QRIS_IMAGE = qrisImage.src;
const CONFIRMATION_FORM_URL =
  "https://docs.google.com/forms/d/e/1FAIpQLSe0wQUmreIspbu75JpHYpuHHYbgVi4FaROcfNTiTvgchCywdQ/viewform";

export default function DonasiPage() {
  const [copied, setCopied] = useState(false);
  const [qrUnavailable, setQrUnavailable] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(ACCOUNT_NUMBER);
    } catch {
      const textarea = document.createElement("textarea");
      textarea.value = ACCOUNT_NUMBER;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <>
      <main className="min-h-screen bg-gray-50">
        <PageHero
          title="Dukung Perjalanan Mereka"
          lead="Setiap donasi Anda membantu siswa dari keluarga kurang mampu untuk mewujudkan impian mereka masuk perguruan tinggi."
        />

        {/* Main Content */}
        <section className="py-16">
          <Container size="focused">
            {/* Heading */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.1 }}
              className="text-center mb-10"
            >
              <Heading level="panel" as="h2" className="text-gray-900 mb-3">
                Cara Berdonasi
              </Heading>
              <p className="text-gray-600 max-w-[600px] mx-auto">
                Pilih salah satu metode di bawah ini. Donasi dengan nominal berapa pun
                sangat berarti bagi mereka.
              </p>
            </motion.div>

            {/* Payment Methods */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.2 }}
              className="grid md:grid-cols-2 gap-6 mb-6"
            >
              {/* QRIS Card */}
              <div className="bg-white rounded-3xl p-8 shadow-lg flex flex-col">
                <Heading level="card" className="text-primary-blue text-center mb-6">
                  Scan QRIS
                </Heading>

                {qrUnavailable ? (
                  <div className="mx-auto mb-6 w-full max-w-[280px] aspect-[3/4] rounded-2xl border-2 border-dashed border-gray-300 bg-gray-50 flex flex-col items-center justify-center text-center px-6">
                    <QrCode size={56} className="text-gray-300 mb-3" />
                    <p className="text-sm text-gray-400">
                      Tambahkan file QRIS di
                      <br />
                      <span className="font-mono text-xs">public{QRIS_PUBLIC_PATH}</span>
                    </p>
                  </div>
                ) : (
                  <img
                    src={QRIS_IMAGE}
                    alt="QRIS Sakola Kembara"
                    width={280}
                    height={373}
                    loading="lazy"
                    decoding="async"
                    onError={() => setQrUnavailable(true)}
                    className="mx-auto mb-6 w-full max-w-[280px] aspect-[3/4] rounded-2xl"
                  />
                )}

                <p className="text-center text-gray-500 text-sm mb-6">
                  Scan via{" "}
                  <span className="font-semibold text-gray-700">
                    GoPay, OVO, DANA, ShopeePay
                  </span>
                  , atau m-banking.
                </p>

                <Button
                  href={QRIS_IMAGE}
                  download="qris-sakola-kembara.png"
                  variant="outline"
                  size="lg"
                  fullWidth
                  className="mt-auto"
                >
                  <Download size={18} />
                  Download QR
                </Button>
              </div>

              {/* Transfer Bank Card */}
              <div className="bg-white rounded-3xl p-8 shadow-lg flex flex-col">
                <Heading level="card" className="text-primary-blue text-center mb-6">
                  Transfer Bank
                </Heading>

                <div className="space-y-5 mb-6">
                  {bankDetails.map((detail) => (
                    <div key={detail.label}>
                      <div className="text-xs font-medium uppercase tracking-wider text-gray-500 mb-1">
                        {detail.label}
                      </div>
                      <div
                        className={`text-lg font-bold text-gray-900 ${
                          detail.mono ? "font-mono tracking-wide" : ""
                        }`}
                      >
                        {detail.value}
                      </div>
                    </div>
                  ))}
                </div>

                <Button
                  onClick={handleCopy}
                  variant="outline"
                  size="lg"
                  fullWidth
                  className={`mt-auto ${
                    copied ? "border-secondary-green text-secondary-green hover:bg-transparent" : ""
                  }`}
                >
                  {copied ? (
                    <>
                      <Check size={18} />
                      Tersalin!
                    </>
                  ) : (
                    <>
                      <Copy size={18} />
                      Salin No Rekening
                    </>
                  )}
                </Button>
              </div>
            </motion.div>

            {/* Next-step CTAs */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.3 }}
              className="grid md:grid-cols-2 gap-6"
            >
              {/* Confirmation */}
              <div className="bg-primary-blue/5 border border-primary-blue/20 rounded-3xl p-8 text-center flex flex-col items-center">
                <div className="w-12 h-12 bg-primary-blue/10 rounded-xl flex items-center justify-center mb-4">
                  <ClipboardCheck className="text-primary-blue" size={24} />
                </div>
                <Heading level="card" className="text-gray-900 mb-2">
                  Terima Kasih atas Donasi Anda
                </Heading>
                <p className="text-gray-600 text-sm mb-6 max-w-[360px]">
                  Setelah berdonasi, mohon konfirmasikan melalui formulir berikut agar
                  donasi Anda dapat kami catat dengan baik.
                </p>
                <Button href={CONFIRMATION_FORM_URL} size="lg" fullWidth className="mt-auto">
                  <ClipboardCheck size={18} />
                  Konfirmasi Donasi
                </Button>
              </div>

              {/* Kontak Kami — donation questions. The volunteer/partnership
                  pitch that used to sit here now lives on /tim, next to the
                  actual sign-up link. */}
              <div className="bg-gradient-to-br from-primary-blue to-accent-navy rounded-3xl p-8 text-center text-white flex flex-col items-center">
                <div className="w-12 h-12 bg-white/15 rounded-xl flex items-center justify-center mb-4">
                  <Mail className="text-white" size={24} />
                </div>
                <Heading level="card" className="mb-2">Kontak Kami</Heading>
                <p className="text-white/80 text-sm mb-6 max-w-[360px]">
                  Ada pertanyaan seputar donasi, penyaluran dana, atau laporan
                  penggunaannya? Tim kami siap membantu.
                </p>
                {/* No Button variant for a light button on navy yet; it is the only one. */}
                <Link
                  href="/kontak"
                  className="mt-auto w-full inline-flex items-center justify-center px-6 py-3.5 bg-gray-50 text-primary-blue font-semibold rounded-xl text-sm hover:bg-gray-100 transition-colors"
                >
                  Hubungi Kami
                </Link>
              </div>
            </motion.div>
          </Container>
        </section>

      </main>
    </>
  );
}
