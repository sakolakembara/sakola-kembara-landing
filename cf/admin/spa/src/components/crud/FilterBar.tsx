import { X } from "lucide-react";
import type { FormEvent, ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/field";
import type { ListState } from "~/lib/crud/useList";
import { isFiltered } from "~/lib/crud/query";

/**
 * The filter row above a list (a port of the legacy Aktivitas filters): a labelled control per filter, the
 * search box, "Terapkan", and "Hapus filter" when anything narrows the list. It is a `<form>` that applies on
 * submit (Enter in the search box too), so nothing is requested while someone is still typing, and the result is
 * in the address bar (`list.apply`), which is why a filtered list can be linked to: the dashboard's
 * "Pendaftar pending" tile goes to `/applications?status=pending`.
 */
export interface FilterOption {
  value: string;
  label: string;
}

export interface FilterSpec {
  /** The query parameter, the same name the Worker's filter has. */
  name: string;
  label: string;
  options: readonly FilterOption[];
  /** The "no filter" option: "Semua tingkat". */
  allLabel: string;
}

export interface FilterBarProps {
  list: Pick<ListState<unknown>, "query" | "apply" | "reset">;
  /** Leave out for a list without free-text search. */
  search?: { label?: string; placeholder?: string };
  filters?: readonly FilterSpec[];
  /** The `id` prefix, when two bars share a page. */
  idPrefix?: string;
}

function Labelled({ label, htmlFor, children }: { label: string; htmlFor: string; children: ReactNode }) {
  return (
    <div>
      <label htmlFor={htmlFor} className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-gray-600">
        {label}
      </label>
      {children}
    </div>
  );
}

export function FilterBar({ list, search, filters = [], idPrefix = "filter" }: FilterBarProps) {
  const { query } = list;
  // The form is uncontrolled and remounts when the address bar changes (a cleared filter, the back button).
  const formKey = JSON.stringify([query.q, query.filters]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const next: Record<string, string> = {};
    for (const filter of filters) {
      const value = String(data.get(filter.name) ?? "");
      if (value) next[filter.name] = value;
    }
    list.apply({ q: search ? String(data.get("q") ?? "") : "", filters: next });
  }

  if (!search && filters.length === 0) return null;

  return (
    <form
      key={formKey}
      onSubmit={submit}
      role="search"
      aria-label="Saring daftar"
      className="mb-5 grid grid-cols-1 items-end gap-3 rounded-xl border border-gray-100 bg-white p-4 md:grid-cols-2 md:p-5 lg:grid-cols-4"
    >
      {search && (
        <Labelled label={search.label ?? "Cari"} htmlFor={`${idPrefix}-q`}>
          <Input id={`${idPrefix}-q`} name="q" type="search" size="sm" defaultValue={query.q} placeholder={search.placeholder ?? "Cari..."} maxLength={48} autoComplete="off" />
        </Labelled>
      )}
      {filters.map((filter) => (
        <Labelled key={filter.name} label={filter.label} htmlFor={`${idPrefix}-${filter.name}`}>
          <Select id={`${idPrefix}-${filter.name}`} name={filter.name} size="sm" defaultValue={query.filters[filter.name] ?? ""}>
            <option value="">{filter.allLabel}</option>
            {filter.options.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        </Labelled>
      ))}
      <div className="flex gap-2">
        <Button type="submit" size="sm" className="flex-1">
          Terapkan
        </Button>
        {isFiltered(query) && (
          // A button, not a link: the address bar is rewritten by `reset`, the page does not change.
          <button
            type="button"
            onClick={list.reset}
            title="Hapus filter"
            className="inline-flex min-h-10 items-center justify-center gap-1 rounded-lg border-2 border-gray-200 px-3 py-2 text-sm text-gray-600 transition-colors hover:border-gray-300 hover:text-gray-900"
          >
            <X size={14} aria-hidden="true" />
            <span className="sr-only">Hapus filter</span>
          </button>
        )}
      </div>
    </form>
  );
}

