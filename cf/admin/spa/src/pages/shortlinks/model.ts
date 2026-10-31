import { makeStatusMap } from "~/components/crud/StatusTag";
import type { ListSpec } from "~/lib/crud/query";
import { SITE_URL } from "~/lib/site";

// What the Shortlink screens share: the types, the list's spec and the form's values. The wording is the legacy
// admin's (app/(admin)/admin/shortlinks/*); the rules of a slug and of a target are enforced by the Worker
// (src/shortlinks/rules.ts) and shown here as it answers.

/** The API collection and the SPA route of the menu. */
export const API_PATH = "/api/admin/shortlinks";
export const ROUTE = "/shortlinks";

/** What the top bar of the form says about a saved link. */
export const STATUS = makeStatusMap({
  active: { label: "Aktif", tone: "green" },
  inactive: { label: "Nonaktif", tone: "gray" },
});

/** An item as the API answers it (`present` in src/api/shortlinks.ts). */
export interface ShortlinkItem {
  id: string;
  slug: string;
  targetUrl: string;
  note: string | null;
  active: boolean;
  clickCount: number;
  lastClickedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * What the list offers: the same names as the Worker's filters and sorts (src/api/shortlinks.ts). Newest first,
 * as the legacy list. The legacy list showed every link on one page, so a page holds as many as the API allows.
 */
export const LIST_SPEC: ListSpec = {
  filters: ["active"],
  sorts: ["createdAt", "updatedAt", "slug", "clickCount", "lastClickedAt"],
  defaultSort: "-createdAt",
  pageSize: 100,
};

/** The address people are given: the site, a slash, the slug. */
export const shortUrl = (slug: string) => `${SITE_URL}/${slug}`;

/** What the slug box shows in the sentence under it while it is empty. */
export const SLUG_PLACEHOLDER = "slug-anda";

// ----------------------------------------------------------------------- the form

export interface ShortlinkValues extends Record<string, string | boolean> {
  slug: string;
  targetUrl: string;
  note: string;
  active: boolean;
}

export function toValues(item: ShortlinkItem | null): ShortlinkValues {
  return {
    slug: item?.slug ?? "",
    targetUrl: item?.targetUrl ?? "",
    note: item?.note ?? "",
    // A new link starts switched on (the legacy checkbox was ticked).
    active: item?.active ?? true,
  };
}

/** The body of `POST` and `PUT`. The Worker trims, lower-cases and checks the slug and the target. */
export function toBody(values: ShortlinkValues) {
  return { slug: values.slug, targetUrl: values.targetUrl, note: values.note, active: values.active };
}

/** For the error summary: the field names the Worker reports, in the legacy labels. */
export const FIELD_LABELS: Record<string, string> = {
  slug: "Slug",
  targetUrl: "URL tujuan",
  note: "Catatan",
  active: "Status",
};
