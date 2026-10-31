import { Eye, ImagePlus, PencilLine } from "lucide-react";
import { lazy, type ReactNode, Suspense, useEffect, useRef, useState } from "react";
import { Alert } from "~/components/ui/alert";
import { Button } from "~/components/ui/button";
import { Skeleton } from "~/components/ui/skeleton";
import { useConfig } from "~/lib/config";
import { useUploadsBase } from "~/lib/crud/upload-client";
import { storedFileUrl } from "~/lib/crud/upload-kinds";
import { EditorBoundary } from "./editor/EditorBoundary";
import type { RichEditorHandle } from "./editor/RichEditor";
import { BODY_LIMIT_LABEL, LIMITS } from "./rules";
import { usePreview } from "./usePreview";

// The article body: the page it is written on (a title above it, TipTap under it; see editor/RichEditor.tsx), a count
// under it, and "Pratinjau", which shows what the Worker renders from the text (usePreview), so what is shown is what
// will be stored. The editor is a separate file that loads when it is first shown; if it cannot load, a plain box
// takes its place, because the text is Markdown either way.

export type BodyMode = "edit" | "preview";

export interface BodyEditorProps {
  /** The editable element's id: the field name, so the error summary can link to it. */
  id: string;
  /** The page's first line: the title, written in the page. */
  header?: ReactNode;
  value: string;
  onChange: (next: string) => void;
  mode: BodyMode;
  onModeChange: (mode: BodyMode) => void;
  error?: string;
  /** No write access: the text can be read, nothing else is offered (the preview is a write-only route). */
  readOnly?: boolean;
}

const RichEditor = lazy(() => import("./editor/RichEditor"));

const SURFACE = "min-h-[420px]";

export function BodyEditor({ id, header, value, onChange, mode, onModeChange, error, readOnly = false }: BodyEditorProps) {
  const previewing = mode === "preview" && !readOnly;
  const preview = usePreview(value, previewing);
  const base = useUploadsBase();
  const { siteUrl } = useConfig();
  const editor = useRef<RichEditorHandle>(null);
  const [uploading, setUploading] = useState(false);
  // What the editor starts from each time it is shown: the text as it is while the preview is on (the editor is gone
  // then), and after that the editor is the owner of the text, so this is not read again until the preview.
  const seed = useRef(value);
  if (previewing) seed.current = value;

  // Uploaded pictures are served from the files domain and the older ones from the public site, not from this host: show them from there.
  const pane = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!previewing || !pane.current) return;
    for (const image of pane.current.querySelectorAll<HTMLImageElement>('img[src^="/"]')) {
      image.setAttribute("src", storedFileUrl(image.getAttribute("src") ?? "", base, siteUrl));
    }
  }, [previewing, preview.html, preview.status, base, siteUrl]);

  const count = value.length;
  const over = count > LIMITS.bodyMax;
  const describedBy = `${id}-count`;

  return (
    <div>
      <div className="rounded-xl border border-border bg-card px-5 py-8 md:px-14 md:py-12">
        <div className="mx-auto max-w-[720px]">
          {header}
          {previewing ? (
            <div ref={pane} className={`blog-content ${SURFACE}`} aria-busy={preview.status === "loading"}>
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
          ) : (
            <div className={SURFACE}>
              <EditorBoundary fallback={<PlainBody id={id} value={value} onChange={onChange} readOnly={readOnly} invalid={Boolean(error)} describedBy={describedBy} />}>
                <Suspense
                  fallback={
                    <div role="status" aria-label="Memuat editor" className="space-y-3">
                      <Skeleton className="h-4 w-11/12" />
                      <Skeleton className="h-4 w-full" />
                      <Skeleton className="h-4 w-3/4" />
                    </div>
                  }
                >
                  <RichEditor ref={editor} id={id} initialMarkdown={seed.current} onChange={onChange} readOnly={readOnly} invalid={Boolean(error)} describedBy={describedBy} onBusyChange={setUploading} />
                </Suspense>
              </EditorBoundary>
            </div>
          )}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 text-xs text-gray-500">
        <span id={`${id}-count`} className={over ? "text-danger-fg" : undefined}>
          {count.toLocaleString("id-ID")} karakter (maksimal {BODY_LIMIT_LABEL})
        </span>
        {/* The form's error summary announces it; this is where the eye is. */}
        {error && <span className="text-danger-fg">{error}</span>}
        {!readOnly && (
          <div className="ml-auto flex items-center gap-1">
            {!previewing && (
              <Button variant="ghost" size="sm" disabled={uploading} onClick={() => editor.current?.pickImage()}>
                <ImagePlus aria-hidden="true" />
                {uploading ? "Mengupload..." : "Sisipkan Gambar"}
              </Button>
            )}
            <Button variant="ghost" size="sm" aria-pressed={previewing} onClick={() => onModeChange(previewing ? "edit" : "preview")}>
              {previewing ? <PencilLine aria-hidden="true" /> : <Eye aria-hidden="true" />}
              {previewing ? "Kembali menulis" : "Pratinjau"}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

/** What stands in for the editor when it cannot be loaded: the Markdown in a plain box. */
function PlainBody({ id, value, onChange, readOnly, invalid, describedBy }: { id: string; value: string; onChange: (next: string) => void; readOnly: boolean; invalid: boolean; describedBy: string }) {
  return (
    <div className="space-y-2">
      <p role="status" className="text-[13px] text-muted-foreground">
        Editor belum bisa dimuat. Tulis dengan Markdown di kotak ini; hasilnya sama.
      </p>
      <textarea
        id={id}
        name={id}
        aria-label="Isi Artikel"
        rows={20}
        value={value}
        readOnly={readOnly}
        aria-invalid={invalid ? true : undefined}
        aria-describedby={describedBy}
        onChange={(event) => onChange(event.target.value)}
        className="min-h-[360px] w-full resize-y rounded-lg border border-border px-3 py-2 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-ring"
      />
    </div>
  );
}
