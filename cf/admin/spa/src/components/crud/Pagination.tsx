import { Link } from "react-router";
import { cn } from "@/lib/cn";
import { pageNumbers, totalPages } from "~/lib/crud/query";

/**
 * "Sebelumnya", the page numbers, "Berikutnya" and "Menampilkan 21 sampai 40 dari 87"
 * (a port of the legacy Aktivitas pagination). Real links, so the keyboard, a middle click and "copy link"
 * work, and the address bar is the state. The current page is `aria-current="page"`; "Sebelumnya" on the
 * first page and "Berikutnya" on the last are plain text, not links that go nowhere.
 *
 * `searchFor(page)` gives the address-bar query of a page (`useList(...).searchFor`).
 */
const LINK =
  "inline-flex items-center gap-1 rounded-lg border border-gray-200 px-3 py-2 text-sm font-medium text-gray-700 transition-colors hover:border-primary-blue hover:text-primary-blue";
const OFF = "inline-flex items-center gap-1 rounded-lg border border-gray-100 px-3 py-2 text-sm font-medium text-gray-300";

export function Pagination({ page, pageSize, total, searchFor }: { page: number; pageSize: number; total: number; searchFor: (page: number) => string }) {
  if (total === 0) return null;
  const pages = totalPages(total, pageSize);
  const first = (page - 1) * pageSize + 1;
  const last = Math.min(total, page * pageSize);
  const format = (value: number) => value.toLocaleString("id-ID");

  return (
    <div className="mt-5 flex flex-col items-center gap-3">
      <p className="text-xs text-gray-500">
        {total <= pageSize || first > total ? `${format(total)} data` : `Menampilkan ${format(first)} sampai ${format(last)} dari ${format(total)}`}
      </p>
      {pages > 1 && (
        <nav aria-label="Halaman" className="flex flex-wrap items-center justify-center gap-2">
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
                  <span aria-current="page" aria-label={`Halaman ${item}, halaman ini`} className="block min-w-9 rounded-lg bg-primary-blue px-2 py-2 text-center text-sm font-semibold text-white">
                    {item}
                  </span>
                ) : (
                  <Link
                    to={searchFor(item)}
                    aria-label={`Halaman ${item}`}
                    className={cn("block min-w-9 rounded-lg border border-gray-200 px-2 py-2 text-center text-sm font-medium text-gray-700 transition-colors hover:border-primary-blue hover:text-primary-blue")}
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
