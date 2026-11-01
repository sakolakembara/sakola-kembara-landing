import { AlertCircle, CheckCircle2, Upload } from "lucide-react";
import { type DragEvent, type ReactNode, useId, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import { Button } from "~/components/ui/button";
import type { UploadResult } from "~/lib/crud/upload-client";
import type { UploadKindName } from "~/lib/crud/upload-kinds";
import { useUploadQueue } from "~/lib/crud/useUploadQueue";

export interface MediaDropzoneProps {
  /** The value of `<input accept>`: the types the kinds take. */
  accept: string;
  multiple: boolean;
  kindFor(file: File): UploadKindName;
  onUploaded(result: UploadResult, file: File): void;
  /** What the zone says it takes; the zone adds the verb. */
  children: ReactNode;
  /** The zone's file input, for a page whose own "Unggah" button should open the same chooser. */
  chooserRef?: React.RefObject<HTMLInputElement | null>;
  className?: string;
}

/**
 * Where files are dropped, or chosen from the computer, to be sent (the Media page and the picker's "Unggah" tab). The files go one
 * after the other through `useUploadQueue`; each shows its bar, a failure says why in the Worker's words, and the
 * start and the end of each are in a live region (the percentage is not, so a screen reader is not read to for a
 * whole upload). A picture is made smaller on the way (lib/crud/image-resize.ts).
 */
export function MediaDropzone({ accept, multiple, kindFor, onUploaded, children, chooserRef, className }: MediaDropzoneProps) {
  const ownInput = useRef<HTMLInputElement>(null);
  const input = chooserRef ?? ownInput;
  const hintId = useId();
  const [over, setOver] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const queue = useUploadQueue({
    kindFor,
    onUploaded: (result, file) => {
      setAnnouncement(`${file.name} selesai diunggah`);
      onUploaded(result, file);
    },
  });

  function take(files: readonly File[]) {
    if (files.length === 0) return;
    setAnnouncement(files.length === 1 ? `Mengunggah ${files[0]!.name}` : `Mengunggah ${files.length} file`);
    queue.add(multiple ? files : files.slice(0, 1));
  }

  function drop(event: DragEvent) {
    event.preventDefault();
    setOver(false);
    take(Array.from(event.dataTransfer.files));
  }

  const failed = queue.jobs.filter((job) => job.state === "failed");
  const active = queue.jobs.filter((job) => job.state === "waiting" || job.state === "uploading");
  const done = queue.jobs.filter((job) => job.state === "done").length;

  return (
    <div className={className}>
      <div
        onDragOver={(event) => {
          event.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={drop}
        className={cn(
          "flex flex-wrap items-center justify-center gap-x-3 gap-y-1 rounded-xl border-2 border-dashed px-4 py-4 text-center text-sm text-gray-600 transition-colors",
          over ? "border-primary-blue bg-info-bg" : "border-gray-300 bg-white",
        )}
      >
        <Upload size={20} aria-hidden="true" className="text-gray-500" />
        <span id={hintId}>
          Tarik {multiple ? "file" : "satu file"} ke sini atau{" "}
          <button
            type="button"
            onClick={() => input.current?.click()}
            aria-describedby={hintId}
            className="font-medium text-primary-blue underline-offset-2 hover:underline"
          >
            pilih dari komputer
          </button>
          . {children}
        </span>
        {/* Not reachable by Tab (the button is), and not announced: the button carries the meaning. */}
        <input
          ref={input}
          type="file"
          tabIndex={-1}
          aria-hidden="true"
          accept={accept}
          multiple={multiple}
          onChange={(event) => {
            const chosen = Array.from(event.target.files ?? []);
            event.target.value = ""; // the same file can be chosen again after a refusal
            take(chosen);
          }}
          className="sr-only"
        />
      </div>

      {queue.jobs.length > 0 && (
        <div className="mt-3 space-y-2">
          {active.map((job) => (
            <div key={job.key} className="rounded-lg border border-gray-200 bg-white px-3 py-2">
              <div className="flex items-center justify-between gap-3 text-[13px]">
                <span className="min-w-0 truncate text-gray-700">{job.name}</span>
                <span aria-hidden="true" className="shrink-0 text-gray-500">
                  {job.state === "waiting" ? "Menunggu" : `${Math.round(job.fraction * 100)}%`}
                </span>
              </div>
              <div
                role="progressbar"
                aria-label={`Mengunggah ${job.name}`}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(job.fraction * 100)}
                className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-gray-100"
              >
                <div className="h-full bg-primary-blue transition-[width]" style={{ width: `${Math.round(job.fraction * 100)}%` }} />
              </div>
            </div>
          ))}
          {failed.map((job) => (
            <p key={job.key} role="alert" className="flex items-start gap-2 rounded-lg border border-danger-border bg-danger-bg px-3 py-2 text-[13px] text-danger-fg">
              <AlertCircle size={16} aria-hidden="true" className="mt-0.5 shrink-0" />
              <span className="min-w-0">
                <b className="break-all font-medium">{job.name}</b>: {job.message}
              </span>
            </p>
          ))}
          {!queue.busy && (
            <div className="flex flex-wrap items-center justify-between gap-2 text-[13px] text-gray-600">
              <span className="flex items-center gap-1.5">
                {done > 0 && (
                  <>
                    <CheckCircle2 size={16} aria-hidden="true" className="text-success-fg" />
                    {done} file diunggah{failed.length > 0 ? `, ${failed.length} gagal` : ""}.
                  </>
                )}
              </span>
              <Button variant="ghost" size="sm" onClick={queue.dismiss}>
                Tutup
              </Button>
            </div>
          )}
          {queue.busy && (
            <Button variant="neutral" size="sm" onClick={queue.cancel}>
              Batal
            </Button>
          )}
        </div>
      )}
      <p role="status" className="sr-only">
        {announcement}
      </p>
    </div>
  );
}
