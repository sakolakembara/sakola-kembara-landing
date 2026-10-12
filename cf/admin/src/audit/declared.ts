import type { AuditAction, AuditResourceType, CrudName } from "../db/audit";
import { CRUD_NAMES, DECLARED_ACTIONS, DECLARED_RESOURCE_TYPES } from "./lists";

// The audit vocabulary at RUNTIME (docs/cloudflare/admin-sistem.md).
//
// `src/db/audit.ts` declares every action and resource type as a TypeScript union, which is gone once the code
// runs. The Aktivitas page needs the lists in hand: the API accepts a filter only from them, and the SPA offers
// them in its two selects. So the lists are written out in src/audit/lists.ts, and the compiler checks them against
// the unions here, in BOTH directions:
//
//   - `Listed` fails on a name that is not in the union (a typo);
//   - `Undeclared` fails when the union grows and the list does not.
//
// So an area that adds an action to `src/db/audit.ts` cannot get past `pnpm typecheck` until it is added to the
// list, and the SPA test (spa/test/audit-labels.test.ts) then fails until the action has a label: no action can
// reach the page without words. Rows already in the table keep whatever name they were written with (the column
// is free text on purpose), and the page shows those too; only the filter is limited to this list.

export { DECLARED_ACTIONS, DECLARED_RESOURCE_TYPES };

type Missing<Union extends string, Listed extends string> = Exclude<Union, Listed>;
type Extra<Union extends string, Listed extends string> = Exclude<Listed, Union>;
type Agree<Union extends string, Listed extends string> = [Missing<Union, Listed>] extends [never] ? ([Extra<Union, Listed>] extends [never] ? true : Extra<Union, Listed>) : Missing<Union, Listed>;

/**
 * Compile-time proof that the lists and the unions say the same. Each field is `true` when they agree; when they do
 * not, its type is the names that differ and the assignment below fails.
 */
interface Agreement {
  crudNames: Agree<CrudName, (typeof CRUD_NAMES)[number]>;
  actions: Agree<AuditAction, (typeof DECLARED_ACTIONS)[number]>;
  resourceTypes: Agree<AuditResourceType, (typeof DECLARED_RESOURCE_TYPES)[number]>;
}
export const LISTS_AGREE: Agreement = { crudNames: true, actions: true, resourceTypes: true };

export type DeclaredAction = (typeof DECLARED_ACTIONS)[number];
export type DeclaredResourceType = (typeof DECLARED_RESOURCE_TYPES)[number];

const ACTIONS = new Set<string>(DECLARED_ACTIONS);
const RESOURCE_TYPES = new Set<string>(DECLARED_RESOURCE_TYPES);

export const isDeclaredAction = (value: string): value is DeclaredAction => ACTIONS.has(value);
export const isDeclaredResourceType = (value: string): value is DeclaredResourceType => RESOURCE_TYPES.has(value);
