import { FileText, ImageIcon } from "lucide-react";
import { type ChangeEvent, type ReactNode, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { SLOTS, slotLabel, type SlotId } from "@shared/application-form/slots";
import { acceptFor, checkPickedFile, checkSendSize, formatBytes, FILE_TYPE_INFO, typesHint } from "~/lib/files/accept";
import { fileHref, removeFile, uploadFile } from "~/lib/files/client";
import { prepareForUpload } from "~/lib/files/compress";
import type { StoredFile, UploadResponse } from "~/lib/files/types";

/**
 * One document slot of the application: what the student has uploaded to it, and the way to add, replace and remove
 * (docs/cloudflare/portal-api.md, section 11; docs/cloudflare/portal-architecture.md, section 8). The wizard's
 * documents and marketing steps (P3) put one per slot of `shared/application-form/slots.ts`:
 *
 *   <FileSlotField slot="family-card" files={filesOf("family-card")} onChange={apply} onUnauthorized={session.expire} disabled={!open} />
 *
 * It holds no files of its own: `files` is the student's live files of THIS slot (the `files` of
 * `GET applications/current`, filtered by slot), and every change that went through is reported to `onChange`, which the
 * wizard applies to its own state (and `response.draft.missingFiles` is what the stepper needs). Picking a file uploads it
 * right away: the field re-encodes an image in the browser first (smaller, and without EXIF or GPS data), then sends the
 * bytes with a progress bar; the Worker reads the BYTES and has the last word.
 *
 *  - Nothing is loaded by itself. A stored file is a "Lihat" link the student clicks, opened in a new tab through the
 *    Worker; a photo just picked shows a preview from the browser's memory. No file is ever behind a public address.
 *  - The file name the browser had is shown only here, in the progress line; it is never sent, stored or logged.
 *  - Several files at once (a slot that takes more than one) are sent one after the other, and the first refusal stops
 *    the rest with its own sentence.
 *  - "Batal" stops the upload that is going on and the ones waiting.
 *  - Removing asks first, in place: a child should not lose a scan to a stray tap.
 *
 * It is a `<fieldset>` (the kit's `Field group`): the legend is the slot's label. The first button's `id` is `id`
 * (default `file-<slot>`), so a summary of the step's errors can link to it.
 */

export type FileSlotChange =
  | { kind: "added"; file: StoredFile; response: UploadResponse }
  | { kind: "replaced"; removedId: string; file: StoredFile; response: UploadResponse }
  | { kind: "removed"; fileId: string };

export interface FileSlotFieldProps {
  slot: SlotId;
  /** The student's live files of this slot, oldest first. */
  files: readonly StoredFile[];
  onChange: (change: FileSlotChange) => void;
  /** The server said 401: the session is gone. The wizard sends the student back to sign in. */
  onUnauthorized?: () => void;
  /** An error that belongs to the slot from outside, e.g. the submit's "Berkas wajib belum lengkap". */
  error?: string;
  /** The batch is closed or the application sent: the list stays, nothing can be added or removed. */
  disabled?: boolean;
  /** Shows the asterisk. The wizard knows when `dtks` is required (only for a family registered in DTKS). */
  required?: boolean;
  hint?: ReactNode;
  id?: string;
  /**
   * Called with `true` when an upload (the whole queue of files picked together, or a replacement) or a delete starts, and
   * with `false` when it has ended, whatever way it ended: stored, refused, cancelled with "Batal", or the field going away
   * in the middle (a slot that is hidden while it uploads reports `false` as it goes). Once per change, never twice in a row
   * with the same value. The wizard uses it to hold "Selanjutnya" while a file is on its way.
   */
  onBusyChange?: (busy: boolean) => void;
}

interface Progress {
  name: string;
  fraction: number;
  /** 1-based place in the queue, and how many there are. */
  index: number;
  total: number;
}

/** An address for showing the bytes just sent, or null: a preview is a nicety, and must never cost the upload that already worked. */
function previewOf(blob: Blob): string | null {
  try {
    return typeof URL.createObjectURL === "function" ? URL.createObjectURL(blob) : null;
  } catch {
    return null;
  }
}

const typeLabel = (contentType: string) => Object.values(FILE_TYPE_INFO).find((info) => info.mime === contentType)?.label ?? "Berkas";

export function FileSlotField({ slot, files, onChange, onUnauthorized, error, disabled = false, required, hint, id, onBusyChange }: FileSlotFieldProps) {
  const spec = SLOTS[slot];
  const label = slotLabel(slot);
  const fieldId = id ?? `file-${slot}`;
  const input = useRef<HTMLInputElement>(null);
  const controller = useRef<AbortController | null>(null);
  // What the next pick does: add (`null`) or replace this file.
  const replacing = useRef<string | null>(null);
  // Previews of the images just uploaded in this session, made from the bytes in memory; a stored file has none.
  const previews = useRef(new Map<string, string>());
  // A second tap on "Ya, hapus" can arrive before React has drawn the disabled button: a ref, not the state, is the lock.
  const removeLock = useRef(false);
  const [, rerender] = useState(0);

  const [progress, setProgress] = useState<Progress | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const [confirming, setConfirming] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);

  const uploading = progress !== null;
  const room = spec.maxFiles - files.length;
  const shownError = localError ?? error;

  // Tell the page when a file is on its way (an upload or a delete): once per change, and "not busy" if the field goes away mid-way.
  const busy = uploading || removing !== null;
  const busyCallback = useRef(onBusyChange);
  const reportedBusy = useRef(false);
  useEffect(() => {
    busyCallback.current = onBusyChange;
  });
  useEffect(() => {
    if (reportedBusy.current === busy) return;
    reportedBusy.current = busy;
    busyCallback.current?.(busy);
  }, [busy]);
  useEffect(
    () => () => {
      if (!reportedBusy.current) return;
      reportedBusy.current = false;
      busyCallback.current?.(false);
    },
    [],
  );

  useEffect(() => {
    const urls = previews.current;
    return () => {
      controller.current?.abort();
      for (const url of urls.values()) URL.revokeObjectURL(url);
    };
  }, []);

  /** Lets go of the preview of a file that is no longer there. */
  function forget(fileId: string) {
    const url = previews.current.get(fileId);
    if (url) URL.revokeObjectURL(url);
    previews.current.delete(fileId);
  }

  function choose(replaceId: string | null) {
    replacing.current = replaceId;
    // Several at once only when adding to a slot with room for them; a replacement is one file.
    if (input.current) input.current.multiple = replaceId === null && room > 1;
    input.current?.click();
  }

  async function pick(event: ChangeEvent<HTMLInputElement>) {
    const picked = Array.from(event.target.files ?? []);
    event.target.value = ""; // the same file can be picked again after a refusal
    const replaceId = replacing.current;
    replacing.current = null;
    // One queue at a time: a second pick while the first is being prepared (re-encoding takes a moment) is ignored.
    if (picked.length === 0 || controller.current) return;
    setLocalError(null);
    setConfirming(null);

    const queue = replaceId ? picked.slice(0, 1) : picked.slice(0, Math.max(room, 0));
    const dropped = !replaceId && picked.length > queue.length;
    const abort = new AbortController();
    controller.current = abort;

    for (const [position, file] of queue.entries()) {
      const problem = checkPickedFile(slot, file);
      if (problem) return stop(problem);
      // From here the field is busy: the progress shows while the picture is re-encoded, then while it is sent.
      const at = { name: file.name, index: position + 1, total: queue.length };
      setProgress({ ...at, fraction: 0 });
      setAnnouncement(`Mengunggah ${file.name}`);
      const prepared = await prepareForUpload(file);
      if (abort.signal.aborted) return stop(null);
      const sizeProblem = checkSendSize(prepared.body.size);
      if (sizeProblem) return stop(sizeProblem);

      const outcome = await uploadFile({
        slot,
        body: prepared.body,
        replace: replaceId ?? undefined,
        signal: abort.signal,
        onProgress: (fraction) => setProgress({ ...at, fraction }),
      });
      if (!outcome.ok) {
        if (outcome.status === 401) onUnauthorized?.();
        return stop(outcome.code === "aborted" ? null : outcome.message);
      }

      const stored = outcome.response.file;
      const preview = stored.contentType.startsWith("image/") ? previewOf(prepared.body) : null;
      if (preview) previews.current.set(stored.id, preview);
      if (replaceId) forget(replaceId);
      setAnnouncement(`${file.name} selesai diunggah`);
      onChange(replaceId ? { kind: "replaced", removedId: replaceId, file: stored, response: outcome.response } : { kind: "added", file: stored, response: outcome.response });
      rerender((count) => count + 1);
    }
    controller.current = null;
    setProgress(null);
    if (dropped) setLocalError(`Slot ini hanya menampung ${spec.maxFiles} berkas. Sisanya tidak diunggah.`);

    /** Ends the queue: the progress goes, and `message` (null for a cancel) is what the student is told. */
    function stop(message: string | null) {
      controller.current = null;
      setProgress(null);
      if (message === null) {
        setAnnouncement("Unggahan dibatalkan");
      } else {
        setLocalError(message);
        setAnnouncement(message);
      }
    }
  }

  async function remove(fileId: string) {
    if (removeLock.current) return;
    removeLock.current = true;
    setLocalError(null);
    setRemoving(fileId);
    const outcome = await removeFile(fileId);
    removeLock.current = false;
    setRemoving(null);
    setConfirming(null);
    if (!outcome.ok) {
      if (outcome.status === 401) onUnauthorized?.();
      setLocalError(outcome.message);
      setAnnouncement(outcome.message);
      return;
    }
    forget(fileId);
    setAnnouncement("Berkas dihapus");
    onChange({ kind: "removed", fileId });
  }

  const hasRoom = room > 0;

  return (
    <Field group label={label} required={required} hint={hint ?? <>{typesHint(slot)}. Maksimal 10 MB per berkas.{spec.maxFiles > 1 ? ` Sampai ${spec.maxFiles} berkas.` : ""}</>} error={shownError} id={fieldId}>
      {files.length > 0 && (
        <ul className="mb-3 space-y-3">
          {files.map((file, index) => {
            const preview = previews.current.get(file.id);
            const isImage = file.contentType.startsWith("image/");
            return (
              <li key={file.id} className="flex flex-wrap items-center gap-3">
                {preview ? (
                  <img src={preview} alt={`Pratinjau berkas ${index + 1} ${label}`} className="size-16 shrink-0 rounded-lg border border-gray-200 object-cover" />
                ) : (
                  <span className="flex size-16 shrink-0 items-center justify-center rounded-lg border border-gray-200 bg-gray-50 text-gray-400" aria-hidden="true">
                    {isImage ? <ImageIcon size={22} /> : <FileText size={22} />}
                  </span>
                )}
                <div className="min-w-0 flex-1 text-sm">
                  <div className="font-medium text-gray-900">Berkas {index + 1}</div>
                  <div className="text-xs text-gray-500">
                    {typeLabel(file.contentType)} · {formatBytes(file.size)}
                  </div>
                  <a href={fileHref(file.id)} target="_blank" rel="noopener noreferrer" className="text-xs text-primary-blue hover:underline">
                    {isImage ? "Lihat" : "Unduh"}
                    <span className="sr-only">{` berkas ${index + 1} ${label}`}</span>
                  </a>
                </div>
                {!disabled &&
                  (confirming === file.id ? (
                    <div className="flex flex-wrap items-center gap-2" role="group" aria-label={`Hapus berkas ${index + 1} ${label}?`}>
                      <span className="text-sm text-gray-700">Hapus berkas ini?</span>
                      <Button variant="danger" disabled={removing !== null} onClick={() => void remove(file.id)}>
                        {removing === file.id ? "Menghapus..." : "Ya, hapus"}
                      </Button>
                      <Button variant="neutral" disabled={removing !== null} onClick={() => setConfirming(null)}>
                        Batal
                      </Button>
                    </div>
                  ) : (
                    <div className="flex flex-wrap items-center gap-2">
                      <Button variant="neutral" disabled={uploading} aria-label={`Ganti berkas ${index + 1} ${label}`} onClick={() => choose(file.id)}>
                        Ganti
                      </Button>
                      <Button variant="neutral" disabled={uploading} aria-label={`Hapus berkas ${index + 1} ${label}`} onClick={() => setConfirming(file.id)}>
                        Hapus
                      </Button>
                    </div>
                  ))}
              </li>
            );
          })}
        </ul>
      )}

      {!disabled && (
        <div className="flex flex-wrap items-center gap-2">
          {hasRoom && (
            <Button id={fieldId} variant={files.length === 0 ? "primary" : "neutral"} disabled={uploading} onClick={() => choose(null)}>
              {files.length === 0 ? "Pilih berkas" : "Tambah berkas"}
            </Button>
          )}
          {uploading && (
            <Button variant="neutral" onClick={() => controller.current?.abort()}>
              Batal
            </Button>
          )}
        </div>
      )}
      {!disabled && !hasRoom && files.length > 0 && <p className="text-xs text-gray-500">Slot ini sudah penuh. Hapus atau ganti satu berkas untuk mengubahnya.</p>}

      {/* Not reachable by Tab (the buttons are), and not announced: the buttons carry the meaning. */}
      <input
        ref={input}
        type="file"
        tabIndex={-1}
        aria-hidden="true"
        accept={acceptFor(slot)}
        disabled={disabled || uploading}
        onChange={(event) => void pick(event)}
        className="sr-only"
      />

      {progress && (
        <div className="mt-3">
          <div
            role="progressbar"
            aria-label={`Mengunggah ${progress.name}${progress.total > 1 ? `, ${progress.index} dari ${progress.total}` : ""}`}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(progress.fraction * 100)}
            className="h-2 overflow-hidden rounded-full bg-gray-100"
          >
            <div className="h-full bg-primary-blue transition-[width]" style={{ width: `${Math.round(progress.fraction * 100)}%` }} />
          </div>
          <p className="mt-1 text-xs text-gray-500" aria-hidden="true">
            {Math.round(progress.fraction * 100)}%
          </p>
        </div>
      )}
      <p role="status" className="sr-only">
        {announcement}
      </p>
    </Field>
  );
}
