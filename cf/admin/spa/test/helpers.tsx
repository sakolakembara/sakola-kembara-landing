import { render } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router";
import { vi } from "vitest";
import { App } from "~/App";
import { setTransport } from "~/lib/api";
import type { Area, Role } from "~/lib/me";
import { areasFor } from "./me-fixtures";

export function respond(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

/** The body of GET /api/me for `role` (and, for an editor, `granted`), as the Worker builds it. */
export function meBody(role: Role, granted: Area[] = [], extra: Record<string, unknown> = {}) {
  return {
    user: { id: "user-1", email: "tester@contoh.test", name: "Tester", role, emailVerified: true, ...extra },
    areas: areasFor(role, granted),
  };
}

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
 * Stands in for the Worker. `routes` is keyed "METHOD /path" (no query). Calls
 * to anything not listed answer 404 and are recorded, so a test can assert that
 * nothing unexpected was requested.
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

/** The whole app at `path`, with a probe that shows where the router is. */
export function renderApp(path = "/") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App />
      <LocationProbe />
    </MemoryRouter>,
  );
}
