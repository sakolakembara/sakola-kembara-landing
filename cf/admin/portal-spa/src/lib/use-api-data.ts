import { type ApiFailure, api } from "@shared/spa/api";
import { useCallback, useEffect, useState } from "react";
import { useSession } from "./session";

/** What a page that reads one thing from the API shows. */
export type Loaded<T> = { status: "loading" } | { status: "ready"; data: T } | { status: "error"; failure: ApiFailure | null };

/**
 * Reads `path` once when the page opens (and again on `reload`), and turns the answer with `parse`. A body `parse`
 * does not recognise is an error, not a page of blanks. A 401 means the session ended while the page was open: it is
 * not shown as an error, it sends the student back to the sign-in page (the session provider does that).
 */
export function useApiData<T>(path: string, parse: (raw: unknown) => T | null): { state: Loaded<T>; reload: () => void } {
  const { expire } = useSession();
  const [state, setState] = useState<Loaded<T>>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });
    void api<unknown>(path).then((result) => {
      if (cancelled) return;
      if (result.ok) {
        const data = parse(result.data);
        setState(data === null ? { status: "error", failure: null } : { status: "ready", data });
      } else if (result.status === 401) {
        expire();
      } else {
        setState({ status: "error", failure: result });
      }
    });
    return () => {
      cancelled = true;
    };
    // `parse` is a module-level function of the page: listing it would only restart the request when a caller passes a new closure.
  }, [path, attempt, expire]);

  const reload = useCallback(() => setAttempt((n) => n + 1), []);
  return { state, reload };
}
