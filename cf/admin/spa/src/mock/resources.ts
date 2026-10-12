import type { Access } from "~/lib/access";
import { ifMatch } from "~/lib/crud/etag";
import type { AdminArea } from "~/lib/me";

// MOCK, local development only (see mock/install.ts). A generic in-memory store that answers the admin CRUD
// contract (docs/cloudflare/admin-crud.md) for any resource that registers itself, so a screen can be built and
// reviewed without the Worker: list (`page`, `pageSize`, `q`, filters, `sort`), `GET /:id`, create (201),
// update (`If-Match`, 409 stale), delete (204, 409 in_use), validation as the 400 shape, and 403 for a persona
// that cannot read or write the resource's area. Nothing leaves memory.
//
// To mock a resource, add ONE file `mock/resources/<name>.ts` with a `default` export of a `MockResource` (or an
// array of them): `mock/registry.ts` picks every file of that folder up, so there is no central list to edit and
// parallel workers do not conflict. `mock/resources/announcements.ts` is the worked one.

/** What every mocked row has: the id, and the two dates (ISO strings) the version and the default sort come from. */
export interface MockRowBase {
  id: string;
  createdAt: string;
  updatedAt: string;
}

/** The same row seen as a bag of fields, for the generic code below. */
type MockRow = MockRowBase & Record<string, unknown>;

export type MockParse<T> = { ok: true; values: Partial<T> } | { ok: false; fields: Record<string, string> };

export interface MockResource<T extends MockRowBase = MockRowBase> {
  /** The collection: `/api/admin/reports`. */
  path: string;
  /** Who may read (any access) and write (`write`): the persona's `accessTo`. */
  area: AdminArea;
  /** The rows to start with. Called once per page load. */
  seed: () => T[];
  /** The fields `q` looks in (case-insensitive contains). */
  search?: readonly (keyof T & string)[];
  /** Filter parameter -> the values it accepts (as the query string spells them: a boolean is "true" or "false"). */
  filters?: Record<string, readonly string[]>;
  /** The sort names (without `-`) and the default (`-createdAt`). Only whitelisted names are accepted, like the Worker. */
  sorts?: readonly string[];
  defaultSort?: string;
  /** The Worker's schema, in miniature: the values to store, or `{ field: message }` in Indonesian. */
  parse(body: Record<string, unknown>): MockParse<T>;
  /** A delete is refused (409 in_use) with these menu names while this returns some. */
  inUse?: (row: T) => readonly string[] | null;
  /**
   * An answer the generic store cannot give: a verb below an item (`POST /:id/publish`), or a list or an item of a
   * different shape (a detail with counts). Called AFTER the access check (a persona that cannot read or write
   * the area never gets here) with what is below the collection: `""` for the collection, `"abc"` for an item,
   * `"abc/publish"` for a verb. Return the Response, or `null` to let the generic store answer. `rows` is the
   * store's own array: a custom answer may read and change it.
   */
  custom?: (request: MockRequest<T>) => Response | null;
}

/** What `custom` is given. `rest` is the path below the collection, as the request has it (not decoded). */
export interface MockRequest<T extends MockRowBase = MockRowBase> {
  method: string;
  rest: string;
  url: URL;
  init: RequestInit;
  rows: T[];
  access: Access;
}

/** A resource of any row type, for the list of all of them. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyMockResource = MockResource<any>;

export type AccessOf = (area: AdminArea) => Access;

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(status === 204 ? null : JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });

const error = (status: number, code: string, message?: string, extra: Record<string, unknown> = {}) => json({ error: code, ...(message ? { message } : {}), ...extra }, status);

/** For a `custom` handler: the same JSON answers the generic store gives. */
export { error as mockError, json as mockJson };

function positiveInt(raw: string | null, fallback: number, max: number): number {
  if (raw === null || !/^\d{1,30}$/.test(raw.trim())) return fallback;
  const value = Number(raw);
  return value >= 1 ? Math.min(value, max) : fallback;
}

function bodyOf(init: RequestInit): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(String(init.body ?? "null"));
    return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function compare(a: unknown, b: unknown): number {
  if (a === b) return 0;
  if (a === null || a === undefined) return -1;
  if (b === null || b === undefined) return 1;
  return String(a) < String(b) ? -1 : 1;
}

/**
 * The handler of every registered resource. `handle` returns the Response for a request that belongs to one,
 * or null when the path is nobody's (the transport then answers its own 404).
 */
