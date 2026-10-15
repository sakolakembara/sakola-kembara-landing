import { env } from "cloudflare:workers";
import type { SlotId } from "../shared/application-form/slots";
import type { Bindings } from "../src/env";
import { DRAFT_PURGE_MIN_INACTIVE_MS } from "../src/private-files/drafts";
import { call, signedInCookie, uniqueEmail } from "./helpers";
import { addBatch } from "./pendaftaran-helpers";
import { ADMIN_APPLICATIONS, seedFile } from "./private-files-helpers";

// Fixtures and calls for the tests of the manual purge of a draft's files (SAKEM-093). Every name, address and answer
// below is made up; the markers are recognisable so a leak into an answer, an audit row or a log line is easy to see.

export const DAY = 86_400_000;
export const DRAFT_FILES = `${ADMIN_APPLICATIONS}/drafts/files`;
export const draftPurgePath = (id: string) => `${ADMIN_APPLICATIONS}/drafts/${id}/files/purge`;

export const editor = () => signedInCookie(uniqueEmail("editor"), "editor", ["pendaftaran"]);
export const viewer = () => signedInCookie(uniqueEmail("viewer"), "viewer");
export const superAdmin = () => signedInCookie(uniqueEmail("super"), "super_admin");

export const listDrafts = (cookie?: string, query = "", init: { env?: Partial<Bindings> } = {}) => call(`${DRAFT_FILES}${query}`, { cookie, env: init.env });

export const purgeDraft = (id: string, cookie?: string, body: unknown = { confirm: true }, init: { env?: Partial<Bindings> } = {}) =>
  call(draftPurgePath(id), { method: "POST", cookie, json: body, env: init.env });

/** Recognisable personal data of a student, so a test can prove none of it reaches the list, an audit row or a log. */
export const STUDENT = {
  name: "Anak Rahasia Pertama",
  localPart: "anak.rahasia",
  email: "anak.rahasia@example.test",
  answer: "Jalan Rahasia nomor 17",
  fullName: "Nama Lengkap Rahasia",
} as const;

/** A student straight into the table (no sign-in: the tests of the admin side need only the row a draft refers to). */
export async function bareStudent(over: { name?: string; email?: string } = {}): Promise<{ id: string; name: string; email: string }> {
  const id = crypto.randomUUID();
  const name = over.name ?? `Siswa ${id.slice(0, 6)}`;
  const email = over.email ?? uniqueEmail("siswa");
  await env.DB.prepare("INSERT INTO users (id, name, email, email_verified, role) VALUES (?, ?, ?, 1, 'student')").bind(id, name, email).run();
  return { id, name, email };
}

export interface DraftFixture {
  id: string;
  userId: string;
  batch: { id: string; year: number; name: string };
  files: { id: string; key: string; size: number; slot: SlotId }[];
  student: { id: string; name: string; email: string };
}

/**
 * A draft that holds files, as the API would have left it: the user, the draft row (last changed `ageDays` days ago, or
 * exactly at `updatedAt`), and one object and row per slot, with the storage counter moved.
 */
export async function draftWithFiles(
  options: {
    slots?: SlotId[];
    size?: number;
    ageDays?: number;
    updatedAt?: number;
    batch?: { id: string; year: number; name: string };
    student?: { id: string; name: string; email: string };
    formData?: unknown;
  } = {},
): Promise<DraftFixture> {
  const batch = options.batch ?? (await addBatch());
  const student = options.student ?? (await bareStudent());
  const id = crypto.randomUUID();
  const updatedAt = options.updatedAt ?? Date.now() - (options.ageDays ?? 40) * DAY;
  await env.DB.prepare("INSERT INTO application_drafts (id, user_id, batch_id, form_data, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(id, student.id, batch.id, JSON.stringify(options.formData ?? {}), updatedAt, updatedAt)
    .run();
  const files: DraftFixture["files"] = [];
  for (const slot of options.slots ?? ["family-card"]) {
    const file = await seedFile({ applicationId: id, year: batch.year, slot, kind: slot === "electricity-bill" ? "pdf" : "png", size: options.size ?? 300, at: updatedAt });
    files.push({ ...file, slot });
  }
  return { id, userId: student.id, batch, files, student };
}

export async function setUpdatedAt(draftId: string, at: number): Promise<void> {
  await env.DB.prepare("UPDATE application_drafts SET updated_at = ? WHERE id = ?").bind(at, draftId).run();
}

export async function updatedAtOf(draftId: string): Promise<number> {
  return (await env.DB.prepare("SELECT updated_at FROM application_drafts WHERE id = ?").bind(draftId).first<{ updated_at: number }>())!.updated_at;
}

export async function formDataOf(draftId: string): Promise<string> {
  return (await env.DB.prepare("SELECT form_data FROM application_drafts WHERE id = ?").bind(draftId).first<{ form_data: string }>())!.form_data;
}

/** Thirty days, as the rule says it (the tests compare it with their own arithmetic, not with each other). */
export const THIRTY_DAYS = 30 * DAY;
export const RULE_MS = DRAFT_PURGE_MIN_INACTIVE_MS;

/** Counts what goes through a D1 binding: used to prove that a request with no session never reads or writes anything. */
export function countingDb(real: D1Database = env.DB): { db: D1Database; used: () => number } {
  let used = 0;
  const db = new Proxy(real, {
    get(target, prop) {
      const value = Reflect.get(target, prop, target) as unknown;
      if (prop === "prepare" || prop === "batch" || prop === "exec" || prop === "dump") {
        return (...args: unknown[]) => {
          used += 1;
          return (value as (...a: unknown[]) => unknown).apply(target, args);
        };
      }
      return typeof value === "function" ? (value as (...a: unknown[]) => unknown).bind(target) : value;
    },
  });
  return { db, used: () => used };
}

/** A bucket whose deletes fail, as when R2 is down: reads and writes work. */
export function flakyDeletes(): R2Bucket {
  return new Proxy(env.PRIVATE_FILES, {
    get(target, property) {
      if (property === "delete") return () => Promise.reject(new Error("r2 is down"));
      const value = Reflect.get(target, property) as unknown;
      return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(target) : value;
    },
  });
}
