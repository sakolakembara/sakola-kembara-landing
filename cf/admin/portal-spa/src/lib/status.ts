// `GET /portal/api/applications`: the student's applications and what they may know about each
// (docs/cloudflare/portal-api.md#10-status-and-the-privacy-contract). Pure: no DOM, no React.
//
// The privacy promise: a verdict is shown only after the batch's results are published, and the API does not even
// send one before. This file keeps the SPA on the same side of it. It reads ONLY `result`, and what it does not
// recognise it reads as "still being processed", the one answer that says nothing: a field the API adds, a state it
// invents or a decision it misspells can never turn into "Kamu diterima" on a child's screen.

export interface StatusBatch {
  id: string;
  year: number;
  name: string;
}

export type StatusResult =
  | { state: "processing" }
  | { state: "awaiting_decision"; announcedAt: string }
  | { state: "decided"; decision: "accepted" | "rejected"; announcedAt: string; notes: string | null };

export interface StatusItem {
  id: string;
  batch: StatusBatch;
  submittedAt: string;
  result: StatusResult;
}

type Obj = Record<string, unknown>;

function obj(value: unknown): Obj | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Obj) : null;
}

function isoDate(value: unknown): string | null {
  return typeof value === "string" && !Number.isNaN(Date.parse(value)) ? value : null;
}

const PROCESSING: StatusResult = { state: "processing" };

/** The reading of one `result`: anything that is not exactly one of the three known shapes is "processing". */
export function parseResult(raw: unknown): StatusResult {
  const result = obj(raw);
  if (!result) return PROCESSING;
  const announcedAt = isoDate(result.announcedAt);
  if (result.state === "awaiting_decision" && announcedAt) return { state: "awaiting_decision", announcedAt };
  if (result.state === "decided" && announcedAt && (result.decision === "accepted" || result.decision === "rejected")) {
    const notes = typeof result.notes === "string" && result.notes.trim() !== "" ? result.notes : null;
    return { state: "decided", decision: result.decision, announcedAt, notes };
  }
  return PROCESSING;
}

/** The body of `GET /portal/api/applications`; null when it is not `{ items: [...] }`. An item without an id, batch or send time is skipped. */
export function parseStatusItems(raw: unknown): StatusItem[] | null {
  const body = obj(raw);
  if (!body || !Array.isArray(body.items)) return null;
  const items: StatusItem[] = [];
  for (const entry of body.items) {
    const item = obj(entry);
    const batch = obj(item?.batch);
    const submittedAt = isoDate(item?.submittedAt);
    if (!item || !batch || typeof item.id !== "string" || typeof batch.id !== "string" || typeof batch.year !== "number" || typeof batch.name !== "string" || !submittedAt) continue;
    items.push({ id: item.id, batch: { id: batch.id, year: batch.year, name: batch.name }, submittedAt, result: parseResult(item.result) });
  }
  return items;
}

export type Tone = "accepted" | "rejected" | "pending";

export interface StatusView {
  tone: Tone;
  eyebrow: string;
  headline: string;
  body: string;
}

/**
 * What the student reads for one result: the words of the legacy status page (`statusView` in
 * app/(portal)/portal/status/page.tsx), chosen from the state the API sent. The admin's review note is the body of a
 * decision when there is one.
 */
export function statusView(result: StatusResult): StatusView {
  switch (result.state) {
    case "processing":
      return {
        tone: "pending",
        eyebrow: "Sedang Diproses",
        headline: "Pendaftaran kamu sedang diproses",
        body: "Terima kasih sudah mendaftar. Panitia akan mengabari hasilnya di halaman ini setelah semua pendaftar batch ini selesai dinilai. Kamu tidak perlu mengirim ulang berkas.",
      };
    case "awaiting_decision":
      // The batch is published but this application has no decision yet (the admin's publish guard should prevent it).
      return {
        tone: "pending",
        eyebrow: "Sedang Diproses",
        headline: "Menunggu keputusan",
        body: "Hasil batch ini sudah diumumkan, tapi keputusan untuk pendaftaran kamu belum tercatat. Silakan hubungi panitia via WhatsApp jika kondisi ini tidak berubah dalam 1×24 jam.",
      };
    case "decided":
      return result.decision === "accepted"
        ? {
            tone: "accepted",
            eyebrow: "Selamat",
            headline: "Kamu diterima",
            body:
              result.notes ??
              "Selamat, kamu diterima sebagai calon siswa Sakola Kembara. Panitia akan menghubungi kamu lewat WhatsApp untuk langkah selanjutnya.",
          }
        : {
            tone: "rejected",
            eyebrow: "Terima Kasih",
            headline: "Belum lolos tahun ini",
            body:
              result.notes ??
              "Terima kasih atas kesediaan kamu mendaftar. Untuk batch ini, panitia belum bisa menerima pendaftaran kamu. Kamu boleh mencoba lagi di batch berikutnya.",
          };
  }
}

/** The time of the announcement, when the result has one. */
export function announcedAt(result: StatusResult): string | null {
  return result.state === "processing" ? null : result.announcedAt;
}
