import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router";
import { api, type ApiFailure } from "../api";
import { DEFAULT_PAGE_SIZE, type ListQuery, type ListSpec, parseListQuery, toApiQuery, toSearchParams, totalPages } from "./query";
import type { ListPayload, LoadState } from "./types";

// A list screen's data (docs/cloudflare/admin-crud.md#15-the-spa-kit). The page, the search, the filters and
// the sort live in the URL query, so a reload, the back button and a shared link keep them. Each change of
// the query aborts the request in flight; leaving the page aborts it too. While a newer page loads, the rows
// of the previous one stay on screen (`refreshing`) instead of flashing an empty table.

export interface ListState<T> {
  status: LoadState;
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  /** The query as the address bar says it. */
  query: ListQuery;
  /** Why the last load failed (`status === "error"`). */
  failure: ApiFailure | null;
  /** A load is in flight and there are rows from the one before to show. */
  refreshing: boolean;
  /** Applies a search and filters together and goes back to page 1. Empty values clear. */
  apply(next: { q?: string; filters?: Record<string, string> }): void;
  setSort(sort: string): void;
  /** The address-bar query of another page (`?page=3`), for links. */
  searchFor(page: number): string;
  setPage(page: number): void;
  /** Clears the search and every filter. */
  reset(): void;
  /** Asks again (the "Coba lagi" button, or after a delete). */
  refetch(): void;
}

interface Loaded<T> {
  status: LoadState;
  data: ListPayload<T> | null;
  failure: ApiFailure | null;
}

export function useList<T>(basePath: string, spec: ListSpec = {}): ListState<T> {
  const [params, setParams] = useSearchParams();
  const paramsText = params.toString();
  // `spec` is a constant of the screen; the address bar is what changes.
  const query = useMemo(() => parseListQuery(new URLSearchParams(paramsText), spec), [paramsText, spec]);
  const apiQuery = toApiQuery(query, spec);

  const [attempt, setAttempt] = useState(0);
  const [loaded, setLoaded] = useState<Loaded<T>>({ status: "loading", data: null, failure: null });

  useEffect(() => {
    const controller = new AbortController();
    setLoaded((previous) => ({ ...previous, status: previous.data ? "ready" : "loading", failure: null }));
    void api<ListPayload<T>>(`${basePath}${apiQuery}`, { signal: controller.signal }).then((result) => {
      if (controller.signal.aborted) return;
      setLoaded(result.ok ? { status: "ready", data: result.data, failure: null } : { status: "error", data: null, failure: result });
    });
    return () => controller.abort();
  }, [basePath, apiQuery, attempt]);

  const pageSize = loaded.data?.pageSize ?? spec.pageSize ?? DEFAULT_PAGE_SIZE;
  const total = loaded.data?.total ?? 0;
  const pages = totalPages(total, pageSize);
  // A request is in flight when the address bar names a query the rows on screen were not loaded for.
  const loadedQuery = loaded.data ? `${loaded.data.page}` : null;
  const refreshing = loaded.data !== null && (loaded.status === "loading" || loadedQuery !== String(query.page));

  const go = useCallback(
    (next: ListQuery, replace: boolean) => setParams(toSearchParams(next, spec), { replace }),
    [setParams, spec],
  );

  // A page past the end (the last row of the last page was deleted): go to the last page that exists.
  useEffect(() => {
    if (loaded.status === "ready" && loaded.data && loaded.data.items.length === 0 && loaded.data.total > 0 && query.page > 1) {
      go({ ...query, page: totalPages(loaded.data.total, loaded.data.pageSize) }, true);
    }
  }, [loaded, query, go]);

  return {
    status: loaded.status,
    items: loaded.data?.items ?? [],
    total,
    page: query.page,
    pageSize,
    totalPages: pages,
    query,
    failure: loaded.failure,
    refreshing,
    apply: (next) => go({ ...query, q: next.q ?? query.q, filters: next.filters ?? query.filters, page: 1 }, true),
    setSort: (sort) => go({ ...query, sort, page: 1 }, true),
    searchFor: (page) => {
      const search = toSearchParams({ ...query, page }, spec).toString();
      return search ? `?${search}` : "?";
    },
    setPage: (page) => go({ ...query, page: Math.max(1, page) }, false),
    reset: () => go({ ...query, q: "", filters: {}, page: 1 }, true),
    refetch: () => setAttempt((count) => count + 1),
  };
}
