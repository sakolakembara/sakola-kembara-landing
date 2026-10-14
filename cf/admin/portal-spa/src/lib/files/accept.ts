import { MAX_FILE_BYTES } from "../../../../shared/application-form/limits";
import { SLOTS, type SlotFileType, type SlotId } from "../../../../shared/application-form/slots";

// What a file input of the portal offers and what the browser refuses BEFORE it sends anything (a service to the
// student's data plan: a 30 MB scan or an .exe is refused on the phone, not after the upload). The server reads the
// BYTES and has the last word (docs/cloudflare/portal-api.md, 11.2); these are the same sentences it would answer.
// Pure: no DOM, no React.

export const FILE_TYPE_INFO: Record<SlotFileType, { label: string; mime: string; extensions: readonly string[] }> = {
  png: { label: "PNG", mime: "image/png", extensions: [".png"] },
  jpeg: { label: "JPEG", mime: "image/jpeg", extensions: [".jpg", ".jpeg"] },
  webp: { label: "WebP", mime: "image/webp", extensions: [".webp"] },
  pdf: { label: "PDF", mime: "application/pdf", extensions: [".pdf"] },
};

export const FILE_MESSAGES = {
  empty: "File kosong.",
  tooBig: "Ukuran file maksimal 10 MB.",
  type: (slot: SlotId) => `Tipe file tidak didukung. Gunakan: ${SLOTS[slot].types.map((type) => FILE_TYPE_INFO[type].label).join(", ")}.`,
} as const;

/**
 * The `accept` of the slot's file input: explicit types, never `image/*`. An iPhone converts a HEIC photo to JPEG when
 * the input lists JPEG and not "any image", instead of offering a format the server refuses
 * (docs/cloudflare/portal-architecture.md, 8.3).
 */
export function acceptFor(slot: SlotId): string {
  return SLOTS[slot].types.map((type) => FILE_TYPE_INFO[type].mime).join(",");
}

/** What the slot takes, for the hint under the field: "PNG, JPEG, WebP, PDF". */
export function typesHint(slot: SlotId): string {
  return SLOTS[slot].types.map((type) => FILE_TYPE_INFO[type].label).join(", ");
}

/** The part of a `File` the checks read, so they run on a plain object too. */
export interface FileLike {
  name: string;
  size: number;
  /** The type the browser guessed from the name. Empty is common (and fine: the extension is then looked at). */
  type: string;
}

/** The stored type a browser's guess or an extension names, or null. */
export function typeOfPicked(file: Pick<FileLike, "name" | "type">): SlotFileType | null {
  const claimed = file.type.toLowerCase();
  for (const type of Object.keys(FILE_TYPE_INFO) as SlotFileType[]) if (FILE_TYPE_INFO[type].mime === claimed) return type;
  if (claimed !== "") return null;
  const lower = file.name.toLowerCase();
  for (const type of Object.keys(FILE_TYPE_INFO) as SlotFileType[]) if (FILE_TYPE_INFO[type].extensions.some((extension) => lower.endsWith(extension))) return type;
  return null;
}

/**
 * The sentence to show when `file` cannot go into `slot`, or null when it may be tried: not empty, not over 10 MB, a
 * type the slot takes (by the browser's guess or, with none, by the extension). The size is checked again on what is
 * actually sent, after an image has been re-encoded (src/lib/files/compress.ts).
 */
export function checkPickedFile(slot: SlotId, file: FileLike): string | null {
  if (file.size === 0) return FILE_MESSAGES.empty;
  const type = typeOfPicked(file);
  if (!type || !SLOTS[slot].types.includes(type)) return FILE_MESSAGES.type(slot);
  // A PDF goes as it is, so its size is the one that counts; an image is re-encoded smaller and checked again after.
  if (type === "pdf" && file.size > MAX_FILE_BYTES) return FILE_MESSAGES.tooBig;
  return null;
}

/** The size check of what will really be sent. */
export function checkSendSize(size: number): string | null {
  return size === 0 ? FILE_MESSAGES.empty : size > MAX_FILE_BYTES ? FILE_MESSAGES.tooBig : null;
}

/** "812 kB", "1,8 MB": decimal units, as the Worker's limits and messages write them. */
export function formatBytes(bytes: number): string {
  if (bytes < 1000) return `${bytes} B`;
  const [value, unit] = bytes < 1_000_000 ? [bytes / 1000, "kB"] : [bytes / 1_000_000, "MB"];
  return `${value.toLocaleString("id-ID", { maximumFractionDigits: 1 })} ${unit}`;
}
