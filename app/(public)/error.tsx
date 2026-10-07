"use client";

import { useEffect } from "react";
import Link from "next/link";
import { AlertTriangle, Home, RotateCw } from "lucide-react";
import * as Sentry from "@sentry/nextjs";

interface Props {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function PublicError({ error, reset }: Props) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <main className="min-h-[70dvh] flex items-center justify-center px-4 py-16">
      <div className="max-w-md text-center">
        <div className="w-14 h-14 mx-auto mb-4 rounded-full bg-amber-100 flex items-center justify-center">
          <AlertTriangle className="text-amber-600" size={26} />
        </div>
        <h1 className="font-[family-name:var(--font-display)] text-2xl md:text-3xl text-gray-900 mb-2">
          Halaman ini bermasalah
        </h1>
        <p className="text-gray-600 leading-relaxed mb-6">
          Kami sudah menerima laporan otomatis dan sedang menelusuri. Silakan
          coba lagi, atau kembali ke beranda.
        </p>
        {error.digest && (
          <p className="text-xs text-gray-400 font-mono mb-6 break-all">
            Kode kesalahan: {error.digest}
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
    </main>
  );
}
