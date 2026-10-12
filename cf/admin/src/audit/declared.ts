import type { AuditAction, AuditResourceType, CrudName } from "../db/audit";

// The audit vocabulary at RUNTIME (docs/cloudflare/admin-sistem.md).
//
// `src/db/audit.ts` declares every action and resource type as a TypeScript union, which is gone once the code
// runs. The Aktivitas page needs the lists in hand: the API accepts a filter only from them, and the SPA offers
// them in its two selects. So the lists are written out here, and the compiler checks them against the unions
// in BOTH directions:
//
//   - `satisfies readonly AuditAction[]` fails on a name that is not in the union (a typo);
//   - the `Undeclared` types below fail when the union grows and this list does not.
//
// So an area that adds an action to `src/db/audit.ts` cannot get past `pnpm typecheck` until it is added here,
// and the SPA test (spa/test/audit-labels.test.ts) then fails until the action has a label: no action can reach
// the page without words. Rows already in the table keep whatever name they were written with (the column is
// free text on purpose), and the page shows those too; only the filter is limited to this list.

const CRUD_NAMES = ["announcement", "report", "blog", "team", "resource", "shortlink", "batch", "contact_message"] as const satisfies readonly CrudName[];
type MissingCrudName = Exclude<CrudName, (typeof CRUD_NAMES)[number]>;

const CRUD_ACTIONS = CRUD_NAMES.flatMap((name) => (["create", "update", "delete"] as const).map((verb) => `${name}.${verb}` as const));

export const DECLARED_ACTIONS = [
  // Uploads to R2.
  "upload.create",
  "upload.delete",
  // The CRUD kit's three verbs for every resource the legacy admin had.
  ...CRUD_ACTIONS,
  // The legacy verb actions.
  "application.submit",
  "application.pending",
  "application.under_review",
  "application.accepted",
  "application.rejected",
  "application.revoke",
  "batch.publish_results",
  "batch.unpublish_results",
  "contact_message.submit",
  "contact_message.read",
  "contact_message.unread",
  // Pengaturan.
  "admin.create",
  "admin.update",
  "admin.deactivate",
  "admin.reactivate",
  "admin.invite_resend",
  // Written by the auth flows.
  "student.register",
  "user.email_verified",
  "user.password_reset",
] as const satisfies readonly AuditAction[];

export const DECLARED_RESOURCE_TYPES = [
  "media",
  "announcement",
  "admin_user",
  "user",
  "application",
  "batch",
  "report",
  "blog",
  "team_member",
  "contact_message",
  "site_resource",
  "shortlink",
] as const satisfies readonly AuditResourceType[];

type Undeclared<Union extends string, Listed extends string> = Exclude<Union, Listed>;

/**
 * Compile-time proof that nothing is missing from the lists above. Each field is `true` when the union and the
 * list agree; when they do not, the type of the field is the missing names and the assignment below fails.
 */
interface Agreement {
  crudNames: [MissingCrudName] extends [never] ? true : MissingCrudName;
  actions: [Undeclared<AuditAction, (typeof DECLARED_ACTIONS)[number]>] extends [never] ? true : Undeclared<AuditAction, (typeof DECLARED_ACTIONS)[number]>;
  resourceTypes: [Undeclared<AuditResourceType, (typeof DECLARED_RESOURCE_TYPES)[number]>] extends [never] ? true : Undeclared<AuditResourceType, (typeof DECLARED_RESOURCE_TYPES)[number]>;
}
export const LISTS_AGREE: Agreement = { crudNames: true, actions: true, resourceTypes: true };

export type DeclaredAction = (typeof DECLARED_ACTIONS)[number];
export type DeclaredResourceType = (typeof DECLARED_RESOURCE_TYPES)[number];

const ACTIONS = new Set<string>(DECLARED_ACTIONS);
const RESOURCE_TYPES = new Set<string>(DECLARED_RESOURCE_TYPES);

export const isDeclaredAction = (value: string): value is DeclaredAction => ACTIONS.has(value);
export const isDeclaredResourceType = (value: string): value is DeclaredResourceType => RESOURCE_TYPES.has(value);
