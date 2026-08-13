"use client";

import { useState, useTransition } from "react";
import { MailCheck, RefreshCw } from "lucide-react";

interface Props {
  email: string;
}

type SendState =
  | { status: "idle" }
  | { status: "sending" }
  | { status: "sent" }
  | { status: "rate_limited"; retryAfter: number }
  | { status: "failed" };

export function VerifyEmailBanner({ email }: Props) {
  const [state, setState] = useState<SendState>({ status: "idle" });
  const [isPending, startTransition] = useTransition();

  const resend = () => {
    startTransition(async () => {
      setState({ status: "sending" });
      try {
        const res = await fetch("/api/account/resend-verification", {
          method: "POST",
        });
        if (res.ok) {
          setState({ status: "sent" });
          return;
        }
        if (res.status === 429) {
          const body = (await res.json().catch(() => ({}))) as {
            retryAfter?: number;
          };
          setState({
            status: "rate_limited",
            retryAfter: body.retryAfter ?? 60,
          });
          return;
        }
        setState({ status: "failed" });
      } catch {
        setState({ status: "failed" });
      }
    });
  };

  return (
    <div
      role="status"
      className="relative overflow-hidden rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 md:px-6 md:py-4"
    >
      <div className="flex flex-col md:flex-row md:items-center gap-3 md:gap-4">
        <div className="flex items-start gap-3 flex-1 min-w-0">
          <MailCheck className="text-amber-600 shrink-0 mt-0.5" size={20} />
          <div className="min-w-0">
            <p className="text-sm font-semibold text-amber-900">
              Verifikasi email kamu untuk mengaktifkan seluruh fitur
            </p>
            <p className="text-xs text-amber-800/90 mt-0.5">
              Cek inbox <span className="font-mono break-all">{email}</span>.
              Tautan verifikasi berlaku 24 jam.
            </p>
            {state.status === "sent" && (
              <p className="text-xs text-secondary-green font-semibold mt-2">
                Tautan baru sudah dikirim. Cek folder spam jika belum muncul.
              </p>
            )}
            {state.status === "rate_limited" && (
              <p className="text-xs text-amber-900 font-semibold mt-2">
                Terlalu banyak permintaan. Coba lagi sekitar{" "}
                {Math.ceil(state.retryAfter / 60)} menit lagi.
              </p>
            )}
            {state.status === "failed" && (
              <p className="text-xs text-red-700 font-semibold mt-2">
                Gagal mengirim. Coba lagi beberapa saat lagi.
              </p>
            )}
          </div>
        </div>
        <button
          type="button"
          onClick={resend}
          disabled={isPending || state.status === "sent"}
          className="inline-flex items-center justify-center gap-2 shrink-0 px-4 py-2 bg-white border-2 border-amber-300 text-amber-900 font-semibold rounded-lg text-sm hover:bg-amber-100 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
        >
          <RefreshCw size={14} className={isPending ? "animate-spin" : ""} />
          {state.status === "sent" ? "Terkirim" : "Kirim ulang tautan"}
        </button>
      </div>
    </div>
  );
}
