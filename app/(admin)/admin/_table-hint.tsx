import { MoveHorizontal } from "lucide-react";

/**
 * Admin list tables keep their full desktop column set on phones and scroll
 * horizontally inside their card. That scroll is invisible on a touch device
 * until you happen to swipe, so the Status and action columns read as
 * missing. This says the columns are there.
 *
 * Rendered as a <caption> so it can be dropped in as the first child of a
 * <table> without restructuring the surrounding JSX. Hidden from md up,
 * where the table fits without scrolling.
 *
 * Do not add `flex` to the caption — it overrides display:table-caption and
 * drops the hint into the middle of the table.
 */
export function TableHint() {
  return (
    <caption className="md:hidden caption-top px-4 py-2 text-left text-[11px] text-gray-500 bg-gray-50 border-b border-gray-100">
      <MoveHorizontal
        size={12}
        aria-hidden
        className="inline-block align-text-bottom mr-1.5"
      />
      Geser tabel ke samping untuk melihat kolom lainnya.
    </caption>
  );
}
