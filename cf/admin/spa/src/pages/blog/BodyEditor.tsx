import { Edit3, Eye, ImagePlus } from "lucide-react";
import { type ChangeEvent, useEffect, useRef, useState } from "react";
import { Alert } from "~/components/ui/alert";
import { Button } from "~/components/ui/button";
import { uploadFile, useUploadsBase } from "~/lib/crud/upload-client";
import { acceptFor, checkUploadFile, uploadUrl } from "~/lib/crud/upload-kinds";
import { BODY_LIMIT_LABEL, imageMarkdown, insertAtCursor, LIMITS } from "./rules";
import { usePreview } from "./usePreview";

// The article body: a plain textarea, a toggle between writing and the preview, and a button that uploads an
// image and writes its markdown at the cursor. No editor library: a textarea costs nothing, and the preview is the
// Worker's own render (usePreview), so what is shown is what will be stored. The legacy editor was this, with the
// preview rendered in the browser by react-markdown.

export type BodyMode = "edit" | "preview";

export interface BodyEditorProps {
  /** The textarea's id: the field name, so the error summary can link to it. */
  id: string;
  value: string;
  onChange: (next: string) => void;
  mode: BodyMode;
  onModeChange: (mode: BodyMode) => void;
  error?: string;
  /** No write access: the text can be read, nothing else is offered (the preview is a write-only route). */
  readOnly?: boolean;
}

const MODE_BUTTON = "inline-flex items-center gap-1 rounded-md px-3 py-1 text-xs transition-colors";

export function BodyEditor({ id, value, onChange, mode, onModeChange, error, readOnly = false }: BodyEditorProps) {
  const textarea = useRef<HTMLTextAreaElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const previewing = mode === "preview" && !readOnly;
  const preview = usePreview(value, previewing);
  const base = useUploadsBase();

  // Uploaded pictures are served from the files domain, not from this host: show them from there.
  const pane = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!previewing || !pane.current) return;
    for (const image of pane.current.querySelectorAll<HTMLImageElement>('img[src^="/uploads/"]')) {
      image.setAttribute("src", uploadUrl(image.getAttribute("src") ?? "", base));
    }
  }, [previewing, preview.html, preview.status, base]);

  async function insertImage(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = ""; // the same file can be picked again
    if (!file) return;
    setUploadError(null);
    const problem = checkUploadFile(file, "blog-image");
    if (problem) {
      setUploadError(problem);
      return;
    }
    setUploading(true);
    const outcome = await uploadFile({ kind: "blog-image", file });
    setUploading(false);
    if (!outcome.ok) {
      setUploadError(outcome.message);
      return;
    }
    const field = textarea.current;
    const at = insertAtCursor(value, field?.selectionStart ?? value.length, field?.selectionEnd ?? value.length, imageMarkdown(file.name, outcome.result.path));
    onChange(at.value);
    onModeChange("edit");
    // Put the cursor after the picture once React has written the new text.
    requestAnimationFrame(() => {
      const target = textarea.current;
      if (!target) return;
      target.focus();
      target.setSelectionRange(at.cursor, at.cursor);
    });
  }

  const count = value.length;
  const over = count > LIMITS.bodyMax;

  return (
    <div>
      <div className="overflow-hidden rounded-lg border border-gray-200">
        {!readOnly && (
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-200 bg-gray-50 px-3 py-2">
            <div className="flex gap-1" role="tablist" aria-label="Mode editor">
              <button
                type="button"
                role="tab"
                id={`${id}-tab-edit`}
                aria-selected={mode === "edit"}
                aria-controls={`${id}-panel`}
                onClick={() => onModeChange("edit")}
                className={`${MODE_BUTTON} ${mode === "edit" ? "bg-primary text-primary-foreground" : "border border-gray-200 bg-white text-gray-700 hover:bg-gray-100"}`}
              >
                <Edit3 size={12} aria-hidden="true" /> Tulis
              </button>
              <button
                type="button"
                role="tab"
                id={`${id}-tab-preview`}
                aria-selected={mode === "preview"}
                aria-controls={`${id}-panel`}
                onClick={() => onModeChange("preview")}
                className={`${MODE_BUTTON} ${mode === "preview" ? "bg-primary text-primary-foreground" : "border border-gray-200 bg-white text-gray-700 hover:bg-gray-100"}`}
              >
                <Eye size={12} aria-hidden="true" /> Preview
              </button>
            </div>

            <div className="flex items-center gap-2">
              <input ref={picker} type="file" tabIndex={-1} aria-hidden="true" accept={acceptFor("blog-image")} disabled={uploading} onChange={insertImage} className="sr-only" />
              <button
                type="button"
                onClick={() => picker.current?.click()}
                disabled={uploading}
                className="inline-flex items-center gap-1 rounded-md border border-gray-200 bg-white px-3 py-1 text-xs text-gray-700 transition-colors hover:bg-gray-100 disabled:opacity-60"
              >
                <ImagePlus size={12} aria-hidden="true" />
                {uploading ? "Mengupload..." : "Sisipkan Gambar"}
              </button>
            </div>
          </div>
        )}

        {uploadError && (
          <div role="alert" className="border-b border-red-200 bg-red-50 px-4 py-2 text-xs text-red-700">
            {uploadError}
          </div>
        )}

        <div id={`${id}-panel`} role={readOnly ? undefined : "tabpanel"} aria-labelledby={readOnly ? undefined : `${id}-tab-${previewing ? "preview" : "edit"}`}>
          {/* Kept in the page while the preview shows: a hidden control cannot be focused by the error summary, and the text is not lost. */}
          <textarea
            ref={textarea}
            id={id}
            name={id}
            aria-label="Isi Artikel"
            hidden={previewing}
            rows={24}
            value={value}
            readOnly={readOnly}
            aria-invalid={error ? true : undefined}
            aria-describedby={`${id}-count`}
            onChange={(event) => onChange(event.target.value)}
            placeholder={"# Judul Sub Bagian\n\nTulis paragraf di sini..."}
            className="min-h-[400px] w-full resize-y px-4 py-3 font-mono text-sm focus:outline-none"
          />
          {previewing && (
            <div ref={pane} className="blog-content min-h-[400px] overflow-auto bg-white px-5 py-4" aria-busy={preview.status === "loading"}>
              {preview.status === "empty" && <p className="italic text-gray-500">Belum ada isi.</p>}
              {preview.status === "error" && (
                <div className="space-y-3">
                  <Alert>{preview.message}</Alert>
                  <Button variant="neutral" onClick={preview.retry}>
                    Coba lagi
                  </Button>
                </div>
              )}
              {preview.status === "loading" && preview.html === "" && (
                <p role="status" className="text-sm text-gray-500">
                  Memuat pratinjau...
                </p>
              )}
              {(preview.status === "ready" || (preview.status === "loading" && preview.html !== "")) && <div dangerouslySetInnerHTML={{ __html: preview.html }} />}
            </div>
          )}
        </div>
      </div>

      <div className="mt-2 flex items-center justify-between gap-3 text-xs text-gray-500">
        <span id={`${id}-count`} className={over ? "text-danger-fg" : undefined}>
          {count.toLocaleString("id-ID")} karakter (maksimal {BODY_LIMIT_LABEL})
        </span>
        {/* The form's error summary announces it; this is where the eye is. */}
        {error && <span className="text-danger-fg">{error}</span>}
      </div>
    </div>
  );
}
