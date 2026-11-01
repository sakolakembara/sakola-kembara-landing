import { Search } from "lucide-react";
import { Input, Select } from "~/components/ui/field";
import { cleanSearch } from "~/lib/crud/query";
import { MEDIA_RANGES, type MediaQuery, type MediaRange, type MediaTypeFilter } from "~/lib/crud/media";
import { useDraftText } from "~/lib/crud/useDraftText";

/** Quiet time after the last keystroke before the search is asked for (the same as the lists'). */
const SEARCH_DELAY_MS = 350;

export interface MediaFiltersProps {
  query: Pick<MediaQuery, "q" | "type" | "range">;
  onChange(patch: Partial<Pick<MediaQuery, "q" | "type" | "range">>): void;
  /** A "Semua jenis" choice (image or PDF): only where the files can be both. */
  withType: boolean;
  /** Where the search is the whole bar (a picker): no date window. */
  withRange?: boolean;
  /** Two bars never share a page, but a picker opens over the page's own: the ids must differ. */
  idPrefix: string;
}

/** The search and both selects are one width and no wider (Dzul, 2026-11-01); a full row each on a phone. */
const CONTROL = "min-w-0 max-w-full max-sm:basis-full sm:w-64";

/** The search, the type and the date window above a library's files: the page's and the picker's. */
export function MediaFilters({ query, onChange, withType, withRange = true, idPrefix }: MediaFiltersProps) {
  const search = useDraftText(query.q, (q) => onChange({ q }), { delay: SEARCH_DELAY_MS, clean: cleanSearch });
  return (
    <div role="search" aria-label="Saring media" className="flex flex-wrap items-center gap-3">
      <div className={`relative ${CONTROL}`}>
        <Search size={16} aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <Input
          id={`${idPrefix}-q`}
          type="search"
          size="sm"
          aria-label="Cari nama file atau teks alternatif"
          placeholder="Cari nama file atau teks alt"
          value={search.value}
          onChange={(event) => search.onChange(event.target.value)}
          onKeyDown={(event) => {
            // Enter asks for the search at once. It must not do more: a picker is used from inside forms.
            if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
            event.preventDefault();
            search.flush();
          }}
          maxLength={48}
          autoComplete="off"
          className="pl-9"
        />
      </div>
      {withType && (
        <Select
          id={`${idPrefix}-type`}
          size="sm"
          aria-label="Jenis file"
          value={query.type}
          onChange={(event) => onChange({ type: event.target.value as MediaTypeFilter, q: search.take() })}
          className={CONTROL}
        >
          <option value="">Semua jenis</option>
          <option value="image">Gambar</option>
          <option value="pdf">PDF</option>
        </Select>
      )}
      {withRange && (
        <Select
          id={`${idPrefix}-range`}
          size="sm"
          aria-label="Tanggal unggah"
          value={query.range}
          onChange={(event) => onChange({ range: event.target.value as MediaRange, q: search.take() })}
          className={CONTROL}
        >
          <option value="">Semua tanggal</option>
          {MEDIA_RANGES.map((range) => (
            <option key={range.value} value={range.value}>
              {range.label}
            </option>
          ))}
        </Select>
      )}
    </div>
  );
}
