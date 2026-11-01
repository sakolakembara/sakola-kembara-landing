import { useCallback, useEffect, useRef, useState } from "react";
import { submitUpload, type UploadResult } from "./upload-client";
import type { UploadKindName } from "./upload-kinds";

// Files handed to a drop zone, sent one after the other (the Worker rate-limits uploads per person, and one at a time keeps the
// bar of each file true). Each file is its own job with a state; a refusal of one (too big, the wrong type, the Worker's
// answer) is that job's and the rest go on. "Batal" stops the one in flight and drops the ones waiting. Leaving the
// screen aborts what is in flight, and nothing is set afterwards.

export interface UploadJob {
  key: number;
  name: string;
  state: "waiting" | "uploading" | "done" | "failed";
  /** 0 to 1, as the browser reports bytes sent. */
  fraction: number;
  /** The sentence for a failed job. */
  message?: string;
}

export interface UploadQueueOptions {
  /** The kind a file is uploaded as: the Media page decides by the type of the file, a picker has one. */
  kindFor(file: File): UploadKindName;
  /** One file is stored. */
  onUploaded(result: UploadResult, file: File): void;
}

export interface UploadQueue {
  jobs: UploadJob[];
  /** Something is waiting or on its way. */
  busy: boolean;
  add(files: readonly File[]): void;
  /** Stops the file in flight and forgets the ones waiting. */
  cancel(): void;
  /** Forgets the finished jobs (the "Tutup" of the list). */
  dismiss(): void;
}

export function useUploadQueue(options: UploadQueueOptions): UploadQueue {
  const [jobs, setJobs] = useState<UploadJob[]>([]);
  const latest = useRef(options);
  latest.current = options;
  const waiting = useRef<{ key: number; file: File }[]>([]);
  const running = useRef(false);
  const abort = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  const counter = useRef(0);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      abort.current?.abort();
    };
  }, []);

  const patch = useCallback((key: number, change: Partial<UploadJob>) => {
    if (mounted.current) setJobs((current) => current.map((job) => (job.key === key ? { ...job, ...change } : job)));
  }, []);

  const drain = useCallback(async () => {
    if (running.current) return;
    running.current = true;
    try {
      for (let next = waiting.current.shift(); next; next = waiting.current.shift()) {
        const { key, file } = next;
        const controller = new AbortController();
        abort.current = controller;
        patch(key, { state: "uploading", fraction: 0 });
        const outcome = await submitUpload({ kind: latest.current.kindFor(file), file, signal: controller.signal, onProgress: (fraction) => patch(key, { fraction }) });
        abort.current = null;
        if (!mounted.current) return;
        if (outcome.ok) {
          patch(key, { state: "done", fraction: 1 });
          latest.current.onUploaded(outcome.result, file);
        } else if (outcome.code === "aborted") {
          setJobs((current) => current.filter((job) => job.key !== key));
        } else {
          patch(key, { state: "failed", message: outcome.message });
        }
      }
    } finally {
      running.current = false;
    }
  }, [patch]);

  const add = useCallback(
    (files: readonly File[]) => {
      if (files.length === 0) return;
      const added = files.map((file) => ({ key: ++counter.current, file }));
      waiting.current.push(...added);
      setJobs((current) => [...current, ...added.map(({ key, file }): UploadJob => ({ key, name: file.name, state: "waiting", fraction: 0 }))]);
      void drain();
    },
    [drain],
  );

  const cancel = useCallback(() => {
    const dropped = new Set(waiting.current.map((item) => item.key));
    waiting.current = [];
    abort.current?.abort();
    setJobs((current) => current.filter((job) => !dropped.has(job.key)));
  }, []);

  const dismiss = useCallback(() => setJobs((current) => current.filter((job) => job.state === "waiting" || job.state === "uploading")), []);

  return { jobs, busy: jobs.some((job) => job.state === "waiting" || job.state === "uploading"), add, cancel, dismiss };
}
