import { useCallback, useEffect, useState } from "react";
import { api, type ApiFailure } from "~/lib/api";
import { cachedRead, keepRead, readCacheVersion } from "~/lib/crud/readCache";
import type { LoadState } from "~/lib/crud/types";
import { API_PATH, type AuditItem, type AuditPayload, type AuditQuery, toApiQuery } from "./model";

// The data of the Aktivitas screen. Same habits as the kit's `useList` (aborts the request in flight when the query
// changes or the page goes away, keeps the rows of the page before while the next loads), for a list with a
// cursor: there is no total and no page number to keep.

export interface AuditList {
  status: LoadState;
  items: AuditItem[];
  /** The cursor of the next, older page; null on the last. */
  nextCursor: string | null;
  failure: ApiFailure | null;
  /** A load is in flight and there are rows from the one before to show. */
  refreshing: boolean;
  refetch(): void;
}

interface Loaded {
  status: LoadState;
  data: AuditPayload | null;
  failure: ApiFailure | null;
}

export function useAuditList(query: AuditQuery): AuditList {
  const apiQuery = toApiQuery(query);
  const [attempt, setAttempt] = useState(0);
  // A query opened before shows its last answer from the first paint (lib/crud/readCache.ts) while it is asked for again.
  const [loaded, setLoaded] = useState<Loaded>(() => {
    const kept = cachedRead<AuditPayload>(`${API_PATH}${apiQuery}`);
    return kept ? { status: "ready", data: kept, failure: null } : { status: "loading", data: null, failure: null };
  });
  const [pending, setPending] = useState(true);

  useEffect(() => {
    const controller = new AbortController();
    const path = `${API_PATH}${apiQuery}`;
    const kept = cachedRead<AuditPayload>(path);
    const version = readCacheVersion();
    setPending(true);
    setLoaded((previous) =>
      kept ? { status: "ready", data: kept, failure: null } : { ...previous, status: previous.data ? "ready" : "loading", failure: null },
    );
    void api<AuditPayload>(path, { signal: controller.signal }).then((result) => {
      if (controller.signal.aborted) return;
      setPending(false);
      if (result.ok) keepRead(path, result.data, version);
      setLoaded(result.ok ? { status: "ready", data: result.data, failure: null } : { status: "error", data: null, failure: result });
    });
    return () => controller.abort();
  }, [apiQuery, attempt]);

  const refetch = useCallback(() => setAttempt((count) => count + 1), []);
  return {
    status: loaded.status,
    items: loaded.data?.items ?? [],
    nextCursor: loaded.data?.nextCursor ?? null,
    failure: loaded.failure,
    refreshing: loaded.data !== null && pending,
    refetch,
  };
}
