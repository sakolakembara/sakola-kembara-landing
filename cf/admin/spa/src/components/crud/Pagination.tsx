import { useId } from "react";
import { Link } from "react-router";
import { cn } from "@/lib/cn";
import { Select } from "~/components/ui/field";
import { pageNumbers, totalPages } from "~/lib/crud/query";

/**
 * "Sebelumnya", the page numbers, "Berikutnya" and "Menampilkan 21 sampai 40 dari 87"
 * (a port of the legacy Aktivitas pagination). Real links, so the keyboard, a middle click and "copy link"
 * work, and the address bar is the state. The current page is `aria-current="page"`; "Sebelumnya" on the
 * first page and "Berikutnya" on the last are plain text, not links that go nowhere.
 *
 * `searchFor(page)` gives the address-bar query of a page (`useList(...).searchFor`). With `perPage` the line also
 * has "Baris per halaman" (a select; it shows while the list is longer than the smallest size), and `selected` adds
 * "· 2 dipilih" to the count.
 */
export interface PerPage {
  /** What the address says; the select follows it at once, before the new answer comes. */
  value: number;
  choices: readonly number[];
  onChange(size: number): void;
}

const LINK =
  "inline-flex min-h-10 items-center gap-1 rounded-lg border border-input bg-card px-3 py-2 text-sm font-medium text-gray-700 transition-colors hover:border-gray-400 hover:bg-gray-50 md:min-h-[34px] md:py-1.5";
const OFF = "inline-flex min-h-10 items-center gap-1 rounded-lg border border-gray-100 px-3 py-2 text-sm font-medium text-gray-300 md:min-h-[34px] md:py-1.5";

export function Pagination({
  page,
  pageSize,
  total,
  searchFor,
  perPage,
  selected = 0,
}: {
  page: number;
  pageSize: number;
  total: number;
  searchFor: (page: number) => string;
  perPage?: PerPage;
  selected?: number;
}) {
  const perPageId = useId();
  if (total === 0) return null;
  const pages = totalPages(total, pageSize);
  const first = (page - 1) * pageSize + 1;
  const last = Math.min(total, page * pageSize);
  const format = (value: number) => value.toLocaleString("id-ID");

  return (
    <div className="mt-4 flex flex-col items-center gap-3 md:flex-row md:justify-between">
      <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2 md:justify-start">
        <p className="text-[13px] text-gray-600">
          {total <= pageSize || first > total ? `${format(total)} data` : `Menampilkan ${format(first)} sampai ${format(last)} dari ${format(total)}`}
          {selected > 0 && ` · ${format(selected)} dipilih`}
        </p>
        {perPage && total > Math.min(...perPage.choices) && (
          <div className="flex items-center gap-2">
            <label htmlFor={perPageId} className="text-[13px] text-gray-600">
              Baris per halaman
            </label>
            <Select id={perPageId} size="sm" className="w-auto min-w-20" value={perPage.value} onChange={(event) => perPage.onChange(Number(event.target.value))}>
              {perPage.choices.map((size) => (
                <option key={size} value={size}>
                  {size}
                </option>
              ))}
            </Select>
          </div>
        )}
      </div>
      {pages > 1 && (
        <nav aria-label="Halaman" className="flex flex-wrap items-center justify-center gap-2 md:justify-end">
          {page > 1 ? (
            <Link to={searchFor(page - 1)} rel="prev" className={LINK}>
              Sebelumnya
            </Link>
          ) : (
            <span aria-disabled="true" className={OFF}>
              Sebelumnya
            </span>
          )}
          <ul className="flex items-center gap-1">
            {pageNumbers(page, pages).map((item, index) => (
              <li key={item === "…" ? `gap-${index}` : item}>
                {item === "…" ? (
                  <span aria-hidden="true" className="select-none px-2 text-sm text-gray-400">
                    …
                  </span>
                ) : item === page ? (
                  <span aria-current="page" aria-label={`Halaman ${item}, halaman ini`} className="block min-w-9 rounded-lg bg-primary px-2 py-2 text-center text-sm font-semibold text-primary-foreground md:py-1.5">
                    {item}
                  </span>
                ) : (
                  <Link
                    to={searchFor(item)}
                    aria-label={`Halaman ${item}`}
                    className={cn("block min-w-9 rounded-lg border border-input bg-card px-2 py-2 text-center text-sm font-medium text-gray-700 transition-colors hover:border-gray-400 hover:bg-gray-50 md:py-1.5")}
                  >
                    {item}
                  </Link>
                )}
              </li>
            ))}
          </ul>
          {page < pages ? (
            <Link to={searchFor(page + 1)} rel="next" className={LINK}>
              Berikutnya
            </Link>
          ) : (
            <span aria-disabled="true" className={OFF}>
              Berikutnya
            </span>
          )}
        </nav>
      )}
    </div>
  );
}
