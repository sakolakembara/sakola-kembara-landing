import { FileText, ImageIcon } from "lucide-react";
import { type ChangeEvent, type ReactNode, useEffect, useRef, useState } from "react";
import { Button } from "~/components/ui/button";
import { Field } from "~/components/ui/field";
import { discardUpload, uploadFile, useUploadsBase, type UploadResult } from "~/lib/crud/upload-client";
import { acceptFor, checkUploadFile, fileNameOf, FILE_TYPES, UPLOAD_KINDS, type UploadKindName, uploadUrl } from "~/lib/crud/upload-kinds";

/**
 * A file or an image field (docs/cloudflare/admin-crud.md#10-files-upload-references, docs/cloudflare/uploads.md).
 * The form never holds a file, only the PATH of one that was already uploaded: picking a file uploads it
 * right away to `POST /api/admin/uploads` and hands the path to `onChange`; the form saves that path with the
 * rest, and the Worker deletes the old file after the save.
 *
 *  - Client checks first (empty, too big, wrong type) with the Worker's own words, so a 30 MB file is refused
 *    before it is sent. The Worker still reads the bytes and has the last word.
 *  - Progress is a `role="progressbar"`; the start and the end are announced (`role="status"`), the percentage
 *    is not, so a screen reader is not read to for the whole upload. "Batal" stops it.
 *  - An image shows a preview (the file just picked from memory; a stored path from the public files domain,
 *    `uploadsBaseUrl` of `GET /api/config`); a PDF shows its file name as a link.
 *  - "Ganti" and "Hapus" change the value. A file uploaded in THIS form and then replaced or removed is deleted
 *    from R2 again, so abandoned versions do not pile up; a file that was already saved is never touched here
 *    (the Worker removes it after the save, when nothing uses it any more).
 *
 * It is a `<fieldset>` (the kit's `Field group`): the legend is the label, and the hint and the error describe the
 * set. A control's `id` is `id`, so the error summary of `FormShell` can link to the "Pilih file" button.
 */
export interface UploadFieldProps {
  /** The field name and the id of the first control. */
  id: string;
  label: ReactNode;
  kind: UploadKindName;
  /** The stored path (`/uploads/...`, or a legacy static path), or null. */
  value: string | null;
  onChange: (path: string | null, result?: UploadResult) => void;
  hint?: ReactNode;
  /** An error of the form (from the Worker's `fields`); the field's own refusals are shown too. */
  error?: string;
  required?: boolean;
  disabled?: boolean;
}

type Progress = { name: string; fraction: number } | null;

/** An address for showing the file just picked, or null: a preview is a nicety, and must never cost the upload that already worked. */
function previewOf(file: File): string | null {
  try {
    return typeof URL.createObjectURL === "function" ? URL.createObjectURL(file) : null;
  } catch {
    return null;
  }
}

export function UploadField({ id, label, kind, value, onChange, hint, error, required, disabled = false }: UploadFieldProps) {
  const rule = UPLOAD_KINDS[kind];
  const isImage = rule.types.every((type) => FILE_TYPES[type].mime.startsWith("image/"));
  const base = useUploadsBase();
  const input = useRef<HTMLInputElement>(null);
  const controller = useRef<AbortController | null>(null);

  const [progress, setProgress] = useState<Progress>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const [broken, setBroken] = useState(false);
  // Uploaded in this form: path -> media id (to discard it when replaced) and a preview made from the file itself.
  const own = useRef(new Map<string, { id: string; preview: string | null }>());
  const [, rerender] = useState(0);

  const uploading = progress !== null;
  const shownError = localError ?? error;

  useEffect(() => {
    const files = own.current;
    return () => {
      controller.current?.abort();
      for (const { preview } of files.values()) if (preview) URL.revokeObjectURL(preview);
    };
  }, []);

  useEffect(() => setBroken(false), [value]);

  function release(path: string | null) {
    if (!path) return;
    const mine = own.current.get(path);
    if (!mine) return;
    own.current.delete(path);
    if (mine.preview) URL.revokeObjectURL(mine.preview);
    discardUpload(mine.id);
  }

  async function pick(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = ""; // the same file can be picked again after a refusal
    if (!file) return;
    setLocalError(null);
    const problem = checkUploadFile(file, kind);
    if (problem) {
      setLocalError(problem);
      setAnnouncement(problem);
      return;
    }

    const abort = new AbortController();
    controller.current = abort;
    setProgress({ name: file.name, fraction: 0 });
    setAnnouncement(`Mengunggah ${file.name}`);
    const outcome = await uploadFile({ kind, file, signal: abort.signal, onProgress: (fraction) => setProgress({ name: file.name, fraction }) });
    controller.current = null;
    setProgress(null);

    if (!outcome.ok) {
      if (outcome.code === "aborted") setAnnouncement("Unggahan dibatalkan");
      else {
        setLocalError(outcome.message);
        setAnnouncement(outcome.message);
      }
      return;
    }
    const previous = value;
    const preview = isImage ? previewOf(file) : null;
    own.current.set(outcome.result.path, { id: outcome.result.id, preview });
    setAnnouncement(`${file.name} selesai diunggah`);
    onChange(outcome.result.path, outcome.result);
    release(previous);
    rerender((count) => count + 1);
  }

  function remove() {
    const previous = value;
    setLocalError(null);
    setAnnouncement("");
    onChange(null);
    release(previous);
  }

  const mine = value ? own.current.get(value) : undefined;
  const previewSrc = value ? (mine?.preview ?? uploadUrl(value, base)) : null;

  return (
    <Field group label={label} required={required} hint={hint} error={shownError} id={id}>
      <div className="flex flex-wrap items-center gap-4">
        {value && (
          <div className="flex min-w-0 items-center gap-3">
            {isImage ? (
              broken || !previewSrc ? (
                <span className="flex size-20 shrink-0 items-center justify-center rounded-lg border border-gray-200 bg-gray-50 text-gray-400" role="img" aria-label="Pratinjau tidak tersedia">
                  <ImageIcon size={24} aria-hidden="true" />
                </span>
              ) : (
                <img src={previewSrc} alt={`Pratinjau ${typeof label === "string" ? label : "gambar"}`} onError={() => setBroken(true)} className="size-20 shrink-0 rounded-lg border border-gray-200 object-cover" />
              )
            ) : (
              <span className="flex min-w-0 items-center gap-2 text-sm text-gray-700">
                <FileText size={20} aria-hidden="true" className="shrink-0 text-gray-400" />
                <a href={uploadUrl(value, base)} target="_blank" rel="noopener noreferrer" className="truncate text-primary-blue hover:underline">
                  {fileNameOf(value)}
                </a>
              </span>
            )}
          </div>
        )}

        {!disabled && (
          <div className="flex flex-wrap items-center gap-2">
            <Button id={id} variant="neutral" disabled={uploading} onClick={() => input.current?.click()}>
              {value ? "Ganti" : "Pilih file"}
            </Button>
            {value && !uploading && (
              <Button variant="neutral" onClick={remove}>
                Hapus
              </Button>
            )}
            {uploading && (
              <Button variant="neutral" onClick={() => controller.current?.abort()}>
                Batal
              </Button>
            )}
          </div>
        )}
      </div>

      {/* Not reachable by Tab (the buttons are), and not announced: the buttons carry the meaning. */}
      <input ref={input} type="file" tabIndex={-1} aria-hidden="true" accept={acceptFor(kind)} disabled={disabled || uploading} onChange={pick} className="sr-only" />

      {progress && (
        <div className="mt-3">
          <div
            role="progressbar"
            aria-label={`Mengunggah ${progress.name}`}
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
