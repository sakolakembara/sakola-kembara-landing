"use client";

import { useEffect } from "react";
import Link from "next/link";
import { AlertTriangle, LayoutDashboard, RotateCw } from "lucide-react";
import * as Sentry from "@sentry/nextjs";

interface Props {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function AdminError({ error, reset }: Props) {
  useEffect(() => {
    Sentry.captureException(error, { tags: { area: "admin" } });
  }, [error]);

  return (
    <div className="min-h-dvh flex items-center justify-center bg-gray-50 px-4 py-16">
      <div className="max-w-lg w-full bg-white rounded-2xl border border-gray-100 p-8 md:p-10 text-center">
        <div className="w-14 h-14 mx-auto mb-4 rounded-full bg-red-100 flex items-center justify-center">
          <AlertTriangle className="text-red-600" size={26} />
        </div>
        <h1 className="font-[family-name:var(--font-display)] text-2xl text-gray-900 mb-2">
          Gagal memuat halaman admin
        </h1>
        <p className="text-sm text-gray-600 leading-relaxed mb-6">
          Ada error di sisi server. Kesalahan sudah dikirim otomatis ke Sentry.
          Jika terus terjadi, cek log container atau hubungi tim teknis.
        </p>
        {error.digest && (
          <p className="text-xs text-gray-400 font-mono mb-6 break-all">
            Kode: {error.digest}
          </p>
        )}
        <div className="flex flex-wrap items-center justify-center gap-3">
          <button
            type="button"
            onClick={reset}
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-primary-blue text-white font-semibold rounded-lg hover:bg-primary-blue-dark transition-colors"
          >
            <RotateCw size={14} /> Coba lagi
          </button>
          <Link
            href="/admin"
            className="inline-flex items-center gap-2 px-5 py-2.5 border-2 border-gray-200 text-gray-700 font-semibold rounded-lg hover:bg-gray-50 transition-colors"
          >
            <LayoutDashboard size={14} /> Dashboard
          </Link>
        </div>
      </div>
    </div>
  );
}
