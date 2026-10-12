import { FILTER_ACTIONS, FILTER_RESOURCE_TYPES } from "~/lib/audit";

// What the Aktivitas screen shares: the API's shapes and the query kept in the address bar
// (docs/cloudflare/admin-sistem.md). Pure: no DOM, no React.
//
// The list has a CURSOR, not pages: the address bar holds the filters and, on any page but the first, the
// `cursor` the previous answer gave. So "Berikutnya" is a link, the browser's Back button is "Sebelumnya", and a
// page can be copied and sent. Nothing is counted: there is no "of 1,204 entries" and no page 7 to jump to.

export const API_PATH = "/api/admin/audit";
export const ROUTE = "/audit";
/** The legacy page size, and the Worker's default. */
export const PAGE_SIZE = 50;

/** A row as `GET /api/admin/audit` answers it (src/api/audit.ts). */
export interface AuditItem {
  id: string;
  createdAt: string;
  action: string;
  actorEmail: string;
  /** An admin's name; null for a student, a visitor, or an actor that no longer exists. */
  actorName: string | null;
  resourceType: string | null;
  resourceId: string | null;
  /** The part of the row's metadata the Worker allows: column names, a label, a few admin keys. */
  details: Record<string, unknown> | null;
}

export interface AuditPayload {
  items: AuditItem[];
  pageSize: number;
  /** Pass it back as `cursor` for the next, older page; null on the last. */
  nextCursor: string | null;
}

export interface AuditQuery {
  action: string;
  resource: string;
  /** An email address, whole. */
  actor: string;
  /** A day, `YYYY-MM-DD` (the whole day in WIB, on the Worker). */
  from: string;
  to: string;
  /** "" on the first page. */
  cursor: string;
}

export const EMPTY_QUERY: AuditQuery = { action: "", resource: "", actor: "", from: "", to: "", cursor: "" };

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const CURSOR = /^[A-Za-z0-9_-]{1,200}$/;
const MAX_ACTOR = 254;

/**
 * The query of the address bar. A value the page could not have put there (an action that is not offered, a date
 * that is not a date, a cursor that is not made of cursor characters) is dropped instead of sent: a hand-edited
 * address shows the first page, not an error.
 */
export function parseAuditQuery(params: URLSearchParams): AuditQuery {
  const action = params.get("action") ?? "";
  const resource = params.get("resource") ?? "";
  const from = params.get("from") ?? "";
  const to = params.get("to") ?? "";
  const cursor = params.get("cursor") ?? "";
  return {
    action: (FILTER_ACTIONS as readonly string[]).includes(action) ? action : "",
    resource: (FILTER_RESOURCE_TYPES as readonly string[]).includes(resource) ? resource : "",
    actor: (params.get("actor") ?? "").trim().slice(0, MAX_ACTOR),
    from: DAY.test(from) ? from : "",
    to: DAY.test(to) ? to : "",
    cursor: CURSOR.test(cursor) ? cursor : "",
  };
}

/** The address-bar form: what is empty is left out, so the first page is `/audit`. */
export function toSearchParams(query: AuditQuery): URLSearchParams {
  const params = new URLSearchParams();
  for (const key of ["action", "resource", "actor", "from", "to", "cursor"] as const) {
    if (query[key]) params.set(key, query[key]);
  }
  return params;
}

/** The query string of the API request. The page size is always sent, so the screen and the Worker never disagree. */
export function toApiQuery(query: AuditQuery): string {
  const params = new URLSearchParams({ pageSize: String(PAGE_SIZE) });
  for (const [key, value] of toSearchParams(query)) params.set(key, value);
  return `?${params.toString()}`;
}

/** Anything narrows the list (the cursor does not: it is a place in it). Decides "Belum ada" or "Tidak ada yang cocok". */
export function isFiltered(query: AuditQuery): boolean {
  return query.action !== "" || query.resource !== "" || query.actor !== "" || query.from !== "" || query.to !== "";
}
