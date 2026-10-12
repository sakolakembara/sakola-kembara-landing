import { grantableAreas } from "../auth/permissions";
import { adminRoles } from "../auth/roles";

// What the Aktivitas page may show of a row's `metadata` (docs/cloudflare/admin-sistem.md#what-a-row-shows).
//
// The rule is DENY BY DEFAULT: a key leaves the Worker only if it is in the tables below for that action, with
// a value of the expected kind. Everything else in `metadata` is dropped, whatever it holds and whoever wrote
// it. The tables are the keys the code writes today (src/api/crud/audit.ts, src/api/admin-users.ts,
// src/uploads/store.ts, src/auth/factory.ts). A future area that stores a new key shows nothing of it until
// someone adds it here on purpose; a future area that stores personal data under a key of its own (a review
// note, a message text, an applicant's name) cannot leak it through this page by accident.
//
// `email` is allowed for `admin.*` rows only: it is the address of the admin the change was about, and this
// page is for super_admins. On any other action an `email` key is dropped.

type Clean = (value: unknown) => unknown;
const DROP = undefined;

const text =
  (max: number): Clean =>
  (value) =>
    typeof value === "string" && value.trim() !== "" && value.length <= max ? value : DROP;
const oneOf =
  (allowed: readonly unknown[]): Clean =>
  (value) =>
    allowed.includes(value) ? value : DROP;
const flag: Clean = (value) => (typeof value === "boolean" ? value : DROP);
const count: Clean = (value) => (typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : DROP);
/** A column name: letters, digits and underscores, starting with a letter. Not a value that happens to be short. */
const identifier: Clean = (value) => (typeof value === "string" && /^[A-Za-z][A-Za-z0-9_]{0,39}$/.test(value) ? value : DROP);
/** All or nothing: one element that fails drops the whole list, so a list is never half of what was stored. */
const list =
  (item: Clean, max: number): Clean =>
  (value) =>
    Array.isArray(value) && value.length <= max && value.every((element) => item(element) !== DROP) ? value : DROP;

const areas = list(oneOf(grantableAreas), grantableAreas.length);

type Allowed = Record<string, Clean>;

/** Every action: what the CRUD kit writes. */
const COMMON: Allowed = { fields: list(identifier, 40), label: text(120) };

const ADMIN: Allowed = {
  email: text(254),
  role: oneOf(adminRoles),
  mode: oneOf(["invite", "password"]),
  roleFrom: oneOf(adminRoles),
  roleTo: oneOf(adminRoles),
  nameChanged: flag,
  areasRemoved: areas,
  areasBefore: areas,
  areasAfter: areas,
  field: oneOf(["areas"]),
  before: areas,
  after: areas,
};

/** `path` is deliberately not here: it carries the file's name, which can be a person's. */
const UPLOAD: Allowed = { kind: text(40), contentType: text(100), size: count, width: count, height: count };

const REGISTER: Allowed = { via: oneOf(["email", "google"]) };

function allowedFor(action: string): Allowed {
  if (action.startsWith("admin.")) return { ...COMMON, ...ADMIN };
  if (action.startsWith("upload.")) return { ...COMMON, ...UPLOAD };
  if (action === "student.register") return { ...COMMON, ...REGISTER };
  return COMMON;
}

/** The part of `metadata` the page may show, or null when there is none. `metadata` is whatever is in the column. */
export function projectDetails(action: string, metadata: unknown): Record<string, unknown> | null {
  if (metadata === null || typeof metadata !== "object" || Array.isArray(metadata)) return null;
  const source = metadata as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [key, clean] of Object.entries(allowedFor(action))) {
    if (!Object.hasOwn(source, key)) continue;
    const value = clean(source[key]);
    if (value !== DROP) out[key] = value;
  }
  return Object.keys(out).length === 0 ? null : out;
}
