import { useCallback, useEffect, useState } from "react";
import { type ApiResult, api } from "./api";
import { cachedRead, keepRead, readCacheVersion } from "./crud/readCache";
import { type Dashboard, parseDashboard } from "./dashboard";

// The hook that fetches `GET /api/dashboard`. The contract and the parser are in
// lib/dashboard.ts, which stays free of React and `fetch` so the Worker's tests
// can read the real answer through the same parser. The last answer is kept in
// memory (lib/crud/readCache.ts): coming back to the dashboard shows it at once
// and asks again, instead of starting from grey blocks every time.
//
// On a page load the session (`GET /api/me`) and the dashboard leave together: `RequireAuth` calls
// `prefetchDashboard()` when it mounts, so the sidebar's counts arrive with the shell instead of a request after it.
// There is only ever one request on its way (the shell that mounts joins it), and a shell that mounts just after
// the answer came has nothing to ask.

const PATH = "/api/dashboard";

export type DashboardState =
  | { status: "loading" }
  /** `at` is when the Worker answered (ms since 1970): missing while the data is the last answer shown from memory. */
  | { status: "ready"; data: Dashboard; at?: number }
  /** The server has no dashboard endpoint (404 or 501): not an error to retry. */
  | { status: "unavailable" }
  | { status: "error" };

/** A shell that mounts within this long of the prefetch's answer takes it as this visit's answer. */
const FRESH_MS = 3_000;

let inFlight: { answer: Promise<ApiResult<unknown>>; version: number } | null = null;

/**
 * The request on its way, or a new one. `version` is the cache's, read as the request leaves (`keepRead` refuses an
 * answer a write has outdated): a request that left before a write is not joined either, since its answer predates it.
 */
function ask() {
  if (!inFlight || inFlight.version !== readCacheVersion()) {
    const current = { answer: api<unknown>(PATH), version: readCacheVersion() };
    inFlight = current;
    void current.answer.finally(() => {
      if (inFlight === current) inFlight = null;
    });
  }
  return inFlight;
}

/** What an answer comes to as a state; an answer with data is also kept for the next visit. */
function settle(result: ApiResult<unknown>, version: number): DashboardState {
  if (result.ok) {
    const data = parseDashboard(result.data);
    if (!data) return { status: "error" };
    keepRead(PATH, data, version);
    return { status: "ready", data, at: Date.now() };
  }
  return result.status === 404 || result.status === 501 ? { status: "unavailable" } : { status: "error" };
}

// What the prefetch came to, whatever it was (a server without the endpoint says so once, not twice).
let prefetched: { state: DashboardState; at: number; version: number } | null = null;

/** The prefetch's outcome, while it is this visit's: recent, and no write since. */
function fresh(): DashboardState | undefined {
  return prefetched && prefetched.version === readCacheVersion() && Date.now() - prefetched.at < FRESH_MS ? prefetched.state : undefined;
}

/** Starts the request for the signed-in shell (with the session's own), and keeps its outcome for the shell to find. */
export function prefetchDashboard(): void {
  const { answer, version } = ask();
  void answer.then((result) => {
    prefetched = { state: settle(result, version), at: Date.now(), version };
  });
}

function remembered(): DashboardState {
  const data = cachedRead<Dashboard>(PATH);
  return data ? { status: "ready", data } : { status: "loading" };
}

export function useDashboard(): { state: DashboardState; reload: () => void } {
  const [state, setState] = useState<DashboardState>(() => fresh() ?? remembered());
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    // The prefetch asked with the session and has its answer already: it is this visit's, shown with its time.
    const adopted = attempt === 0 ? fresh() : undefined;
    // Taken: the outcome belongs to the first shell that finds it, a later mount asks for itself.
    if (adopted) prefetched = null;
    setState(adopted ?? remembered());
    if (adopted) return;
    const { answer, version } = ask();
    void answer.then((result) => {
      if (!cancelled) setState(settle(result, version));
    });
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  const reload = useCallback(() => setAttempt((n) => n + 1), []);
  return { state, reload };
}
