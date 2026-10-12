import { Check, Copy } from "lucide-react";
import { useEffect, useRef, useState } from "react";

/**
 * Copies the full shortlink to the clipboard (a port of app/(admin)/admin/shortlinks/_copy-button.tsx).
 * `navigator.clipboard` needs a secure context, so it is absent over plain http on a LAN address: fall back to
 * telling the admin ("Salin manual") rather than silently doing nothing.
 */
export function CopyButton({ url }: { url: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // A pending reset must not outlive the button (the row can be deleted or the page left).
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  async function copy() {
    if (timer.current) clearTimeout(timer.current);
    try {
      if (!navigator.clipboard) throw new Error("clipboard unavailable");
      await navigator.clipboard.writeText(url);
      setState("copied");
      timer.current = setTimeout(() => setState("idle"), 1800);
    } catch {
      setState("failed");
      timer.current = setTimeout(() => setState("idle"), 2500);
    }
  }

  return (
    <button
      type="button"
      onClick={() => void copy()}
      title={state === "failed" ? "Gagal menyalin — salin manual" : `Salin ${url}`}
      aria-label={`Salin ${url}`}
      className="inline-flex items-center gap-1 text-xs text-gray-500 transition-colors hover:text-primary-blue"
    >
      {state === "copied" ? (
        <>
          <Check size={13} aria-hidden="true" className="text-green-600" />
          <span className="text-green-600">Tersalin</span>
        </>
      ) : state === "failed" ? (
        <span className="text-amber-600">Salin manual</span>
      ) : (
        <>
          <Copy size={13} aria-hidden="true" /> Salin
        </>
      )}
    </button>
  );
}
