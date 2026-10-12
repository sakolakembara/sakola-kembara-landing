import type { ComponentType } from "react";

// The screens of the menu, one registry per area (docs/cloudflare/admin-crud.md#18-worked-example-a-resource-end-to-end).
//
// A screen is registered under the PATH of its menu entry (`/announcements`, from lib/nav.ts). `index` is the list;
// `routes` are the pages below it: `new`, `:id/edit`, `:id` (a detail page). Anything below a menu entry that is not
// listed still gets the "Belum tersedia di admin baru" placeholder.
//
// Each area has its own file, so four workers add their screens without touching the same lines:
// komunikasi.ts, pendaftaran.ts, konten.ts, sistem.ts. App.tsx only merges them.

export interface Screen {
  /** The list (the menu entry's own page). */
  index?: ComponentType;
  /** Pages below it: `{ path: "new", Page }`, `{ path: ":id/edit", Page }`. */
  routes?: readonly { path: string; Page: ComponentType }[];
}

export type Screens = Record<string, Screen>;
