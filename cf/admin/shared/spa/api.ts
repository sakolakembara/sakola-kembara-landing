import { TURNSTILE_HEADER } from "./captcha";

// The client both SPAs (the admin's and the student portal's) call their Worker with. Shared through
// cf/admin/shared/spa; the admin's lib/api.ts re-exports it and keeps the admin-only types.

export interface ApiFailure {
  ok: false;
  /** HTTP status; 0 when the request never got an answer (offline, DNS, blocked). */
  status: number;
  /** Better Auth's `code` or this Worker's `error`, e.g. "EMAIL_NOT_VERIFIED". Never shown to people. */
  code?: string;
  /** The CRUD API's `message` (docs/cloudflare/admin-crud.md#5-errors): Indonesian, ready to show. Missing for the guards' 401 and 403. */
  message?: string;
  /** The CRUD API's `fields`: `{ <field name>: <one Indonesian message> }`, for a 400 `invalid` and a 409 `conflict`. */
  fields?: Record<string, string>;
  /** The first sample's `{ name: string[] }` shape; no endpoint of this app sends it any more. */
  fieldErrors?: Record<string, string[]>;
  /** Seconds from the `Retry-After` header, when the server sent a number. */
  retryAfter?: number;
}

export type ApiResult<T> = { ok: true; data: T } | ApiFailure;

/**
 * How a request leaves the browser. The default is `fetch`. Local development
 * with the mock (`pnpm dev:spa:mock`) and the tests swap it, so no page needs
 * to know where its data comes from.
 */
export type Transport = (path: string, init: RequestInit) => Promise<Response>;

const fetchTransport: Transport = (path, init) => fetch(path, init);
let transport: Transport = fetchTransport;

/** Replaces the transport; `null` puts `fetch` back. */
export function setTransport(next: Transport | null): void {
  transport = next ?? fetchTransport;
}

function retryAfterSeconds(res: Response): number | undefined {
  const raw = res.headers.get("retry-after");
  if (!raw || !/^\d+$/.test(raw.trim())) return undefined; // an HTTP date is not used
  return Number(raw.trim());
}

export interface ApiInit {
  method?: string;
  json?: unknown;
  /** The Turnstile widget's token, for the routes the Worker protects with it. Sent in a header, never in the URL or the body. A token works once. */
  turnstileToken?: string | null;
  /** The `If-Match` of a save or delete: the ETag of the version the person loaded (`ifMatch(updatedAt)` in lib/crud/etag.ts). */
  ifMatch?: string;
  /** Aborts the request (a page that goes away, a search that is replaced). An aborted call answers `{ ok: false, status: 0 }`. */
  signal?: AbortSignal;
}

/** The `fields` of an error body, keeping only `string` values: whatever else arrives is not shown. */
function stringFields(value: unknown): Record<string, string> | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined;
  const entries = Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === "string");
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

const writeListeners = new Set<() => void>();

/**
 * Calls `listener` after every write (any method but GET and HEAD) has finished, whatever its answer: a write that
 * failed on the way may still have reached the server, so whoever keeps copies of the server's answers drops them.
 * A sign-in and a sign-out are writes too. Returns the way to stop listening.
 */
export function onWrite(listener: () => void): () => void {
  writeListeners.add(listener);
  return () => void writeListeners.delete(listener);
}

let inFlight = 0;
const activityListeners = new Set<() => void>();

function moveInFlight(by: 1 | -1): void {
  inFlight += by;
  for (const listener of activityListeners) listener();
}

/** How many calls to the API are waiting for their answer right now (the top progress bar shows it). */
export function requestsInFlight(): number {
  return inFlight;
}

/** Calls `listener` whenever `requestsInFlight()` changes. The shape `useSyncExternalStore` wants: returns the way to stop. */
export function onActivity(listener: () => void): () => void {
  activityListeners.add(listener);
  return () => void activityListeners.delete(listener);
}

/** JSON call to this app's own API. Cookies go along (same origin). Never throws. */
export async function api<T>(path: string, init: ApiInit = {}): Promise<ApiResult<T>> {
  moveInFlight(1);
  const headers: Record<string, string> = {};
  if (init.json !== undefined) headers["Content-Type"] = "application/json";
  if (init.turnstileToken) headers[TURNSTILE_HEADER] = init.turnstileToken;
  if (init.ifMatch) headers["If-Match"] = init.ifMatch;
  try {
    const res = await transport(path, {
      method: init.method ?? "GET",
      headers: Object.keys(headers).length === 0 ? undefined : headers,
      body: init.json === undefined ? undefined : JSON.stringify(init.json),
      credentials: "same-origin",
      signal: init.signal,
    } as RequestInit); // the cast: the Worker's contract tests compile this file with the Workers types, which lack `credentials`
    const body = res.status === 204 ? null : await res.json().catch(() => null);
    if (res.ok) return { ok: true, data: body as T };
    const failure = (body ?? {}) as { error?: string; code?: string; message?: unknown; fields?: unknown; fieldErrors?: Record<string, string[]> };
    return {
      ok: false,
      status: res.status,
      code: failure.code ?? failure.error,
      // Only this Worker's own errors carry a message meant for people. Better Auth's ({ code, message }) is English, for developers.
      message: failure.code === undefined && typeof failure.message === "string" && failure.message.trim() !== "" ? failure.message : undefined,
      fields: stringFields(failure.fields),
      fieldErrors: failure.fieldErrors,
      retryAfter: retryAfterSeconds(res),
    };
  } catch {
    return { ok: false, status: 0 };
  } finally {
    const method = (init.method ?? "GET").toUpperCase();
    if (method !== "GET" && method !== "HEAD") for (const listener of writeListeners) listener();
    moveInFlight(-1);
  }
}
