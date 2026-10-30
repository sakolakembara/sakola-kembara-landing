import { ArrowDown, ArrowUp, ChevronsUpDown, Inbox, SearchX } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { Button } from "~/components/ui/button";
import { Table, TableCard, TBody, Td, Th, THead } from "~/components/ui/table";
import { Skeleton } from "~/components/ui/skeleton";
import type { LoadState } from "~/lib/crud/types";

/**
 * The kit's table for a list, with the three states a list has besides "rows" (docs/cloudflare/admin-crud.md#15-the-spa-kit):
 *
 *   loading  a status row for screen readers, `role="status"`: "Memuat data...", and five grey pulsing rows for everyone
 *            else (hidden from the accessibility tree); the table itself is `aria-busy`
 *   error    one row, `role="alert"`, with "Coba lagi"
 *   empty    one row with an icon and the empty text (the caller says "Belum ada ..." or "Tidak ada ... yang cocok"),
 *            and an action when there is one (clear the filters)
 *
 * The header stays in all of them, so the page does not jump when the rows arrive. A column of row actions
 * goes last: pass `actions`, a function from the row to its buttons and links; its header is for screen
 * readers only. A column with a `sort` has a button in its header (and `aria-sort` on it); the sort itself lives in
 * the address bar (`useList`). The caption names the table for assistive technology.
 *
 * Below `md` the table becomes a stack of cards: each row a card, each cell a block with its column's name above it
 * (`data-label`), the first column as the card's title. It is the same markup with other CSS, so the roles are
 * written out (`role="table"`, `row`, `cell`): a browser that drops a table's semantics when it is not drawn as one
 * keeps them. The header row is then for screen readers only, so a phone has no sort buttons.
 */
export interface Column<T> {
  key: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
  /** On the `<td>` (alignment, width, wrapping). */
  className?: string;
  /** On the `<th>`. */
  headerClassName?: string;
  /** The API's name for sorting by this column (one of the screen's `spec.sorts`, without the `-`): the header becomes a sort button. */
  sort?: string;
  /** Dates and amounts read best with the biggest first: the first press sorts them descending. */
  sortFirst?: "desc";
}

export interface DataTableProps<T> {
  /** Names the table: "Daftar pengumuman". */
  caption: string;
  columns: readonly Column<T>[];
  rows: readonly T[];
  rowKey: (row: T) => string;
  state: LoadState;
  /** A sentence for the error row; the caller got it from `describeFailure`. */
  errorMessage?: string;
  onRetry?: () => void;
  /** What an empty table says. */
  emptyText: ReactNode;
  /** The empty table is the result of a search or filter, not a list with nothing in it: another icon. */
  emptyFiltered?: boolean;
  /** Under the empty text: the one thing that fixes it ("Tampilkan semua"). */
  emptyAction?: ReactNode;
  actions?: (row: T) => ReactNode;
  /** Rows of the page before are still shown while the next loads. */
  refreshing?: boolean;
  /** The sort in force (`name` or `-name`) and how to change it; without it a column's `sort` does nothing. */
  sort?: { value: string; onChange: (sort: string) => void };
}

/** How many grey rows stand in for the rows to come, and how wide each cell's bar is (cycled, so the rows are not a grid of equal bars). */
const SKELETON_ROWS = 5;
const SKELETON_WIDTHS = ["w-3/4", "w-1/2", "w-2/3", "w-1/3", "w-5/6"] as const;

/** A cell that is a line of its own on a phone. */
const CARD_LINE = "max-md:block";

function SortHeader<T>({ column, sort }: { column: Column<T>; sort: NonNullable<DataTableProps<T>["sort"]> }) {
  const ascending = column.sort as string;
  const descending = `-${ascending}`;
  const state = sort.value === ascending ? "ascending" : sort.value === descending ? "descending" : "none";
  // None goes to the column's natural direction, then it flips each press.
  const next = state === "none" ? (column.sortFirst === "desc" ? descending : ascending) : state === "ascending" ? descending : ascending;
  const Icon = state === "ascending" ? ArrowUp : state === "descending" ? ArrowDown : ChevronsUpDown;
  return (
    <button
      type="button"
      onClick={() => sort.onChange(next)}
      className="-mx-1.5 inline-flex items-center gap-1 rounded-md px-1.5 py-1 font-semibold transition-colors hover:bg-gray-200/70 hover:text-gray-900"
    >
      {column.header}
      <Icon aria-hidden="true" className={cn("size-3.5", state === "none" ? "text-gray-400" : "text-gray-900")} />
    </button>
  );
}

function sortState<T>(column: Column<T>, sort: DataTableProps<T>["sort"]): "ascending" | "descending" | "none" | undefined {
  if (!column.sort || !sort) return undefined;
  return sort.value === column.sort ? "ascending" : sort.value === `-${column.sort}` ? "descending" : "none";
}

