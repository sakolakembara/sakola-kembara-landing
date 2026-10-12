import type { ListSpec } from "../../lib/crud/query";

// What the announcements screens and the Worker must agree on, in a file with no aliased imports so the Worker's own
// test suite can read it (test/komunikasi-spa-contract.test.ts): the API path, the names the list asks the Worker
// for, and the `status` values the Worker puts on each row (src/announcements/rules.ts).

/** The API collection and the SPA route of the menu. */
export const API_PATH = "/api/admin/announcements";
export const ROUTE = "/announcements";

/** What the list offers: the same names as the Worker's filters and sorts (src/api/announcements.ts). */
export const LIST_SPEC: ListSpec = {
  filters: ["severity", "active"],
  sorts: ["createdAt", "updatedAt", "title", "startsAt"],
  defaultSort: "-createdAt",
};

/** What the Pengumuman list says about a row: the same four values as `announcementStatuses` in the Worker (a test fails when they differ). */
export const ANNOUNCEMENT_STATUSES = ["current", "superseded", "outside_window", "inactive"] as const;
export type AnnouncementStatus = (typeof ANNOUNCEMENT_STATUSES)[number];

/** The severities the form offers; the Worker's `announcementSeverity`. */
export const SEVERITY_VALUES = ["info", "warning", "urgent"] as const;
