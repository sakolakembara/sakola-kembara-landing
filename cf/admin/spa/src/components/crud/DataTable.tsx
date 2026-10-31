import { ArrowDown, ArrowUp, ChevronsUpDown, Inbox, SearchX } from "lucide-react";
import { type ReactNode, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import { Button } from "~/components/ui/button";
import { Select } from "~/components/ui/field";
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
 * keeps them. The header row is then for screen readers only, so a phone gets a bar above the cards instead: "Urutkan"
 * (a select of the sortable columns, both ways) and, with a selection, "Pilih semua".
 *
 * With a `selection` the first column is a checkbox per row and, in the header, one for the whole page (on a phone the
 * checkbox sits in the card's corner). From `md` the header row sticks to the top of the page while a long list
 * scrolls, as long as the table fits its card: a table that is wider scrolls sideways inside the card, and a sticky
 * header cannot work under a box that scrolls, so then it stays where it is (`useFitsCard`).
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
  /** A checkbox per row; the caller keeps the set of ids. */
  selection?: RowSelection<T>;
}

export interface RowSelection<T> {
  selected: ReadonlySet<string>;
  toggle(id: string): void;
  /** Selects every row of the page, or clears the page when all of it already is selected. */
  toggleAll(): void;
  /** Names a row for its checkbox: "Pilih <this>". */
  label(row: T): string;
}

/** How many grey rows stand in for the rows to come, and how wide each cell's bar is (cycled, so the rows are not a grid of equal bars). */
const SKELETON_ROWS = 5;
const SKELETON_WIDTHS = ["w-3/4", "w-1/2", "w-2/3", "w-1/3", "w-5/6"] as const;

/** A cell that is a line of its own on a phone. */
const CARD_LINE = "max-md:block";

/** A header cell that stays at the top of the page from `md` (with its own background and rule: a sticky cell's border does not travel with it). */
const STICKY = "md:sticky md:top-0 md:z-10 md:bg-gray-50 md:shadow-[inset_0_-1px_0_var(--color-gray-200)]";

/**
 * Whether the table is no wider than the box around it. A box that scrolls sideways (`overflow-x: auto`) also
 * scrolls up and down as far as sticky is concerned, so a header can only stick to the page when the box does not
 * scroll: when the table fits, the box is clipped instead, which does not make it a scroller. Measured on the table
 * (its width does not depend on which of the two the box is), again whenever either changes size.
 */
function useFitsCard(): [React.RefObject<HTMLDivElement | null>, boolean] {
  const box = useRef<HTMLDivElement>(null);
  const [fits, setFits] = useState(true);
  // Before the first paint, so a table that does not fit is never drawn clipped, not even for a frame.
  useLayoutEffect(() => {
    const element = box.current;
    const table = element?.firstElementChild;
    if (!element || !(table instanceof HTMLElement)) return;
    const measure = () => setFits(table.offsetWidth <= element.clientWidth);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    observer.observe(table);
    return () => observer.disconnect();
  }, []);
  return [box, fits];
}

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

/** The sort select of a phone: each sortable column both ways, in the order a first press would go. */
function sortChoices<T>(columns: readonly Column<T>[]): { value: string; label: string }[] {
  return columns.flatMap((column) => {
    if (!column.sort || typeof column.header !== "string") return [];
    const up = { value: column.sort, label: `${column.header} (naik)` };
    const down = { value: `-${column.sort}`, label: `${column.header} (turun)` };
    return column.sortFirst === "desc" ? [down, up] : [up, down];
  });
}

function Checkbox({ checked, indeterminate = false, label, onChange, className }: { checked: boolean; indeterminate?: boolean; label?: string; onChange: () => void; className?: string }) {
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (input.current) input.current.indeterminate = indeterminate;
  }, [indeterminate]);
  return (
    <input
      ref={input}
      type="checkbox"
      checked={checked}
      onChange={onChange}
      aria-label={label}
      className={cn("size-4 cursor-pointer rounded border-gray-300 accent-primary max-md:size-5", className)}
    />
  );
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
  selection,
}: DataTableProps<T>) {
  const phoneToolbarId = useId();
  const [box, fits] = useFitsCard();
  const span = columns.length + (actions ? 1 : 0) + (selection ? 1 : 0);
  const choices = sort ? sortChoices(columns) : [];
  const isPicked = (row: T) => selection?.selected.has(rowKey(row)) ?? false;
  const allSelected = selection !== undefined && rows.length > 0 && rows.every(isPicked);
  const someSelected = selection !== undefined && !allSelected && rows.some(isPicked);
  const showRows = (state === "ready" || state === "loading") && rows.length > 0;
  const EmptyIcon = emptyFiltered ? SearchX : Inbox;

  return (
    <div aria-busy={state === "loading" || refreshing}>
      <TableCard className="md:overflow-clip">
        {(choices.length > 0 || selection) && showRows && (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-gray-200 bg-gray-50 px-4 py-3 md:hidden">
            {selection && (
              <label className="flex items-center gap-2 text-sm text-gray-700">
                <Checkbox checked={allSelected} indeterminate={someSelected} onChange={selection.toggleAll} />
                Pilih semua
              </label>
            )}
            {sort && choices.length > 0 && (
              <div className="ml-auto flex items-center gap-2">
                <label htmlFor={phoneToolbarId} className="text-[13px] text-gray-600">
                  Urutkan
                </label>
                <Select id={phoneToolbarId} size="sm" className="w-auto" value={sort.value} onChange={(event) => sort.onChange(event.target.value)}>
                  {!choices.some((choice) => choice.value === sort.value) && <option value={sort.value}>Urutan bawaan</option>}
                  {choices.map((choice) => (
                    <option key={choice.value} value={choice.value}>
                      {choice.label}
                    </option>
                  ))}
                </Select>
              </div>
            )}
          </div>
        )}
        <Table className="max-md:block" wrapperRef={box} wrapperClassName={fits ? "md:overflow-x-clip" : undefined} role="table">
          <caption className="sr-only">{caption}.</caption>
          <THead className="max-md:sr-only" role="rowgroup">
            <tr role="row">
              {selection && (
                <Th scope="col" role="columnheader" className={cn("w-10 pr-0", STICKY)}>
                  {/* On a phone the bar above the cards has the same box. */}
                  <Checkbox checked={allSelected} indeterminate={someSelected} label="Pilih semua baris di halaman ini" onChange={selection.toggleAll} className="max-md:hidden" />
                </Th>
              )}
              {columns.map((column) => (
                <Th key={column.key} scope="col" role="columnheader" aria-sort={sortState(column, sort)} className={cn(STICKY, column.headerClassName)}>
                  {column.sort && sort ? <SortHeader column={column} sort={sort} /> : column.header}
                </Th>
              ))}
              {actions && (
                <Th scope="col" role="columnheader" className={STICKY}>
                  <span className="sr-only">Aksi</span>
                </Th>
              )}
            </tr>
          </THead>
          {/* Dims only when the new answer is slow (the delay is on the way in, not on the way out): a list that comes back from memory and is confirmed at once does not flash. */}
          <TBody role="rowgroup" className={cn(CARD_LINE, refreshing ? "opacity-60 transition-opacity delay-300" : "transition-opacity")}>
            {showRows &&
              rows.map((row) => (
                <tr key={rowKey(row)} role="row" className={cn("max-md:relative max-md:block max-md:px-4 max-md:py-3.5", isPicked(row) ? "bg-primary/5 hover:bg-primary/8" : "hover:bg-gray-50")}>
                  {selection && (
                    <Td role="cell" className="w-10 pr-0 align-top max-md:absolute max-md:right-3 max-md:top-3 max-md:z-10 max-md:block max-md:w-auto max-md:p-0">
                      <Checkbox checked={isPicked(row)} label={`Pilih ${selection.label(row)}`} onChange={() => selection.toggle(rowKey(row))} className="mt-0.5 max-md:mt-0" />
                    </Td>
                  )}
                  {columns.map((column, index) => (
                    <Td
                      key={column.key}
                      role="cell"
                      data-label={typeof column.header === "string" ? column.header : undefined}
                      className={cn(
                        column.className ?? "align-top",
                        // A phone: a block per cell with the column's name above it, except the first cell (the card's title).
                        "max-md:block max-md:px-0 max-md:py-1 max-md:whitespace-normal",
                        // The card's corner belongs to the checkbox.
                        selection && index === 0 && "max-md:pr-9",
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
