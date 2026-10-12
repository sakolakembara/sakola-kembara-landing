import { env } from "cloudflare:workers";
import { beforeEach } from "vitest";
import type { GrantableArea } from "../src/auth/permissions";
import type { UserRole } from "../src/auth/roles";
import * as schema from "../src/db/schema";
import { DAY, insertMany, orm } from "./public-helpers";

// Fixtures and small readers for the tests of the Pendaftaran area (batches, applications, resources).

/** A person who cannot be a real one: every name, address and number below is reserved or made up. */
export const APPLICANT = {
  fullName: "Rahasia Pendaftar",
  email: "rahasia-pendaftar@example.test",
  whatsapp: "081200012345",
  schoolName: "SMA Rahasia",
  note: "Catatan rahasia soal pendaftar ini",
} as const;

type Status = (typeof schema.applicationStatus)[number];

const FIRST_YEAR = 2030;
let years = FIRST_YEAR;
let sequence = 0;

// The tables are emptied before each test (test/setup.ts), so every test starts from the same year again:
// the year is unique and must stay between 2024 and 2100, which a counter that never went back would not.
beforeEach(() => {
  years = FIRST_YEAR;
});

/** The next year no batch of this test has used. */
export const nextYear = () => (years += 1);

export async function addBatch(over: Partial<typeof schema.admissionBatches.$inferInsert> = {}) {
  const year = over.year ?? nextYear();
  const row = {
    id: crypto.randomUUID(),
    year,
    name: `Gen ${year - 2024} - ${year}/${year + 1}`,
    opensAt: new Date(Date.now() - 60 * DAY),
    closesAt: new Date(Date.now() - 10 * DAY),
    ...over,
  };
  await orm().insert(schema.admissionBatches).values(row);
  return row;
}

/** One application row (the marker values make a leak easy to see in a log or an audit row). */
export function applicationRow(batchId: string, over: Partial<typeof schema.studentApplications.$inferInsert> = {}) {
  sequence += 1;
  return {
    id: crypto.randomUUID(),
    batchId,
    fullName: `Pendaftar ${sequence}`,
    email: `pendaftar-${sequence}@example.test`,
    whatsapp: `0812000${String(sequence).padStart(5, "0")}`,
    schoolName: `SMA Contoh ${sequence}`,
    graduationYear: "2026",
    status: "pending" as Status,
    ...over,
  };
}

export async function addApplication(batchId: string, over: Partial<typeof schema.studentApplications.$inferInsert> = {}) {
  const row = applicationRow(batchId, over);
  await orm().insert(schema.studentApplications).values(row);
  return row;
}

/** Many applications at once: `counts` per status, each submitted a minute after the one before. */
export async function addApplications(batchId: string, counts: Partial<Record<Status, number>>, over: Partial<typeof schema.studentApplications.$inferInsert> = {}) {
  let minute = 0;
  const rows = (Object.entries(counts) as [Status, number][]).flatMap(([status, n]) =>
    Array.from({ length: n }, () => applicationRow(batchId, { status, submittedAt: new Date(Date.UTC(2026, 0, 1) + (minute += 1) * 60_000), ...over })),
  );
  await insertMany(schema.studentApplications, rows);
  return rows;
}

export async function addResourceRow(over: Partial<typeof schema.siteResources.$inferInsert> = {}) {
  sequence += 1;
  const row = {
    id: crypto.randomUUID(),
    title: `Dokumen ${sequence}`,
    category: "panduan" as const,
    contentType: "file" as const,
    filePath: `/resources/dokumen-${sequence}.pdf`,
    fileSize: 2000 + sequence,
    ...over,
  };
  await orm().insert(schema.siteResources).values(row as typeof schema.siteResources.$inferInsert);
  return row;
}

export async function count(table: string) {
  return (await env.DB.prepare(`SELECT count(*) AS n FROM ${table}`).first<{ n: number }>())!.n;
}

export async function rowOf<T = Record<string, unknown>>(table: string, id: string) {
  return env.DB.prepare(`SELECT * FROM ${table} WHERE id = ?`).bind(id).first<T>();
}

/** The roles and grants of the guard matrix of the Pendaftaran area: who reads, who writes. */
export const MATRIX: { label: string; role: UserRole; areas: GrantableArea[]; read: boolean; write: boolean }[] = [
  { label: "student", role: "student", areas: [], read: false, write: false },
  { label: "viewer", role: "viewer", areas: [], read: true, write: false },
  { label: "viewer with a stray pendaftaran grant", role: "viewer", areas: ["pendaftaran"], read: true, write: false },
  { label: "editor with no grants", role: "editor", areas: [], read: false, write: false },
  { label: "editor of konten and komunikasi only", role: "editor", areas: ["konten", "komunikasi"], read: false, write: false },
  { label: "editor of pendaftaran", role: "editor", areas: ["pendaftaran"], read: true, write: true },
  { label: "editor of every area", role: "editor", areas: ["pendaftaran", "komunikasi", "konten"], read: true, write: true },
  { label: "super_admin", role: "super_admin", areas: [], read: true, write: true },
];

/** Every audit row, oldest first, with the metadata as text (to read what is in it, and what is not). */
export async function audit() {
  const { results } = await env.DB.prepare("SELECT actor_email, action, resource_type, resource_id, metadata FROM audit_log ORDER BY created_at, rowid").all<{
    actor_email: string;
    action: string;
    resource_type: string;
    resource_id: string;
    metadata: string | null;
  }>();
  return results;
}

/** The `If-Match` of a row, as the SPA builds it from the `updatedAt` it loaded. */
export async function etagOfRow(table: string, id: string): Promise<{ "if-match": string }> {
  const row = await env.DB.prepare(`SELECT updated_at AS v FROM ${table} WHERE id = ?`).bind(id).first<{ v: number }>();
  if (!row) throw new Error(`no row ${id} in ${table}`);
  return { "if-match": `"${new Date(row.v).toISOString()}"` };
}
