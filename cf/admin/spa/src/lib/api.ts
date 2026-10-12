import { TURNSTILE_HEADER } from "./captcha";

export type Severity = "info" | "warning" | "urgent";

export interface Announcement {
  id: string;
  title: string;
  body: string;
  severity: Severity;
  ctaLabel: string | null;
  ctaUrl: string | null;
  active: boolean;
  startsAt: string | null;
  endsAt: string | null;
  createdAt: string;
}

export interface ApiFailure {
  ok: false;
  /** HTTP status; 0 when the request never got an answer (offline, DNS, blocked). */
  status: number;
  /** Better Auth's `code` or this Worker's `error`, e.g. "EMAIL_NOT_VERIFIED". Never shown to people. */
  code?: string;
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
}

/** JSON call to this app's own API. Cookies go along (same origin). Never throws. */
export async function api<T>(path: string, init: ApiInit = {}): Promise<ApiResult<T>> {
  const headers: Record<string, string> = {};
  if (init.json !== undefined) headers["Content-Type"] = "application/json";
  if (init.turnstileToken) headers[TURNSTILE_HEADER] = init.turnstileToken;
  try {
    const res = await transport(path, {
      method: init.method ?? "GET",
      headers: Object.keys(headers).length === 0 ? undefined : headers,
      body: init.json === undefined ? undefined : JSON.stringify(init.json),
      credentials: "same-origin",
    });
    const body = res.status === 204 ? null : await res.json().catch(() => null);
    if (res.ok) return { ok: true, data: body as T };
    const failure = (body ?? {}) as { error?: string; code?: string; fieldErrors?: Record<string, string[]> };
    return {
      ok: false,
      status: res.status,
      code: failure.code ?? failure.error,
      fieldErrors: failure.fieldErrors,
      retryAfter: retryAfterSeconds(res),
    };
  } catch {
    return { ok: false, status: 0 };
  }
}
