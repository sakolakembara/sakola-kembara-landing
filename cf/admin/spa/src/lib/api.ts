export type Role = "student" | "viewer" | "editor" | "super_admin";

export interface Me {
  id: string;
  email: string;
  name: string;
  role: Role;
  emailVerified: boolean;
}

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

export type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; status: number; code?: string; fieldErrors?: Record<string, string[]> };

/** JSON call to this app's own API. Cookies go along (same origin). Never throws. */
export async function api<T>(path: string, init: { method?: string; json?: unknown } = {}): Promise<ApiResult<T>> {
  try {
    const res = await fetch(path, {
      method: init.method ?? "GET",
      headers: init.json === undefined ? undefined : { "Content-Type": "application/json" },
      body: init.json === undefined ? undefined : JSON.stringify(init.json),
      credentials: "same-origin",
    });
    const body = res.status === 204 ? null : await res.json().catch(() => null);
    if (res.ok) return { ok: true, data: body as T };
    const failure = (body ?? {}) as { error?: string; code?: string; fieldErrors?: Record<string, string[]> };
    return { ok: false, status: res.status, code: failure.code ?? failure.error, fieldErrors: failure.fieldErrors };
  } catch {
    return { ok: false, status: 0 };
  }
}