export function createMockResources(resources: readonly AnyMockResource[], accessOf: AccessOf) {
  const stores = resources.map((spec) => ({ spec, rows: spec.seed() as MockRow[], counter: 0 }));

  function handle(method: string, url: URL, init: RequestInit): Response | null {
    for (const store of stores) {
      const { spec } = store;
      const rest = url.pathname === spec.path ? "" : url.pathname.startsWith(`${spec.path}/`) ? url.pathname.slice(spec.path.length + 1) : null;
      if (rest === null) continue;
      // Something below an item (a verb) is for `custom` alone.
      if (rest.includes("/") && !spec.custom) continue;
      return answer(store, method, rest, url, init);
    }
    return null;
  }

  function answer(store: (typeof stores)[number], method: string, rest: string, url: URL, init: RequestInit): Response {
    const { spec } = store;
    const access = accessOf(spec.area);
    const writes = method !== "GET";
    // The Worker's guard: reads need any access to the area, writes need `write`.
    if (access === "none" || (writes && access !== "write")) return error(403, "forbidden");

    const custom = spec.custom?.({ method, rest, url, init, rows: store.rows as never, access });
    if (custom) return custom;
    if (rest.includes("/")) return error(404, "not_found");
    const id = rest === "" ? null : decodeURIComponent(rest);

    if (id === null) {
      if (method === "GET") return list(store, url);
      if (method === "POST") return create(store, init);
      return error(404, "not_found");
    }

    const row = store.rows.find((candidate) => candidate.id === id);
    if (method === "GET") return row ? json({ item: row }, 200, { ETag: ifMatch(row.updatedAt) }) : error(404, "not_found", "Data tidak ditemukan. Mungkin sudah dihapus.");
    if (method === "PUT") return update(store, row, init);
    if (method === "DELETE") return remove(store, row, init);
    return error(404, "not_found");
  }

  function list(store: (typeof stores)[number], url: URL): Response {
    const { spec } = store;
    const params = url.searchParams;
    const page = positiveInt(params.get("page"), 1, 10_000);
    const pageSize = positiveInt(params.get("pageSize"), 20, 100);

    const wanted = params.get("sort") || spec.defaultSort || "-createdAt";
    const name = wanted.startsWith("-") ? wanted.slice(1) : wanted;
    const allowed = new Set([...(spec.sorts ?? []), ...(spec.defaultSort ? [spec.defaultSort.replace(/^-/, "")] : ["createdAt"])]);
    if (!allowed.has(name)) return error(400, "invalid_query", "Pencarian atau penyaringan tidak dikenal.", { param: "sort" });

    let rows = [...store.rows];
    for (const [filter, values] of Object.entries(spec.filters ?? {})) {
      const raw = params.get(filter);
      if (!raw) continue;
      if (!values.includes(raw)) return error(400, "invalid_query", "Pencarian atau penyaringan tidak dikenal.", { param: filter });
      rows = rows.filter((row) => String(row[filter]) === raw);
    }
    const q = (params.get("q") ?? "").trim().slice(0, 48).toLowerCase();
    if (q && spec.search?.length) rows = rows.filter((row) => spec.search!.some((field) => String(row[field] ?? "").toLowerCase().includes(q)));

    const direction = wanted.startsWith("-") ? -1 : 1;
    rows.sort((a, b) => direction * compare(a[name], b[name]) || compare(a.id, b.id));
    const total = rows.length;
    return json({ items: rows.slice((page - 1) * pageSize, page * pageSize), page, pageSize, total });
  }

  function create(store: (typeof stores)[number], init: RequestInit): Response {
    const body = bodyOf(init);
    if (!body) return error(400, "invalid_json", "Isi permintaan bukan JSON yang valid.");
    const parsed = store.spec.parse(body);
    if (!parsed.ok) return error(400, "invalid", "Periksa kembali isian formulir.", { fields: parsed.fields });
    store.counter += 1;
    const now = new Date().toISOString();
    const row: MockRow = { ...(parsed.values as Record<string, unknown>), id: `mock-${store.spec.path.split("/").pop()}-${store.counter}`, createdAt: now, updatedAt: now };
    store.rows.unshift(row);
    return json({ item: row }, 201, { ETag: ifMatch(row.updatedAt) });
  }

  function update(store: (typeof stores)[number], row: MockRow | undefined, init: RequestInit): Response {
    const precondition = new Headers(init.headers).get("If-Match");
    if (precondition === null) return error(428, "precondition_required", "Versi data tidak disertakan. Muat ulang halaman lalu coba lagi.");
    const body = bodyOf(init);
    if (!body) return error(400, "invalid_json", "Isi permintaan bukan JSON yang valid.");
    const parsed = store.spec.parse(body);
    if (!parsed.ok) return error(400, "invalid", "Periksa kembali isian formulir.", { fields: parsed.fields });
    if (!row) return error(404, "not_found", "Data tidak ditemukan. Mungkin sudah dihapus.");
    if (precondition !== ifMatch(row.updatedAt)) return error(409, "stale", "Data ini sudah diubah orang lain sejak kamu membukanya. Muat ulang untuk melihat versi terbaru.");
    // A later instant than the last one, even in the same millisecond.
    const next = new Date(Math.max(Date.now(), Date.parse(row.updatedAt) + 1)).toISOString();
    Object.assign(row, parsed.values, { updatedAt: next });
    return json({ item: row }, 200, { ETag: ifMatch(row.updatedAt) });
  }

  function remove(store: (typeof stores)[number], row: MockRow | undefined, init: RequestInit): Response {
    if (!row) return error(404, "not_found", "Data tidak ditemukan. Mungkin sudah dihapus.");
    const precondition = new Headers(init.headers).get("If-Match");
    if (precondition !== null && precondition !== ifMatch(row.updatedAt)) return error(409, "stale", "Data ini sudah diubah orang lain sejak kamu membukanya. Muat ulang untuk melihat versi terbaru.");
    const users = store.spec.inUse?.(row);
    if (users && users.length > 0) return error(409, "in_use", `Masih dipakai di: ${users.join(", ")}. Lepaskan dulu dari sana.`, { usedBy: [...users] });
    store.rows.splice(store.rows.indexOf(row), 1);
    return json(null, 204);
  }

  return { handle, rows: (path: string) => stores.find((store) => store.spec.path === path)?.rows ?? [] };
}
