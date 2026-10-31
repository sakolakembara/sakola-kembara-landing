import { X } from "lucide-react";
import { type FormEvent, type ReactNode, useEffect, useRef } from "react";
import { Button } from "~/components/ui/button";
import { Input, Select } from "~/components/ui/field";
import type { ListState } from "~/lib/crud/useList";
import { cleanSearch, isFiltered } from "~/lib/crud/query";
import { useDraftText } from "~/lib/crud/useDraftText";
import { type FilterChip, FilterChips } from "./FilterChips";

/**
 * The filter row above a list (a port of the legacy Aktivitas filters): a labelled control per filter, the
 * search box, and "Hapus filter" when anything narrows the list. A filter applies the moment it is chosen, with
 * the search as it stands; the search applies after a short pause in typing, and at once on Enter. The result is in
 * the address bar (`list.apply`), which is why a filtered list can be linked to: the dashboard's
 * "Pendaftar pending" tile goes to `/applications?status=pending`. A bar with three controls or more also lists what
 * is set as chips under them (`FilterChips`), each one a button that drops just that filter. `trailing` is for a
 * control that belongs with these but is not a filter ("Kolom"); it sits beside "Hapus filter".
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
  trailing?: ReactNode;
}

/** Quiet time after the last keystroke before the search is asked for. */
const SEARCH_DELAY_MS = 350;

function Labelled({ label, htmlFor, children }: { label: string; htmlFor: string; children: ReactNode }) {
  return (
    <div>
      <label htmlFor={htmlFor} className="mb-1.5 block text-[13px] font-medium text-gray-700">
        {label}
      </label>
      {children}
    </div>
  );
}

/** The number of controls from which the chips are worth their line. */
const CHIPS_FROM = 3;

export function FilterBar({ list, search, filters = [], idPrefix = "filter", trailing }: FilterBarProps) {
  const { query } = list;
  // The pause in typing fires later than the render that scheduled it: it applies with the filters as they are by then.
  const latest = useRef(list);
  useEffect(() => {
    latest.current = list;
  });
  const searchText = useDraftText(query.q, (q) => latest.current.apply({ q, filters: latest.current.query.filters }), {
    delay: SEARCH_DELAY_MS,
    clean: cleanSearch,
  });

  function choose(name: string, value: string) {
    const next = { ...query.filters };
    if (value) next[name] = value;
    else delete next[name];
    list.apply({ q: search ? searchText.take() : "", filters: next });
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    searchText.flush();
  }

  if (!search && filters.length === 0) return null;

  const chips: FilterChip[] = [];
  if (query.q) {
    chips.push({
      key: "q",
      label: search?.label ?? "Cari",
      value: query.q,
      clear: () => {
        searchText.onChange("");
        list.apply({ q: "", filters: query.filters });
      },
    });
  }
  for (const filter of filters) {
    const value = query.filters[filter.name];
    if (value) chips.push({ key: filter.name, label: filter.label, value: filter.options.find((option) => option.value === value)?.label ?? value, clear: () => choose(filter.name, "") });
  }
  const showChips = (search ? 1 : 0) + filters.length >= CHIPS_FROM;

  return (
    <form
      onSubmit={submit}
      role="search"
      aria-label="Saring daftar"
      className="mb-5 grid grid-cols-1 items-end gap-3 rounded-xl border border-gray-200 bg-white p-4 md:grid-cols-2 lg:grid-cols-4"
    >
      {search && (
        <Labelled label={search.label ?? "Cari"} htmlFor={`${idPrefix}-q`}>
          <Input
            id={`${idPrefix}-q`}
            name="q"
            type="search"
            size="sm"
            value={searchText.value}
            onChange={(event) => searchText.onChange(event.target.value)}
            placeholder={search.placeholder ?? "Cari..."}
            maxLength={48}
            autoComplete="off"
          />
        </Labelled>
      )}
      {filters.map((filter) => (
        <Labelled key={filter.name} label={filter.label} htmlFor={`${idPrefix}-${filter.name}`}>
          <Select
            id={`${idPrefix}-${filter.name}`}
            name={filter.name}
            size="sm"
            value={query.filters[filter.name] ?? ""}
            onChange={(event) => choose(filter.name, event.target.value)}
          >
            <option value="">{filter.allLabel}</option>
            {filter.options.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        </Labelled>
      ))}
      <div className="flex flex-wrap items-center gap-2 md:col-span-2 lg:col-span-1 lg:justify-end">
        {isFiltered(query) && (
          // A button, not a link: the address bar is rewritten by `reset`, the page does not change.
          <Button
            variant="ghost"
            onClick={() => {
              // What was typed and not yet sent goes too, or it would come back after the pause.
              searchText.onChange("");
              list.reset();
            }}
          >
            <X aria-hidden="true" />
            Hapus filter
          </Button>
        )}
        {trailing}
      </div>
      <FilterChips chips={showChips ? chips : []} className="flex flex-wrap gap-2 md:col-span-2 lg:col-span-4" />
    </form>
  );
}
