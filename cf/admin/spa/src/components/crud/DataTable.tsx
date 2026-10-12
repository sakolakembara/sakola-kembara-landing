import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Table, TableCard, TBody, Td, Th, THead } from "@/components/ui/table";
import type { LoadState } from "~/lib/crud/types";

/**
 * The kit's table for a list, with the three states a list has besides "rows" (docs/cloudflare/admin-crud.md#15-the-spa-kit):
 *
 *   loading  one row, `role="status"`: "Memuat data..." (the table itself is `aria-busy`)
 *   error    one row, `role="alert"`, with "Coba lagi"
 *   empty    one row with the empty text (the caller says "Belum ada ..." or "Tidak ada ... yang cocok")
 *
 * The header stays in all of them, so the page does not jump when the rows arrive. A column of row actions
 * goes last: pass `actions`, a function from the row to its buttons and links; its header is for screen
 * readers only. The caption names the table for assistive technology (and, below `md`, says the columns scroll:
 * the legacy `TableHint`).
 */
export interface Column<T> {
  key: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
  /** On the `<td>` (alignment, width, wrapping). */
  className?: string;
  /** On the `<th>`. */
  headerClassName?: string;
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
  actions?: (row: T) => ReactNode;
  /** Rows of the page before are still shown while the next loads. */
  refreshing?: boolean;
}

export function DataTable<T>({ caption, columns, rows, rowKey, state, errorMessage, onRetry, emptyText, actions, refreshing = false }: DataTableProps<T>) {
  const span = columns.length + (actions ? 1 : 0);
  const showRows = (state === "ready" || state === "loading") && rows.length > 0;

  return (
    <div aria-busy={state === "loading" || refreshing}>
      <TableCard>
        <Table>
          <caption className="caption-top border-b border-gray-100 bg-gray-50 px-4 py-2 text-left text-[11px] text-gray-500 md:sr-only">
            {caption}. Geser tabel ke samping untuk melihat kolom lainnya.
          </caption>
          <THead>
            <tr>
              {columns.map((column) => (
                <Th key={column.key} scope="col" className={column.headerClassName}>
                  {column.header}
                </Th>
              ))}
              {actions && (
                <Th scope="col">
                  <span className="sr-only">Aksi</span>
                </Th>
              )}
            </tr>
          </THead>
          <TBody className={refreshing ? "opacity-60 transition-opacity" : undefined}>
            {showRows &&
              rows.map((row) => (
                <tr key={rowKey(row)} className="hover:bg-gray-50">
                  {columns.map((column) => (
                    <Td key={column.key} className={column.className ?? "align-top"}>
                      {column.cell(row)}
                    </Td>
                  ))}
                  {actions && <Td className="whitespace-nowrap text-right align-top">{actions(row)}</Td>}
                </tr>
              ))}
            {state === "loading" && rows.length === 0 && (
              <tr>
                <Td colSpan={span} className="p-12 text-center text-gray-500">
                  <p role="status">Memuat data...</p>
                </Td>
              </tr>
            )}
            {state === "error" && (
              <tr>
                <Td colSpan={span} className="p-12 text-center">
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
              <tr>
                <Td colSpan={span} className="p-12 text-center text-gray-500">
                  {emptyText}
                </Td>
              </tr>
            )}
          </TBody>
        </Table>
      </TableCard>
    </div>
  );
}
