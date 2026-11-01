import { useCallback, useEffect, useState } from "react";
import { api, type ApiFailure } from "../api";
import type { LoadState } from "./types";
import { fileNameOf, type UploadKindName } from "./upload-kinds";

// The browser side of the Media library's API (`GET /api/admin/uploads`, `GET`/`PATCH /:id`; docs/cloudflare/uploads.md).
// The Media page lists every file the person may read; a picker lists the files of the one kind its field takes
// (`kind`). Both ask the same route, so they share this: the item, the query, the hooks that load a page and one file.
//
// The state of a screen's query is its own (the page keeps it in the page, the picker in its dialog): unlike a table,
// a library has no address for "page 3 of the PDFs", and a dialog must not write into the address bar.

export const MEDIA_PATH = "/api/admin/uploads";

/** One file, as the list and the detail answer it. The key, the uploader's id and e-mail address are never part of it. */
export interface MediaItem {
  id: string;
  /** `/uploads/<kind>/<year>/<id>-<name>.<ext>`: what a form saves, and what `storedFileUrl` turns into an address. */
  path: string;
  /** The name staff know it by: the file name without the media id in front of it. */
  name: string;
  kind: UploadKindName | null;
  contentType: string;
  size: number;
  /** Null for a PDF. */
  width: number | null;
  height: number | null;
  /** What a screen reader says for the picture; null until someone writes it. */
  altText: string | null;
  /** Null once that account is gone. */
  uploadedByName: string | null;
  createdAt: string;
}

