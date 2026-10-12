// The query of a list, kept in the URL (docs/cloudflare/admin-crud.md#3-lists-page-pagesize-q-filters-sort).
// Pure: no DOM, no React. The Worker's contract test imports it to send what the SPA would send.
//
// The URL is the state: reload, back and a shared link keep the page, the search, the filters and the
// sort. Defaults are left out of the URL (`/announcements`, not `/announcements?page=1`).

export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE = 10_000;
/** The Worker cuts `q` here (D1 refuses a LIKE pattern over 50 bytes, src/api/crud/pagination.ts). */
export const MAX_SEARCH_LENGTH = 48;

/** What a resource's list screen offers. */
export interface ListSpec {
  /** The filter parameters of the resource (`severity`, `active`). */
  filters?: readonly string[];
  /** The sort names the resource whitelists, without the `-`. */
  sorts?: readonly string[];
  /** `name` or `-name`; sent to the API every time, so the screen and the server never disagree. */
  defaultSort?: string;
  /** Rows per page; 20 when left out. At most 100. */
  pageSize?: number;
}

export interface ListQuery {
  /** 1-based. */
  page: number;
  /** The free-text search, trimmed. */
  q: string;
  /** `name` or `-name`; "" when the resource has no sorts. */
  sort: string;
  /** Only the filters that have a value. */
  filters: Record<string, string>;
}

function positiveInt(raw: string | null, max: number): number {
  if (raw === null || !/^\d{1,9}$/.test(raw)) return 1;
  const value = Number(raw);
  return value >= 1 ? Math.min(value, max) : 1;
}

export function cleanSearch(raw: string): string {
  return raw.trim().slice(0, MAX_SEARCH_LENGTH);
}

/** The query of the address bar, with whatever is unknown or malformed replaced by the default. */
export function parseListQuery(params: URLSearchParams, spec: ListSpec = {}): ListQuery {
  const sorts = spec.sorts ?? [];
  const wanted = params.get("sort") ?? "";
  const known = sorts.includes(wanted.startsWith("-") ? wanted.slice(1) : wanted);
  const filters: Record<string, string> = {};
  for (const name of spec.filters ?? []) {
    const value = params.get(name)?.trim();
    if (value) filters[name] = value;
  }
  return {
    page: positiveInt(params.get("page"), MAX_PAGE),
    q: cleanSearch(params.get("q") ?? ""),
    sort: known && wanted !== "" ? wanted : (spec.defaultSort ?? ""),
    filters,
  };
}

/** The address-bar form of a query: defaults are omitted. */
export function toSearchParams(query: ListQuery, spec: ListSpec = {}): URLSearchParams {
  const params = new URLSearchParams();
  if (query.q) params.set("q", query.q);
  for (const name of spec.filters ?? []) {
    const value = query.filters[name];
    if (value) params.set(name, value);
  }
  if (query.sort && query.sort !== (spec.defaultSort ?? "")) params.set("sort", query.sort);
  if (query.page > 1) params.set("page", String(query.page));
  return params;
}

/** The query string of the API request (`?page=2&pageSize=20&q=...&sort=...`). Everything the screen means is sent explicitly. */
export function toApiQuery(query: ListQuery, spec: ListSpec = {}): string {
  const params = new URLSearchParams();
  params.set("page", String(query.page));
  params.set("pageSize", String(spec.pageSize ?? DEFAULT_PAGE_SIZE));
  if (query.q) params.set("q", query.q);
  for (const [name, value] of Object.entries(query.filters)) params.set(name, value);
  if (query.sort) params.set("sort", query.sort);
  return `?${params.toString()}`;
}

export function totalPages(total: number, pageSize: number): number {
  return Math.max(1, Math.ceil(total / Math.max(1, pageSize)));
}

/** True when anything narrows the list: what decides between "Belum ada ..." and "Tidak ada yang cocok ...". */
export function isFiltered(query: ListQuery): boolean {
  return query.q !== "" || Object.keys(query.filters).length > 0;
}

/** The numbers of a pagination bar: all of them up to 7, otherwise the ends and the neighbours of the current page, with gaps as "…". Same rule as the legacy Aktivitas page. */
export function pageNumbers(current: number, total: number): (number | "…")[] {
  if (total <= 7) return Array.from({ length: total }, (_, index) => index + 1);
  const out: (number | "…")[] = [1];
  const start = Math.max(2, current - 1);
  const end = Math.min(total - 1, current + 1);
  if (start > 2) out.push("…");
  for (let page = start; page <= end; page++) out.push(page);
  if (end < total - 1) out.push("…");
  out.push(total);
  return out;
}
