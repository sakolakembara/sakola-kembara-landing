import { cleanSearch } from "~/lib/crud/query";
import { EMPTY_QUERY, MEDIA_RANGES, type MediaQuery, type MediaRange, type MediaTypeFilter } from "~/lib/crud/media";
import { acceptFor } from "~/lib/crud/upload-kinds";

// The Media page's own pieces: what its address bar says (`/media?q=hero&type=image&page=2&view=list`) and what its file
// chooser offers. The kind a dropped file is stored as is `kindForFile` of lib/crud/media.ts.

export const ROUTE = "/media";

/** Files per page: eight rows of five. */
export const PAGE_SIZE = 40;

export type MediaView = "grid" | "list";

export interface MediaPageQuery extends Pick<MediaQuery, "q" | "type" | "range" | "page"> {
  view: MediaView;
}

const positive = (raw: string | null): number => {
  const number = Number(raw);
  return Number.isInteger(number) && number >= 1 ? Math.min(number, 100_000) : 1;
};

/** The query of the address bar, with whatever is unknown or malformed replaced by the default. */
export function parseMediaParams(params: URLSearchParams): MediaPageQuery {
  const type = params.get("type");
  const range = params.get("range");
  return {
    q: cleanSearch(params.get("q") ?? ""),
    type: type === "image" || type === "pdf" ? (type as MediaTypeFilter) : EMPTY_QUERY.type,
    range: MEDIA_RANGES.some((choice) => choice.value === range) ? (range as MediaRange) : EMPTY_QUERY.range,
    page: positive(params.get("page")),
    view: params.get("view") === "list" ? "list" : "grid",
  };
}

/** The address-bar form of a query: defaults are left out. */
export function mediaSearchParams(query: MediaPageQuery): URLSearchParams {
  const params = new URLSearchParams();
  if (query.q) params.set("q", query.q);
  if (query.type) params.set("type", query.type);
  if (query.range) params.set("range", query.range);
  if (query.page > 1) params.set("page", String(query.page));
  if (query.view === "list") params.set("view", "list");
  return params;
}

export const isFiltered = (query: Pick<MediaPageQuery, "q" | "type" | "range">): boolean => query.q !== "" || query.type !== "" || query.range !== "";

/** What the file chooser offers: the types of both kinds. */
export const ACCEPT = `${acceptFor("blog-image")},${acceptFor("report")}`;