export interface MediaListPayload {
  items: MediaItem[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface MediaDetail {
  item: MediaItem;
  /** The menus (Blog, Tim, ...) that use the file, once each. */
  usedBy: string[];
}

export const isImage = (item: Pick<MediaItem, "contentType">): boolean => item.contentType.startsWith("image/");

export type MediaTypeFilter = "" | "image" | "pdf";

/** "Dalam 30 hari terakhir" and the like: the date filter is a window back from today, not two calendar boxes. */
export const MEDIA_RANGES = [
  { value: "7", label: "7 hari terakhir", days: 7 },
  { value: "30", label: "30 hari terakhir", days: 30 },
  { value: "90", label: "90 hari terakhir", days: 90 },
] as const;

export type MediaRange = "" | (typeof MEDIA_RANGES)[number]["value"];

export interface MediaQuery {
  /** One kind (a picker), or null for the library. */
  kind: UploadKindName | null;
  q: string;
  type: MediaTypeFilter;
  range: MediaRange;
  page: number;
  pageSize: number;
}

export const EMPTY_QUERY: Omit<MediaQuery, "kind" | "pageSize"> = { q: "", type: "", range: "", page: 1 };

const DAY_MS = 86_400_000;

/** `2026-10-02`: the start of that day in UTC, which the Worker takes as a `from` (a bare date, never a looser text). */
function dateOnly(at: Date): string {
  return at.toISOString().slice(0, 10);
}

/** The address of one page of the list. `now` is a parameter so a test can fix the day. */
export function mediaListPath(query: MediaQuery, now: Date = new Date()): string {
  const params = new URLSearchParams();
  if (query.kind) params.set("kind", query.kind);
  if (query.q) params.set("q", query.q);
  if (query.type) params.set("type", query.type);
  const range = MEDIA_RANGES.find((choice) => choice.value === query.range);
  if (range) params.set("from", dateOnly(new Date(now.getTime() - range.days * DAY_MS)));
  if (query.page > 1) params.set("page", String(query.page));
  params.set("pageSize", String(query.pageSize));
  return `${MEDIA_PATH}?${params.toString()}`;
}

export interface MediaList {
  status: LoadState;
  items: MediaItem[];
  total: number;
  totalPages: number;
  failure: ApiFailure | null;
  /** A page is on its way and the one before is still shown. */
  refreshing: boolean;
  refetch(): void;
}

/**
 * One page of the library for `query`. A new query aborts the request in flight; the rows of the page before stay on
 * screen while the next one loads (`refreshing`) instead of flashing an empty grid; a failed load keeps its message.
 */
export function useMediaList(query: MediaQuery): MediaList {
  const [attempt, setAttempt] = useState(0);
  const [loaded, setLoaded] = useState<{ status: LoadState; data: MediaListPayload | null; failure: ApiFailure | null }>({
    status: "loading",
    data: null,
    failure: null,
  });
  const [pending, setPending] = useState(true);
  const { kind, q, type, range, page, pageSize } = query;

  useEffect(() => {
    const controller = new AbortController();
    setPending(true);
    setLoaded((previous) => ({ ...previous, status: previous.data ? "ready" : "loading", failure: null }));
    void api<MediaListPayload>(mediaListPath({ kind, q, type, range, page, pageSize }), { signal: controller.signal }).then((result) => {
      if (controller.signal.aborted) return;
      setPending(false);
      setLoaded(result.ok ? { status: "ready", data: result.data, failure: null } : { status: "error", data: null, failure: result });
    });
    return () => controller.abort();
  }, [kind, q, type, range, page, pageSize, attempt]);

  return {
    status: loaded.status,
    items: loaded.data?.items ?? [],
    total: loaded.data?.total ?? 0,
    totalPages: loaded.data?.totalPages ?? 1,
    failure: loaded.failure,
    refreshing: loaded.data !== null && pending,
    refetch: useCallback(() => setAttempt((count) => count + 1), []),
  };
}

export interface MediaDetailState {
  status: LoadState;
  /** The menus that use the file, once known. */
  usedBy: string[] | null;
  failure: ApiFailure | null;
}

/** The menus that use `id`, from `GET /:id`; `usedBy` is null while it loads and after a failure. Asked again when `version` changes (an edit elsewhere on the screen). */
export function useMediaUsage(id: string | null, version: unknown = 0): MediaDetailState {
  const [state, setState] = useState<MediaDetailState>({ status: "loading", usedBy: null, failure: null });
  useEffect(() => {
    if (id === null) return;
    const controller = new AbortController();
    setState({ status: "loading", usedBy: null, failure: null });
    void api<MediaDetail>(`${MEDIA_PATH}/${encodeURIComponent(id)}`, { signal: controller.signal }).then((result) => {
      if (controller.signal.aborted) return;
      setState(result.ok ? { status: "ready", usedBy: result.data.usedBy, failure: null } : { status: "error", usedBy: null, failure: result });
    });
    return () => controller.abort();
  }, [id, version]);
  return state;
}

/** Saves the text alternative (an empty text clears it). The answer is the file as it is now. */
export function saveAltText(id: string, altText: string) {
  return api<{ item: MediaItem }>(`${MEDIA_PATH}/${encodeURIComponent(id)}`, { method: "PATCH", json: { altText } });
}

/** The longest text alternative the Worker takes. */
export const ALT_TEXT_MAX = 300;

/** "2,4 MB", "340 KB", "512 B": decimal units, as the Worker's own messages write them ("maksimal 5 MB"). */
export function formatSize(bytes: number): string {
  const number = (value: number) => value.toLocaleString("id-ID", { maximumFractionDigits: 1 });
  if (bytes < 1000) return `${bytes} B`;
  if (bytes < 1_000_000) return `${number(bytes / 1000)} KB`;
  return `${number(bytes / 1_000_000)} MB`;
}

/** "PDF", "WebP", "JPEG": what a person calls the type, from the content type. */
export function typeLabel(contentType: string): string {
  switch (contentType) {
    case "application/pdf":
      return "PDF";
    case "image/webp":
      return "WebP";
    case "image/jpeg":
      return "JPEG";
    case "image/png":
      return "PNG";
    case "image/gif":
      return "GIF";
    default:
      return contentType;
  }
}

/** What an upload gives back, as a library item: the list has not been asked again yet, and the uploader is the person who just did it. */
export function mediaItemFromUpload(
  result: Pick<MediaItem, "id" | "path" | "contentType" | "size" | "width" | "height">,
  kind: UploadKindName,
  uploader: string,
): MediaItem {
  return {
    id: result.id,
    path: result.path,
    name: fileNameOf(result.path),
    kind,
    contentType: result.contentType,
    size: result.size,
    width: result.width,
    height: result.height,
    altText: null,
    uploadedByName: uploader || null,
    createdAt: new Date().toISOString(),
  };
}

/** A PDF by the browser's guess or, with none, by the extension. */
export function isPdfFile(file: { name: string; type: string }): boolean {
  const claimed = file.type.trim().toLowerCase();
  return claimed !== "" && claimed !== "application/octet-stream" ? claimed === "application/pdf" : /\.pdf$/i.test(file.name);
}

/**
 * The kind a file dropped on the Media page is stored as. The library has no field to give a file its kind, so the type decides:
 * a picture is a blog image (up to 5 MB: what a hero or an article takes), a PDF a report (up to 20 MB: what Laporan takes).
 */
export function kindForFile(file: { name: string; type: string }): UploadKindName {
  return isPdfFile(file) ? "report" : "blog-image";
}
