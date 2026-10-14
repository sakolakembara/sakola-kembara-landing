import { env } from "cloudflare:workers";
import { expect, vi } from "vitest";
import { requiredSlots, SLOT_IDS, SLOTS, type SlotId } from "../shared/application-form/slots";
import { STEP_IDS, type StepId } from "../shared/application-form/steps";
import { uniqueEmail } from "./helpers";
import { portalCall, portalSignedIn } from "./portal-helpers";
import { addBatch } from "./pendaftaran-helpers";
import { DAY } from "./public-helpers";

// Fixtures and small readers for the tests of the student's application API (src/portal/applications.ts,
// docs/cloudflare/portal-api.md). Every person, number and answer below is invented and carries a marker that is easy
// to spot in a log line, an audit row or an answer that must not hold it.

export const API = "/portal/api";
export const OVERVIEW = `${API}/overview`;
export const CURRENT = `${API}/applications/current`;
export const STATUS = `${API}/applications`;
export const SUBMIT = `${API}/applications/current/submit`;
export const stepPath = (step: string) => `${API}/applications/current/steps/${step}`;

/** The answers of an applicant that pass every rule. The markers are the values a leak would show. */
export const MARKERS = {
  fullName: "Rahasia Pendaftar Contoh",
  whatsapp: "6281200012345",
  address: "Jl. Rahasia No. 99, Kota Contoh",
  school: "SMA Rahasia Satu",
  fatherName: "Bapak Rahasia",
  answer: "Jawaban rahasia soal motivasi saya untuk kuliah dan membanggakan keluarga.",
} as const;

export type Body = Record<string, unknown>;

export const VALID: Record<StepId, Body> = {
  identity: {
    fullName: MARKERS.fullName,
    nickname: "Rahasia",
    gender: "perempuan",
    religion: "Islam",
    schoolName: MARKERS.school,
    branch: "Cililin",
    homeAddress: MARKERS.address,
    graduationBatch: "2027 (Kelas 12)",
    whatsapp: MARKERS.whatsapp,
  },
  household: {
    livingWith: ["Ayah", "Ibu"],
    fatherName: MARKERS.fatherName,
    fatherOccupation: "Petani",
    fatherIncome: "1.200.000",
    motherName: "Ibu Rahasia",
    motherOccupation: "Ibu rumah tangga",
    motherIncome: "0",
    hasOtherEarner1: false,
    hasOtherEarner2: false,
    familySize: 4,
  },
  housing: { residenceStatus: "Rumah Pribadi", buildingArea: 36, motorcycles: 1, cars: 0, hasDebt: false },
  organizations: { hasOrganizations: false, entries: [] },
  documents: { dtksRegistered: "tidak" },
  marketing: { instagramUsername: "rahasia.contoh" },
  interview: {
    motivationHigherEducation: MARKERS.answer,
    motivationSakem: "Saya ingin belajar bersama teman-teman yang saling mendukung.",
    consistencyPlan: "Belajar rutin setiap hari dan mengikuti jadwal bimbingan.",
    attendanceCommitment: "Saya siap hadir pada seluruh kegiatan yang dijadwalkan.",
    parentResponse: "Orang tua saya mendukung sepenuhnya rencana ini.",
    ifParentChangesMind: "Saya akan berdiskusi baik-baik dan mencari jalan tengah.",
    agreedToSignedStatement: "ya",
  },
};

// ─── Batches ───

/** A batch that is open now (opened a day ago, closes in a month), unless the test says another window. */
export function openBatch(over: Parameters<typeof addBatch>[0] = {}) {
  return addBatch({ opensAt: new Date(Date.now() - DAY), closesAt: new Date(Date.now() + 30 * DAY), ...over });
}

// ─── Students ───

export interface Student {
  cookie: string;
  email: string;
  id: string;
}

/** A verified student with a session. A sign-in costs a password hash, so a test makes as few as it can. */
export async function student(label = "siswa"): Promise<Student> {
  const email = uniqueEmail(label);
  const cookie = await portalSignedIn(email);
  const row = await env.DB.prepare("SELECT id FROM users WHERE email = ?").bind(email).first<{ id: string }>();
  return { cookie, email, id: row!.id };
}

export const get = (path: string, who: { cookie: string }, init: Parameters<typeof portalCall>[1] = {}) => portalCall(path, { cookie: who.cookie, ...init });

export const putStep = (who: { cookie: string }, step: string, json: unknown, init: Parameters<typeof portalCall>[1] = {}) =>
  portalCall(stepPath(step), { method: "PUT", cookie: who.cookie, json, ...init });

export const submit = (who: { cookie: string }, init: Parameters<typeof portalCall>[1] = {}) => portalCall(SUBMIT, { method: "POST", cookie: who.cookie, json: {}, ...init });

/** Saves every step with its valid body (`over` replaces a step's body); fails the test when one is refused. Returns nothing: read the draft. */
export async function saveAll(who: { cookie: string }, over: Partial<Record<StepId, Body>> = {}) {
  for (const step of STEP_IDS) {
    const res = await putStep(who, step, over[step] ?? VALID[step]);
    expect(res.status, `saving ${step}: ${await res.clone().text()}`).toBe(200);
  }
}

