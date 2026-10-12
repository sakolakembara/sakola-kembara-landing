import type { ListSpec } from "../../lib/crud/query";

// What the Pesan screens and the Worker must agree on, in a file with no aliased imports so the Worker's own test
// suite can read it (test/komunikasi-spa-contract.test.ts): the API paths, the subjects, the read filter and the names
// the list asks the Worker for (src/api/messages.ts).

export const API_PATH = "/api/admin/messages";
export const COUNTS_PATH = `${API_PATH}/counts`;
/** The SPA route of the menu; a message is at `/messages/<id>` (the link `lib/audit.ts` and the dashboard already use). */
export const ROUTE = "/messages";

/** The subjects of the contact form: the Worker's `contactSubject` (a test fails when they differ). */
export const SUBJECTS = ["partnership", "donation", "other"] as const;
export type Subject = (typeof SUBJECTS)[number];

/** The legacy pills: all, unread, read. `all` is no `filter` at all. */
export const READ_FILTERS = ["unread", "read"] as const;
export type ReadFilter = (typeof READ_FILTERS)[number];

/** What the list asks the Worker for: the filter and sort names of src/api/messages.ts. Newest first, the only order the legacy inbox had. */
export const LIST_SPEC: ListSpec = { filters: ["filter"], sorts: ["createdAt"], defaultSort: "-createdAt" };
