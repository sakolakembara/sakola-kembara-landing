import { X } from "lucide-react";

/**
 * What narrows a list right now, as chips under the filter controls: "Status: Pending ×". A list with many filters
 * is hard to read back from its controls (which ones are not on "Semua"?), and a chip is the quickest way to drop
 * one. Each chip is a button that clears just that filter; "Hapus filter" still clears them all.
 */
export interface FilterChip {
  key: string;
  /** The control's label: "Status". */
  label: string;
  /** What it is set to, in words: "Pending", not `pending`. */
  value: string;
  clear(): void;
}

export function FilterChips({ chips, className }: { chips: readonly FilterChip[]; className?: string }) {
  if (chips.length === 0) return null;
  return (
    <ul aria-label="Filter yang aktif" className={className ?? "flex flex-wrap gap-2"}>
      {chips.map((chip) => (
        <li key={chip.key}>
          <button
            type="button"
            onClick={chip.clear}
            aria-label={`Hapus filter ${chip.label}: ${chip.value}`}
            className="inline-flex min-h-8 max-w-full items-center gap-1.5 rounded-full border border-gray-200 bg-gray-50 py-1 pl-3 pr-2 text-[13px] text-gray-700 transition-colors hover:border-gray-300 hover:bg-gray-100"
          >
            <span className="shrink-0 text-gray-500">{chip.label}:</span>
            <span className="truncate font-medium text-gray-900">{chip.value}</span>
            <X aria-hidden="true" className="size-3.5 shrink-0 text-gray-500" />
          </button>
        </li>
      ))}
    </ul>
  );
}
