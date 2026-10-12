import { useCallback, useEffect, useState } from "react";
import { api, type ApiFailure } from "../api";
import type { ItemPayload } from "./types";

// One item for an edit screen: `GET <path>` answers `{ item }`. `path` null means "a new one": nothing is
// loaded and the status is `idle`. The request is aborted when the page goes away or the path changes.

export type ItemStatus = "idle" | "loading" | "ready" | "error";

export interface ItemState<T> {
  status: ItemStatus;
  item: T | null;
  /** Why the load failed. A 404 is `failure.status === 404` (the item is gone). */
  failure: ApiFailure | null;
  /** Loads it again: the "Muat ulang" of a stale save, or "Coba lagi". */
  refetch(): void;
  /** Puts in the item a save answered (`PUT` returns `{ item }`), so there is no second request. */
  replace(next: T): void;
}

export function useItem<T>(path: string | null): ItemState<T> {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<{ status: ItemStatus; item: T | null; failure: ApiFailure | null }>({
    status: path === null ? "idle" : "loading",
    item: null,
    failure: null,
  });

  useEffect(() => {
    if (path === null) {
      setState({ status: "idle", item: null, failure: null });
      return;
    }
    const controller = new AbortController();
    setState((previous) => ({ status: "loading", item: previous.item, failure: null }));
    void api<ItemPayload<T>>(path, { signal: controller.signal }).then((result) => {
      if (controller.signal.aborted) return;
      setState(result.ok ? { status: "ready", item: result.data.item, failure: null } : { status: "error", item: null, failure: result });
    });
    return () => controller.abort();
  }, [path, attempt]);

  const refetch = useCallback(() => setAttempt((count) => count + 1), []);
  const replace = useCallback((next: T) => setState({ status: "ready", item: next, failure: null }), []);
  return { ...state, refetch, replace };
}
