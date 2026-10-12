// The shapes of the admin CRUD API (docs/cloudflare/admin-crud.md#4-response-envelopes).
// Pure: no DOM, no React.

/** `GET /api/admin/<resource>`. `page` and `pageSize` are what the server actually used, after clamping. */
export interface ListPayload<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}

/** One item: `GET /:id`, the answer of `POST` and `PUT`. Never the bare object. */
export interface ItemPayload<T> {
  item: T;
}

/** What every item of a table with an `updated_at` carries: the id, and the version `If-Match` compares. */
export interface Versioned {
  id: string;
  updatedAt: string;
}

/** The shape of a list or item request's progress, as a screen reads it. */
export type LoadState = "loading" | "ready" | "error";
