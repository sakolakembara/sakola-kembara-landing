import { setTransport } from "@shared/spa/api";
import { render } from "@testing-library/react";
import { createMemoryRouter, RouterProvider, useLocation } from "react-router";
import { vi } from "vitest";
import { App } from "~/App";
import { ENDPOINTS } from "~/lib/paths";

export function respond(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

/** The body of `GET /portal/api/me`, as the Worker builds it. */
export function meBody(role = "student", extra: Record<string, unknown> = {}) {
  return { user: { id: "user-1", name: "Sari Dewi", email: "sari@contoh.test", emailVerified: true, role, ...extra } };
}

/** A batch of the overview, with dates around `now`. */
export const NOW = "2026-10-13T03:00:00.000Z";

export function openBatch(extra: Record<string, unknown> = {}) {
  return {
    id: "8b7e0c1a-0000-4000-8000-000000000001",
    year: 2026,
    name: "Gen 6 - 2026/2027",
    description: null,
    opensAt: "2026-10-01T00:00:00.000Z",
    closesAt: "2026-10-23T03:00:00.000Z", // exactly 10 days after NOW
    ...extra,
  };
}

export function overviewBody(extra: Record<string, unknown> = {}) {
  return {
    now: NOW,
    student: { name: "Sari Dewi", firstName: "Sari" },
    openBatch: openBatch(),
    current: { state: "none" },
    history: [],
    ...extra,
  };
}

/** The routes every signed-in test needs. */
export const SIGNED_IN = {
  [`GET ${ENDPOINTS.me}`]: respond(meBody()),
  [`GET ${ENDPOINTS.overview}`]: respond(overviewBody()),
};

export interface Call {
  method: string;
  path: string;
  /** The URL exactly as the page asked for it, query included. */
  url: string;
  /** Request headers, names in lower case. */
  headers: Record<string, string>;
  body: Record<string, unknown> | null;
}

type Handler = Response | ((call: Call) => Response | Promise<Response>);

/**
 * Stands in for the Worker. `routes` is keyed "METHOD /path" (no query). Calls to anything not listed answer 404 and
 * are recorded, so a test can assert that nothing unexpected was requested.
 */
export function stubApi(routes: Record<string, Handler>) {
  const calls: Call[] = [];
  const transport = vi.fn(async (path: string, init: RequestInit) => {
    const url = new URL(path, "http://test.invalid");
    const method = (init.method ?? "GET").toUpperCase();
    const call: Call = {
      method,
      path: url.pathname,
      url: path,
      headers: Object.fromEntries(new Headers(init.headers).entries()),
      body: init.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null,
    };
    calls.push(call);
    const handler = routes[`${method} ${url.pathname}`];
    if (!handler) return respond({ error: "not_found" }, 404);
    return typeof handler === "function" ? handler(call) : handler.clone();
  });
  setTransport(transport);
  return {
    calls,
    count: (route: string) => calls.filter((call) => `${call.method} ${call.path}` === route).length,
    last: (route: string) => calls.filter((call) => `${call.method} ${call.path}` === route).at(-1),
  };
}

/** A promise settled from outside, to hold a request in flight. */
export function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function LocationProbe() {
  const { pathname, search } = useLocation();
  return <span data-testid="location">{`${pathname}${search}`}</span>;
}

/**
 * The whole app at `path` (given as the address bar shows it, "/portal/status"), under a data router with the basename
 * /portal, like main.tsx, with a probe that shows where the router is (relative to the basename: "/status").
 */
export function renderApp(path = "/portal/") {
  const router = createMemoryRouter(
    [
      {
        path: "*",
        element: (
          <>
            <App />
            <LocationProbe />
          </>
        ),
      },
    ],
    { initialEntries: [path], basename: "/portal" },
  );
  return { ...render(<RouterProvider router={router} />), router };
}