export function DataTable<T>({
  caption,
  columns,
  rows,
  rowKey,
  state,
  errorMessage,
  onRetry,
  emptyText,
  emptyFiltered = false,
  emptyAction,
  actions,
  refreshing = false,
  sort,
}: DataTableProps<T>) {
  const span = columns.length + (actions ? 1 : 0);
  const showRows = (state === "ready" || state === "loading") && rows.length > 0;
  const EmptyIcon = emptyFiltered ? SearchX : Inbox;

  return (
    <div aria-busy={state === "loading" || refreshing}>
      <TableCard>
        <Table className="max-md:block" role="table">
          <caption className="sr-only">{caption}.</caption>
          <THead className="max-md:sr-only" role="rowgroup">
            <tr role="row">
              {columns.map((column) => (
                <Th key={column.key} scope="col" role="columnheader" aria-sort={sortState(column, sort)} className={column.headerClassName}>
                  {column.sort && sort ? <SortHeader column={column} sort={sort} /> : column.header}
                </Th>
              ))}
              {actions && (
                <Th scope="col" role="columnheader">
                  <span className="sr-only">Aksi</span>
                </Th>
              )}
            </tr>
          </THead>
          {/* Dims only when the new answer is slow (the delay is on the way in, not on the way out): a list that comes back from memory and is confirmed at once does not flash. */}
          <TBody role="rowgroup" className={cn(CARD_LINE, refreshing ? "opacity-60 transition-opacity delay-300" : "transition-opacity")}>
            {showRows &&
              rows.map((row) => (
                <tr key={rowKey(row)} role="row" className="hover:bg-gray-50 max-md:block max-md:px-4 max-md:py-3.5">
                  {columns.map((column, index) => (
                    <Td
                      key={column.key}
                      role="cell"
                      data-label={typeof column.header === "string" ? column.header : undefined}
                      className={cn(
                        column.className ?? "align-top",
                        // A phone: a block per cell with the column's name above it, except the first cell (the card's title).
                        "max-md:block max-md:px-0 max-md:py-1 max-md:whitespace-normal",
                        index === 0 || typeof column.header !== "string"
                          ? "max-md:before:hidden"
                          : "max-md:before:mb-0.5 max-md:before:block max-md:before:text-xs max-md:before:font-medium max-md:before:text-gray-500 max-md:before:content-[attr(data-label)]",
                      )}
                    >
                      {column.cell(row)}
                    </Td>
                  ))}
                  {actions && <Td role="cell" className="whitespace-nowrap text-right align-top max-md:flex max-md:justify-start max-md:gap-1 max-md:px-0 max-md:pb-0 max-md:pt-2.5">{actions(row)}</Td>}
                </tr>
              ))}
            {state === "loading" && rows.length === 0 && (
              <>
                {/* The words are for people who cannot see the grey rows below, which only say that something is coming. */}
                <tr role="row">
                  <Td role="cell" colSpan={span} className={cn("p-0", CARD_LINE)}>
                    <p role="status" className="sr-only">
                      Memuat data...
                    </p>
                  </Td>
                </tr>
                {Array.from({ length: SKELETON_ROWS }, (_, line) => (
                  <tr key={line} aria-hidden="true" className={CARD_LINE}>
                    {Array.from({ length: span }, (_, column) => (
                      <Td key={column} className="py-4 max-md:block max-md:px-4 max-md:py-2">
                        <Skeleton className={`h-4 ${SKELETON_WIDTHS[(line + column) % SKELETON_WIDTHS.length]}`} />
                      </Td>
                    ))}
                  </tr>
                ))}
              </>
            )}
            {state === "error" && (
              <tr role="row" className={CARD_LINE}>
                <Td role="cell" colSpan={span} className={cn("p-12 text-center", CARD_LINE)}>
                  <p role="alert" className="mb-4 text-gray-700">
                    {errorMessage ?? "Gagal memuat data."}
                  </p>
                  {onRetry && (
                    <Button variant="neutral" onClick={onRetry}>
                      Coba lagi
                    </Button>
                  )}
                </Td>
              </tr>
            )}
            {state === "ready" && rows.length === 0 && (
              <tr role="row" className={CARD_LINE}>
                <Td role="cell" colSpan={span} className={cn("px-6 py-14 text-center", CARD_LINE)}>
                  <div aria-hidden="true" className="mx-auto mb-3 flex size-12 items-center justify-center rounded-full bg-gray-100 text-gray-500">
                    <EmptyIcon className="size-6" strokeWidth={1.5} />
                  </div>
                  <div className="text-gray-600">{emptyText}</div>
                  {emptyAction && <div className="mt-4">{emptyAction}</div>}
                </Td>
              </tr>
            )}
          </TBody>
        </Table>
      </TableCard>
    </div>
  );
}
