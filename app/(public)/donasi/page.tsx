"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { Download, Copy, Check, QrCode, ClipboardCheck, Users } from "lucide-react";
import Link from "next/link";
import StakeholderSection from "@/components/sections/StakeholderSection";

const bankDetails = [
  { label: "Bank", value: "Bank Muamalat" },
  { label: "Kode Bank", value: "147", mono: true },
  { label: "Nomor Rekening", value: "1010 141 940", mono: true },
  { label: "Atas Nama", value: "Sakola Kembara Indonesia" },
];

const ACCOUNT_NUMBER = "1010141940";
const QRIS_IMAGE = "/images/qris-sakola-kembara.png";
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
        {/* Hero Section */}
        <section className="bg-gradient-to-br from-primary-blue to-accent-navy text-white pt-32 pb-20">
          <div className="max-w-[1200px] mx-auto px-6">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6 }}
            >
              <h1 className="font-[var(--font-display)] text-4xl md:text-5xl lg:text-6xl mb-4">
                Dukung Perjalanan Mereka
              </h1>
              <p className="text-lg md:text-xl text-white/90 max-w-[600px]">
                Setiap donasi Anda membantu siswa dari keluarga kurang mampu untuk
                mewujudkan impian mereka masuk perguruan tinggi.
              </p>
            </motion.div>
          </div>
        </section>

        {/* Main Content */}
        <section className="py-16">
          <div className="max-w-[1000px] mx-auto px-6">
            {/* Heading */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.1 }}
              className="text-center mb-10"
            >
              <h2 className="text-2xl md:text-3xl font-bold text-gray-900 mb-3">
                Cara Berdonasi
              </h2>
              <p className="text-gray-600 max-w-[560px] mx-auto">
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
                <h3 className="text-xl font-bold text-primary-blue text-center mb-6">
                  Scan QRIS
                </h3>

                {qrUnavailable ? (
                  <div className="mx-auto mb-6 w-full max-w-[280px] aspect-[3/4] rounded-2xl border-2 border-dashed border-gray-300 bg-gray-50 flex flex-col items-center justify-center text-center px-6">
                    <QrCode size={56} className="text-gray-300 mb-3" />
                    <p className="text-sm text-gray-400">
                      Tambahkan file QRIS di
                      <br />
                      <span className="font-mono text-xs">public{QRIS_IMAGE}</span>
                    </p>
                  </div>
                ) : (
                  <img
                    src={QRIS_IMAGE}
                    alt="QRIS Sakola Kembara"
                    onError={() => setQrUnavailable(true)}
                    className="mx-auto mb-6 w-full max-w-[280px] rounded-2xl"
                  />
                )}

                <p className="text-center text-gray-500 text-sm mb-6">
                  Scan via{" "}
                  <span className="font-semibold text-gray-700">
                    GoPay, OVO, DANA, ShopeePay
                  </span>
                  , atau m-banking.
                </p>

                <a
                  href={QRIS_IMAGE}
                  download
                  className="mt-auto w-full inline-flex items-center justify-center gap-2 px-6 py-3.5 rounded-xl border-2 border-primary-blue text-primary-blue font-semibold hover:bg-primary-blue/5 transition-colors"
                >
                  <Download size={18} />
                  Download QR
                </a>
              </div>

              {/* Transfer Bank Card */}
              <div className="bg-white rounded-3xl p-8 shadow-lg flex flex-col">
                <h3 className="text-xl font-bold text-primary-blue text-center mb-6">
                  Transfer Bank
                </h3>

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

                <button
                  onClick={handleCopy}
                  className={`mt-auto w-full inline-flex items-center justify-center gap-2 px-6 py-3.5 rounded-xl border-2 font-semibold transition-colors ${
                    copied
                      ? "border-secondary-green text-secondary-green"
                      : "border-primary-blue text-primary-blue hover:bg-primary-blue/5"
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
                </button>
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
                <h3 className="text-xl font-bold text-gray-900 mb-2">
                  Terima Kasih atas Donasi Anda
                </h3>
                <p className="text-gray-600 text-sm mb-6 max-w-[360px]">
                  Setelah berdonasi, mohon konfirmasikan melalui formulir berikut agar
                  donasi Anda dapat kami catat dengan baik.
                </p>
                <a
                  href={CONFIRMATION_FORM_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-auto w-full inline-flex items-center justify-center gap-2 px-6 py-3.5 rounded-xl bg-primary-blue text-white font-semibold hover:bg-primary-blue-dark transition-colors"
                >
                  <ClipboardCheck size={18} />
                  Konfirmasi Donasi
                </a>
              </div>

              {/* Ingin Bergabung */}
              <div className="bg-gradient-to-br from-primary-blue to-accent-navy rounded-3xl p-8 text-center text-white flex flex-col items-center">
                <div className="w-12 h-12 bg-white/15 rounded-xl flex items-center justify-center mb-4">
                  <Users className="text-white" size={24} />
                </div>
                <h3 className="text-xl font-bold mb-2">Ingin Bergabung?</h3>
                <p className="text-white/80 text-sm mb-6 max-w-[360px]">
                  Jadilah bagian dari perubahan. Daftarkan diri Anda sebagai relawan
                  atau dukung kami melalui kerjasama lainnya.
                </p>
                <Link
                  href="/kontak"
                  className="mt-auto w-full inline-flex items-center justify-center px-6 py-3.5 bg-gray-50 text-primary-blue font-semibold rounded-xl text-sm hover:bg-gray-100 transition-colors"
                >
                  Hubungi Kami
                </Link>
              </div>
            </motion.div>
          </div>
        </section>

        {/* Stakeholder Relations - Transparansi & Akuntabilitas */}
        <StakeholderSection />
      </main>
    </>
  );
}
