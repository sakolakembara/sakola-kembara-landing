import { X } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "~/components/ui/button";

/**
 * The bar for a list's ticked rows: "2 artikel dipilih", what can be done to them, "Batal pilih". It goes after the
 * list and sticks to the bottom edge of the page while the list is longer than the screen: nothing above it moves when
 * the first row is ticked (a bar in front of the table pushed every row down under the pointer), and it stays in reach
 * however far down the ticked rows are. The count is also in a live region (`aria-live`, not
 * `role="status"`: that is the notice's) that is always there, since a region that only appears is not reliably
 * announced, so a screen reader hears "2 artikel dipilih" as the ticks change; the visible text is hidden from it to
 * avoid saying it twice.
 */
export function BulkBar({ count, noun, onClear, children }: { count: number; noun: string; onClear: () => void; children: ReactNode }) {
  return (
    <>
      <p aria-live="polite" aria-atomic="true" className="sr-only">
        {count > 0 ? `${count} ${noun} dipilih` : ""}
      </p>
      {count > 0 && (
        <div role="group" aria-label="Aksi untuk baris yang dipilih" className="sticky bottom-4 z-30 mx-auto mt-4 flex w-fit max-w-full flex-wrap items-center gap-x-2.5 gap-y-2 rounded-2xl border border-primary/30 bg-card px-4 py-2.5 shadow-lg max-sm:w-full">
          <span aria-hidden="true" className="order-1 text-sm font-semibold text-primary-blue-dark">
            {count} {noun} dipilih
          </span>
          <span aria-hidden="true" className="order-2 hidden h-[18px] w-px bg-primary/20 sm:block" />
          {/* On a phone the count and the way out share the first line, and the buttons have the line below. */}
          <div className="order-3 flex basis-full flex-wrap gap-2 sm:basis-auto">{children}</div>
          <Button variant="ghost" size="sm" onClick={onClear} className="order-2 ml-auto sm:order-4">
            <X aria-hidden="true" className="sm:hidden" />
            <span className="max-sm:sr-only">Batal pilih</span>
          </Button>
        </div>
      )}
    </>
  );
}
