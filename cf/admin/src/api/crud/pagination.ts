import { asc, desc, eq, or, sql, type SQL } from "drizzle-orm";
import type { AnySQLiteColumn } from "drizzle-orm/sqlite-core";
import type { Context } from "hono";
import { invalidQuery } from "./errors";

// Lists (docs/cloudflare/admin-crud.md#3-lists-page-pagesize-q-filters-sort).
// Numbers are CLAMPED (a clamped page is harmless); sort names and filter
// values are STRICT (a wrong one silently ignored would show the wrong list),
// so an unknown one is `400 invalid_query`. Nothing from the query ever
// reaches SQL as text: a sort is a lookup in the resource's own whitelist,
// a filter value is compared as a bound parameter, `q` is a bound parameter
// with its LIKE wildcards escaped.

export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;
export const MAX_PAGE = 10_000;
/**
 * Longest `q` kept. D1 refuses a LIKE pattern longer than 50 BYTES ("LIKE or GLOB pattern too complex"),
 * and the pattern is `%` + the text with its wildcards escaped + `%`, so 48 characters is the most that
 * can always fit; `likeContains` trims further when escaping or multi-byte characters make it longer.
 */
export const MAX_SEARCH_LENGTH = 48;
/** D1's limit on the length of a LIKE pattern, in bytes. */
export const MAX_LIKE_PATTERN_BYTES = 50;

/** Reads one query parameter. `reader(c)` makes one from a Hono context; tests pass a plain function. */
export type QueryReader = (name: string) => string | undefined;

export const reader =
  (c: Context): QueryReader =>
  (name) =>
    c.req.query(name);

function positiveInt(value: string | undefined, fallback: number, max: number): number {
  if (value === undefined || !/^\d{1,30}$/.test(value.trim())) return fallback;
  const parsed = Number(value);
  return parsed >= 1 ? Math.min(parsed, max) : fallback;
}

export interface PageRequest {
  /** 1-based, after clamping. */
  page: number;
  /** After clamping. */
  pageSize: number;
  offset: number;
}

/** `page` and `pageSize` from the query: 1 and 20 when missing or not a positive integer, `pageSize` at most 100, `page` at most 10,000. */
export function parsePage(read: QueryReader, options: { defaultPageSize?: number; maxPageSize?: number } = {}): PageRequest {
  const maxPageSize = options.maxPageSize ?? MAX_PAGE_SIZE;
  const page = positiveInt(read("page"), 1, MAX_PAGE);
  const pageSize = positiveInt(read("pageSize"), Math.min(options.defaultPageSize ?? DEFAULT_PAGE_SIZE, maxPageSize), maxPageSize);
  return { page, pageSize, offset: (page - 1) * pageSize };
}

export interface ListEnvelope<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}

/** The list envelope: `{ items, page, pageSize, total }`. `page` and `pageSize` are the clamped values the query used. */
export function pageOf<T>(items: T[], request: Pick<PageRequest, "page" | "pageSize">, total: number): ListEnvelope<T> {
  return { items, page: request.page, pageSize: request.pageSize, total };
}

// ---------------------------------------------------------------------- sort

export interface SortSpec {
  /** Public name -> column. The only names a client may sort by. */
  sorts: Record<string, AnySQLiteColumn>;
  /** `name` ascending or `-name` descending; must be in `sorts`. */
  defaultSort: string;
  /** Last tie-breaker, so pages never overlap: the primary key. */
  id: AnySQLiteColumn;
}

export type SortResult = { ok: true; sort: string; order: SQL[] } | { ok: false };

/** `sort=<name>` or `sort=-<name>`. Missing or empty is the default; a name outside the whitelist is refused. */
export function parseSort(raw: string | undefined, spec: SortSpec): SortResult {
  const wanted = raw === undefined || raw === "" ? spec.defaultSort : raw;
  const descending = wanted.startsWith("-");
  const name = descending ? wanted.slice(1) : wanted;
  if (!Object.hasOwn(spec.sorts, name)) return { ok: false };
  const column = spec.sorts[name]!;
  return { ok: true, sort: wanted, order: [descending ? desc(column) : asc(column), asc(spec.id)] };
}

// -------------------------------------------------------------------- search

