import type { Access } from "~/lib/access";
import type { AdminArea } from "~/lib/me";

// MOCK, local development only (see mock/install.ts). For an API the generic resource store of mock/resources.ts
// cannot be: verb routes (`POST /:id/deactivate`), a list with a cursor, an answer that depends on state across
// routes (an admin made in Pengaturan shows up in Aktivitas).
//
// To mock one, add ONE file `mock/handlers/<name>.ts` with a `default` export of a `MockHandler` (or an array of
// them): every file of that folder is picked up with `import.meta.glob`, so there is no central list to edit and
// parallel workers do not conflict. A handler answers a request that is its own, or returns null, and the next one
// is asked; when nobody answers the transport says 404. `mock/handlers/sistem.ts` is the worked one.

export interface MockRequest {
  method: string;
  url: URL;
  init: RequestInit;
  /** What the persona may do in an area: the Worker's own rules, through `accessTo`. */
  accessOf: (area: AdminArea) => Access;
  /** Who the persona is, as `GET /api/me` says it. */
  self: { id: string; email: string; name: string };
}

export type MockHandler = (request: MockRequest) => Response | null;

const modules = import.meta.glob<{ default: MockHandler | readonly MockHandler[] }>("./handlers/*.ts", { eager: true });

export const MOCK_HANDLERS: readonly MockHandler[] = Object.values(modules).flatMap((module) => (Array.isArray(module.default) ? module.default : [module.default as MockHandler]));
