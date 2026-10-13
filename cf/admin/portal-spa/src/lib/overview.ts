// `GET /portal/api/overview`: the home page in one call (docs/cloudflare/portal-api.md#43-get-portalapioverview).
// Pure: no DOM, no React. A body that does not have the shape is `null` (an error screen), never a page of blanks.

export interface OpenBatch {
  id: string;
  year: number;
  name: string;
  description: string | null;
  opensAt: string;
  closesAt: string;
}

/** The student's side of the open batch: nothing yet, a draft saved on the server, or the application sent. */
export type CurrentState = { state: "none" } | { state: "draft"; updatedAt: string } | { state: "submitted"; submittedAt: string };

/** A batch the student has applied to. Deliberately verdict-free: `published` only says the results are out. */
export interface HistoryItem {
  id: string;
  batch: { year: number; name: string };
  submittedAt: string;
  published: boolean;
}

export interface Overview {
  /** The server's clock: "sisa waktu" counts from it, not from the phone's. */
  now: string;
  student: { name: string; firstName: string };
  openBatch: OpenBatch | null;
  current: CurrentState;
  history: HistoryItem[];
}

type Obj = Record<string, unknown>;

function obj(value: unknown): Obj | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Obj) : null;
}

/** An ISO date the browser can read, or null. */
function isoDate(value: unknown): string | null {
  return typeof value === "string" && !Number.isNaN(Date.parse(value)) ? value : null;
}

function parseOpenBatch(raw: unknown): OpenBatch | null | undefined {
  if (raw === null) return null;
  const batch = obj(raw);
  if (!batch) return undefined;
  const opensAt = isoDate(batch.opensAt);
  const closesAt = isoDate(batch.closesAt);
  if (typeof batch.id !== "string" || typeof batch.year !== "number" || typeof batch.name !== "string" || !opensAt || !closesAt) {
    return undefined;
  }
  const description = typeof batch.description === "string" && batch.description.trim() !== "" ? batch.description : null;
  return { id: batch.id, year: batch.year, name: batch.name, description, opensAt, closesAt };
}

function parseCurrent(raw: unknown): CurrentState | null {
  const current = obj(raw);
  if (!current) return null;
  if (current.state === "none") return { state: "none" };
  if (current.state === "draft") {
    const updatedAt = isoDate(current.updatedAt);
    return updatedAt ? { state: "draft", updatedAt } : null;
  }
  if (current.state === "submitted") {
    const submittedAt = isoDate(current.submittedAt);
    return submittedAt ? { state: "submitted", submittedAt } : null;
  }
  return null;
}

function parseHistory(raw: unknown): HistoryItem[] {
  if (!Array.isArray(raw)) return [];
  const items: HistoryItem[] = [];
  for (const entry of raw) {
    const item = obj(entry);
    const batch = obj(item?.batch);
    const submittedAt = isoDate(item?.submittedAt);
    if (!item || !batch || typeof item.id !== "string" || typeof batch.year !== "number" || typeof batch.name !== "string" || !submittedAt) continue;
    items.push({ id: item.id, batch: { year: batch.year, name: batch.name }, submittedAt, published: item.published === true });
  }
  return items;
}

export function parseOverview(raw: unknown): Overview | null {
  const body = obj(raw);
  if (!body) return null;
  const now = isoDate(body.now);
  const student = obj(body.student);
  const openBatch = parseOpenBatch(body.openBatch);
  const current = parseCurrent(body.current);
  if (!now || !student || openBatch === undefined || !current) return null;
  const name = typeof student.name === "string" ? student.name : "";
  // The first word of the name; "Sakemers" when there is none (the legacy greeting).
  const firstName = typeof student.firstName === "string" && student.firstName.trim() !== "" ? student.firstName.trim() : "Sakemers";
  return { now, student: { name, firstName }, openBatch, current, history: parseHistory(body.history) };
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Whole days until a batch closes, counted from the server's clock and never below 0 (the legacy rule). */
export function daysLeft(closesAt: string, now: string): number {
  return Math.max(0, Math.ceil((Date.parse(closesAt) - Date.parse(now)) / DAY_MS));
}
