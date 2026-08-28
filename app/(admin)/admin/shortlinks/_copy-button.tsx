"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";

/**
 * Copies the full shortlink to the clipboard. `navigator.clipboard` needs a
 * secure context, so it is absent over plain http on a LAN IP — fall back to
 * telling the admin rather than silently doing nothing.
 */
export function CopyButton({ url }: { url: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");

  async function copy() {
    try {
      if (!navigator.clipboard) throw new Error("clipboard unavailable");
      await navigator.clipboard.writeText(url);
      setState("copied");
      setTimeout(() => setState("idle"), 1800);
    } catch {
      setState("failed");
      setTimeout(() => setState("idle"), 2500);
    }
  }

  return (
    <button
      type="button"
      onClick={copy}
      title={state === "failed" ? "Gagal menyalin — salin manual" : `Salin ${url}`}
      aria-label={`Salin ${url}`}
      className="inline-flex items-center gap-1 text-xs text-gray-500 hover:text-primary-blue transition-colors"
    >
      {state === "copied" ? (
        <>
          <Check size={13} className="text-green-600" />
          <span className="text-green-600">Tersalin</span>
        </>
      ) : state === "failed" ? (
        <span className="text-amber-600">Salin manual</span>
      ) : (
        <>
          <Copy size={13} /> Salin
        </>
      )}
    </button>
  );
}
