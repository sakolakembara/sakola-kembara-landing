import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

/** A block of the page that is still loading: a polite status line in a card, the size of what will replace it. */
export function LoadingBlock({ label }: { label: string }) {
  return (
    <div role="status" className="rounded-3xl border border-gray-100 bg-white p-8 text-sm text-gray-500 shadow-sm md:p-10">
      {label}
    </div>
  );
}

/** The data of a page could not be read: say so, and offer to try again (the legacy error page's promise: nothing is lost). */
export function LoadFailure({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="space-y-4 rounded-3xl border border-gray-100 bg-white p-8 shadow-sm md:p-10">
      <Alert>Tidak dapat memuat halaman ini. Periksa koneksi internet lalu coba lagi. Pendaftaran kamu tidak terhapus.</Alert>
      <Button onClick={onRetry}>Coba lagi</Button>
    </div>
  );
}
