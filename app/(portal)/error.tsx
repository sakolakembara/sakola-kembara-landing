"use client";

import { useEffect } from "react";
import Link from "next/link";
import { AlertTriangle, Home, RotateCw } from "lucide-react";
import * as Sentry from "@sentry/nextjs";

interface Props {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function PortalError({ error, reset }: Props) {
  useEffect(() => {
    Sentry.captureException(error, { tags: { area: "portal" } });
  }, [error]);

  return (
    <div className="min-h-dvh flex items-center justify-center bg-gray-50 px-4 py-16">
      <div className="max-w-lg w-full bg-white rounded-2xl border border-gray-100 p-8 md:p-10 text-center">
        <div className="w-14 h-14 mx-auto mb-4 rounded-full bg-amber-100 flex items-center justify-center">
          <AlertTriangle className="text-amber-600" size={26} />
        </div>
        <h1 className="font-[family-name:var(--font-display)] text-2xl text-gray-900 mb-2">
          Portal siswa bermasalah
        </h1>
        <p className="text-sm text-gray-600 leading-relaxed mb-6">
          Tenang, pendaftaran kamu tidak terhapus. Data tersimpan di server dan
          bisa dibuka lagi setelah halaman berhasil dimuat.
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
            href="/"
            className="inline-flex items-center gap-2 px-5 py-2.5 border-2 border-gray-200 text-gray-700 font-semibold rounded-lg hover:bg-gray-50 transition-colors"
          >
            <Home size={14} /> Ke beranda
          </Link>
        </div>
      </div>
    </div>
  );
}
