import { useCallback, useEffect, useState } from "react";
import { api } from "./api";
import { type Dashboard, parseDashboard } from "./dashboard";

// The hook that fetches `GET /api/dashboard`. The contract and the parser are in
// lib/dashboard.ts, which stays free of React and `fetch` so the Worker's tests
// can read the real answer through the same parser.

export type DashboardState =
  | { status: "loading" }
  | { status: "ready"; data: Dashboard }
  /** The server has no dashboard endpoint (404 or 501): not an error to retry. */
  | { status: "unavailable" }
  | { status: "error" };

export function useDashboard(): { state: DashboardState; reload: () => void } {
  const [state, setState] = useState<DashboardState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });
    api<unknown>("/api/dashboard").then((result) => {
      if (cancelled) return;
      if (result.ok) {
        const data = parseDashboard(result.data);
        setState(data ? { status: "ready", data } : { status: "error" });
      } else if (result.status === 404 || result.status === 501) {
        setState({ status: "unavailable" });
      } else {
        setState({ status: "error" });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  const reload = useCallback(() => setAttempt((n) => n + 1), []);
  return { state, reload };
}
