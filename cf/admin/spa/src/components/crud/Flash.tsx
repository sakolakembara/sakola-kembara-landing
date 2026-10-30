import { X } from "lucide-react";
import { Alert } from "~/components/ui/alert";
import type { FlashControl } from "~/lib/crud/flash";

/**
 * The notice of `useFlash()`: "Pengumuman berhasil disimpan." A success is announced politely
 * (`role="status"`), an error right away (`role="alert"`): that is the kit's `Alert`. It can be dismissed.
 */
export function Flash({ flash, dismiss }: Pick<FlashControl, "flash" | "dismiss">) {
  if (!flash) return null;
  return (
    <Alert tone={flash.tone} className="mb-4">
      <div className="flex items-start justify-between gap-3">
        <span>{flash.text}</span>
        <button
          type="button"
          onClick={dismiss}
          aria-label="Tutup pesan"
          className="-m-1 flex size-8 shrink-0 items-center justify-center rounded-md opacity-70 transition-opacity hover:opacity-100"
        >
          <X size={16} aria-hidden="true" />
        </button>
      </div>
    </Alert>
  );
}
