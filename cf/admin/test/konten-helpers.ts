import { env } from "cloudflare:workers";
import { expect } from "vitest";
import type { GrantableArea } from "../src/auth/permissions";
import type { UserRole } from "../src/auth/roles";
import { call, signedInCookie, uniqueEmail } from "./helpers";
import { pdf, png, upload, type Uploaded } from "./uploads-helpers";

// What the three Konten Situs screens (Laporan, Tim, Shortlink) share in their tests: the role matrix of the area,
// reading the audit trail and the tables, and uploading a real file through the real endpoint.

/**
 * Every kind of caller against the area `konten`. `read` is the status of a GET, `write` is what a POST, PUT and
 * DELETE should do: "ok" or 403. An editor reads and writes only inside the areas granted to them and has no
 * access at all to the others (SAKEM-082): an editor of pendaftaran and komunikasi is refused here, on the read too.
 */
export const KONTEN_CASES = [
  { label: "student", role: "student", areas: [], read: 403, write: 403 },
  { label: "viewer", role: "viewer", areas: [], read: 200, write: 403 },
  // A grant row on a viewer is inert: viewer is read-only by role.
  { label: "viewer with a stray konten grant", role: "viewer", areas: ["konten"], read: 200, write: 403 },
  { label: "editor with no grants", role: "editor", areas: [], read: 403, write: 403 },
  { label: "editor granted pendaftaran and komunikasi only", role: "editor", areas: ["pendaftaran", "komunikasi"], read: 403, write: 403 },
  { label: "editor granted konten", role: "editor", areas: ["konten"], read: 200, write: "ok" },
  { label: "editor granted every area", role: "editor", areas: ["pendaftaran", "komunikasi", "konten"], read: 200, write: "ok" },
  { label: "super_admin", role: "super_admin", areas: [], read: 200, write: "ok" },
] as const satisfies readonly { label: string; role: UserRole; areas: readonly GrantableArea[]; read: number; write: number | "ok" }[];

export async function count(table: string): Promise<number> {
  return (await env.DB.prepare(`SELECT count(*) AS n FROM ${table}`).first<{ n: number }>())!.n;
}

export interface AuditRow {
  actor_email: string;
  action: string;
  resource_type: string;
  resource_id: string;
  metadata: string | null;
}

export async function auditRows(): Promise<AuditRow[]> {
  const { results } = await env.DB.prepare("SELECT actor_email, action, resource_type, resource_id, metadata FROM audit_log ORDER BY created_at, rowid").all<AuditRow>();
  return results;
}

/** A signed-in editor of `konten`. */
export function konten(label = "editor") {
  const email = uniqueEmail(label);
  return signedInCookie(email, "editor", ["konten"]).then((cookie) => ({ email, cookie }));
}

/** A real upload through POST /api/admin/uploads (the file goes to the local R2 and `media`), as the form does before it saves a path. */
export async function uploaded(cookie: string, kind: "report" | "team-photo", name?: string): Promise<Uploaded> {
  const isReport = kind === "report";
  const res = await upload({ cookie, kind, bytes: isReport ? pdf() : png(10, 10), filename: name ?? (isReport ? "laporan.pdf" : "foto.png"), claimedType: isReport ? "application/pdf" : "image/png" });
  expect(res.status, "the fixture upload").toBe(201);
  return (await res.json()) as Uploaded;
}

export async function mediaCount(): Promise<number> {
  return count("media");
}

export async function objectExists(path: string): Promise<boolean> {
  return (await env.UPLOADS.head(path.slice(1))) !== null;
}

/** The path of an upload that was never made: the shape and the kind folder are all a form is checked for. */
export function fakeUploadPath(kind: "report" | "team-photo" | "blog-image" | "resource", name = "berkas"): string {
  const ext = kind === "report" || kind === "resource" ? "pdf" : "png";
  return `/uploads/${kind}/2026/${crypto.randomUUID()}-${name}.${ext}`;
}

/** Fetches JSON of a response typed loosely. */
export async function body<T = Record<string, unknown>>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

export { call };