export async function json<T = Record<string, any>>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

// ─── Rows ───

export interface DraftRow {
  id: string;
  user_id: string;
  batch_id: string;
  form_data: string;
  last_step: string | null;
  created_at: number;
  updated_at: number;
}

export async function draftOf(userId: string): Promise<DraftRow | null> {
  return env.DB.prepare("SELECT * FROM application_drafts WHERE user_id = ?").bind(userId).first<DraftRow>();
}

export async function applicationOf(userId: string) {
  return env.DB.prepare("SELECT * FROM student_applications WHERE user_id = ?").bind(userId).first<Record<string, any>>();
}

export async function countRows(table: string): Promise<number> {
  return (await env.DB.prepare(`SELECT count(*) AS n FROM ${table}`).first<{ n: number }>())!.n;
}

/** A file row, straight into the table (the upload route is another task's: these tests only need the rows). */
export async function addFileRow(applicationId: string, slot: SlotId, over: { size?: number; contentType?: string; deletedAt?: number | null; id?: string; createdAt?: number } = {}) {
  const id = over.id ?? crypto.randomUUID();
  const image = (over.contentType ?? "image/jpeg").startsWith("image/");
  await env.DB.prepare(
    "INSERT INTO application_files (id, application_id, slot, content_type, size, width, height, checksum, created_at, deleted_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
  )
    .bind(id, applicationId, slot, over.contentType ?? "image/jpeg", over.size ?? 1234, image ? 800 : null, image ? 600 : null, "0123456789abcdef0123456789abcdef", over.createdAt ?? Date.now(), over.deletedAt ?? null)
    .run();
  return id;
}

/** One live file in every required slot (and `dtks` when asked): a draft that has everything the submit wants. */
export async function addRequiredFiles(applicationId: string, options: { dtks?: boolean } = {}) {
  for (const slot of requiredSlots(options.dtks ?? false)) await addFileRow(applicationId, slot, { contentType: SLOTS[slot].types.includes("pdf") ? "application/pdf" : "image/jpeg" });
}

/** Sets the storage counter (the singleton row), as an upload of that many bytes in that many files would. */
export async function setStorage(bytes: number, files: number) {
  await env.DB.prepare("UPDATE private_storage SET bytes = ?, files = ? WHERE id = 'private-files'").bind(bytes, files).run();
}

export async function storage() {
  return (await env.DB.prepare("SELECT bytes, files FROM private_storage WHERE id = 'private-files'").first<{ bytes: number; files: number }>())!;
}

/** A student with a batch that is open, a complete draft and all its files: ready to submit. */
export async function readyToSubmit(label = "siswa") {
  const batch = await openBatch();
  const who = await student(label);
  await saveAll(who);
  const draft = (await draftOf(who.id))!;
  await addRequiredFiles(draft.id);
  return { batch, who, draft };
}

// ─── A race on purpose ───

/**
 * A D1 binding that runs `before` right before the first batch whose statements include one that matches `match`:
 * the moment between "the route read the state" and "the route wrote", in which something else may happen. The batch
 * then runs as usual, so what is asserted is what the guards of the statements did with the changed world.
 */
export function racing(real: D1Database, match: RegExp, before: () => Promise<unknown>): D1Database {
  const sqlOf = new WeakMap<object, string>();
  let fired = false;
  return new Proxy(real, {
    get(target, property) {
      const value = Reflect.get(target, property, target) as unknown;
      if (property === "prepare") {
        return (query: string) => {
          const statement = target.prepare(query);
          return new Proxy(statement, {
            get(inner, prop) {
              const member = Reflect.get(inner, prop, inner) as unknown;
              if (prop === "bind") {
                return (...values: unknown[]) => {
                  const bound = inner.bind(...values);
                  sqlOf.set(bound, query);
                  return bound;
                };
              }
              return typeof member === "function" ? (member as (...args: unknown[]) => unknown).bind(inner) : member;
            },
          });
        };
      }
      if (property === "batch") {
        return async (statements: D1PreparedStatement[]) => {
          if (!fired && statements.some((statement) => match.test(sqlOf.get(statement) ?? ""))) {
            fired = true;
            await before();
          }
          return target.batch(statements);
        };
      }
      return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(target) : value;
    },
  });
}

// ─── The console ───

/** Every console line of everything that runs until `restore()` (log, info, warn, error, debug), as text. */
export function captureConsole() {
  const lines: string[] = [];
  const spies = (["log", "info", "warn", "error", "debug"] as const).map((method) =>
    vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
      lines.push(args.map((arg) => (typeof arg === "string" ? arg : arg instanceof Error ? arg.message : JSON.stringify(arg))).join(" "));
    }),
  );
  return {
    lines,
    restore: () => spies.forEach((spy) => spy.mockRestore()),
  };
}

export { SLOT_IDS, STEP_IDS };
