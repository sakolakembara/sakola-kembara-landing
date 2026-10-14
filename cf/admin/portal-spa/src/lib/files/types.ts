import { isSlotId, type SlotId } from "../../../../shared/application-form/slots";

// What the file routes of the portal answer (docs/cloudflare/portal-api.md, 5.1 and 11.2), as the browser reads it. Pure
// (no DOM, no React): the Worker's contract test (test/portal-files-spa-contract.test.ts) imports it and runs it against
// the real routes, and the wizard (P3) reads the same shapes from `GET /portal/api/applications/current`.

/** A file the student has stored. Never a key, a checksum or the name the browser had: none of them exists. */
export interface StoredFile {
  id: string;
  slot: SlotId;
  contentType: string;
  size: number;
  /** Pixels; null for a PDF. */
  width: number | null;
  height: number | null;
  uploadedAt: string;
}

export interface Usage {
  slotCount: number;
  slotMax: number;
  applicationFiles: number;
  applicationBytes: number;
}

/** The `201` of an upload: the file, how full the slot and the application are, and what the draft still lacks. */
export interface UploadResponse {
  file: StoredFile;
  usage: Usage;
  draft: { id: string; missingFiles: SlotId[] };
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const isCount = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0;
const isDimension = (value: unknown): value is number | null => value === null || (typeof value === "number" && Number.isFinite(value) && value > 0);

/** A stored file out of an answer, or null when it is not one (`files` of `applications/current` and the `file` of an upload). */
export function parseStoredFile(raw: unknown): StoredFile | null {
  if (!isRecord(raw)) return null;
  const { id, slot, contentType, size, width, height, uploadedAt } = raw;
  if (typeof id !== "string" || id === "" || !isSlotId(slot) || typeof contentType !== "string" || !isCount(size) || !isDimension(width) || !isDimension(height) || typeof uploadedAt !== "string") return null;
  return { id, slot, contentType, size, width, height, uploadedAt };
}

export function parseUploadResponse(raw: unknown): UploadResponse | null {
  if (!isRecord(raw) || !isRecord(raw.usage) || !isRecord(raw.draft)) return null;
  const file = parseStoredFile(raw.file);
  const { slotCount, slotMax, applicationFiles, applicationBytes } = raw.usage;
  const { id, missingFiles } = raw.draft;
  if (!file || !isCount(slotCount) || !isCount(slotMax) || !isCount(applicationFiles) || !isCount(applicationBytes)) return null;
  if (typeof id !== "string" || !Array.isArray(missingFiles) || !missingFiles.every(isSlotId)) return null;
  return { file, usage: { slotCount, slotMax, applicationFiles, applicationBytes }, draft: { id, missingFiles } };
}