/** Trimmed and cut to 48 characters (see `MAX_SEARCH_LENGTH`); empty means "no search". */
export function parseSearch(raw: string | undefined): string {
  return (raw ?? "").trim().slice(0, MAX_SEARCH_LENGTH);
}

const LIKE_ESCAPE = "!";

/** `%`, `_` and the escape character match only themselves. */
export function escapeLike(text: string): string {
  return text.replace(/[!%_]/g, (character) => `${LIKE_ESCAPE}${character}`);
}

/**
 * `column LIKE '%q%' ESCAPE '!'` over each column, ORed. Case-insensitive for ASCII only (SQLite's rule).
 * It cannot use an index: it reads every row of the table, so use it only on tables that stay small
 * (see "Search cost" in the doc).
 */
export function likeContains(columns: readonly AnySQLiteColumn[], q: string): SQL | undefined {
  if (q === "" || columns.length === 0) return undefined;
  const pattern = likePattern(q);
  return pattern === null ? undefined : or(...columns.map((column) => sql`${column} like ${pattern} escape '!'`));
}

const encoder = new TextEncoder();

/**
 * `%q%` with the wildcards of `q` escaped, trimmed from the end until it is at most 50 bytes (D1's limit).
 * A longer search therefore becomes a search for its first characters: broader, never an error.
 */
export function likePattern(q: string): string | null {
  for (let text = q; text.length > 0; text = text.slice(0, -1)) {
    const pattern = `%${escapeLike(text)}%`;
    if (encoder.encode(pattern).length <= MAX_LIKE_PATTERN_BYTES) return pattern;
  }
  return null;
}

// ------------------------------------------------------------------- filters

export type FilterResult = { ok: true; where: SQL } | { ok: false };
/** One filter of a resource: the raw query value in, a `WHERE` fragment (or a refusal) out. */
export type Filter = (raw: string) => FilterResult;

/** `?status=pending`: equal to one of `values`; anything else is refused. */
export function enumFilter(column: AnySQLiteColumn, values: readonly string[]): Filter {
  return (raw) => (values.includes(raw) ? { ok: true, where: eq(column, raw) } : { ok: false });
}

/** `?active=true` or `?active=false` on a boolean column. */
export function booleanFilter(column: AnySQLiteColumn): Filter {
  return (raw) => (raw === "true" || raw === "false" ? { ok: true, where: eq(column, raw === "true") } : { ok: false });
}

// ------------------------------------------------------------------ the lot

export interface ListSpec extends SortSpec {
  /** Columns the free-text `q` looks in. None: `q` is ignored. */
  search?: readonly AnySQLiteColumn[];
  /** Query parameter name -> filter. An empty value means "no filter". */
  filters?: Record<string, Filter>;
  /** A resource may lower these (a list whose rows are heavy) but never raise the maximum above 100. */
  defaultPageSize?: number;
  maxPageSize?: number;
}

export interface ListQuery extends PageRequest {
  q: string;
  sort: string;
  order: SQL[];
  /** The `WHERE` of both statements of a list (the page and the count). */
  where: SQL | undefined;
}

export type ListQueryResult = { ok: true; query: ListQuery } | { ok: false; response: Response };

/** All of the above for one resource, or the `400 invalid_query` to return. */
export function parseListQuery(c: Context, spec: ListSpec, read: QueryReader = reader(c)): ListQueryResult {
  const request = parsePage(read, { defaultPageSize: spec.defaultPageSize, maxPageSize: spec.maxPageSize });
  const sorted = parseSort(read("sort"), spec);
  if (!sorted.ok) return { ok: false, response: invalidQuery(c, "sort") };

  const parts: SQL[] = [];
  for (const [name, filter] of Object.entries(spec.filters ?? {})) {
    const raw = read(name);
    if (raw === undefined || raw === "") continue;
    const result = filter(raw);
    if (!result.ok) return { ok: false, response: invalidQuery(c, name) };
    parts.push(result.where);
  }
  const q = parseSearch(read("q"));
  const searched = likeContains(spec.search ?? [], q);
  if (searched) parts.push(searched);

  const where = parts.length === 0 ? undefined : parts.length === 1 ? parts[0] : sql.join(parts.map((part) => sql`(${part})`), sql` and `);
  return { ok: true, query: { ...request, q, sort: sorted.sort, order: sorted.order, where } };
}
