import type { LucideIcon } from "lucide-react";
import { useRef, useState } from "react";
import type { ConfirmDialogProps } from "~/components/crud/ConfirmDialog";
import { api, type ApiResult } from "../api";
import { describeBulk, runEach } from "./bulk";
import { ifMatch } from "./etag";
import type { FlashMessage } from "./flash";
import type { Versioned } from "./types";

// What can be done to one row or to the ticked rows of a list besides edit (docs/cloudflare/admin-crud.md#15-the-spa-kit):
// the resource's own operations (a blog post can be published and taken back to a draft) and delete. The row's
// menu and the bar over the list both use these, so a thing is defined once and works from either. Each row is its own
// request (`runEach`), and the notice that follows says what went through and what did not.
//
//   const rows = useRowOperations<Post>({ apiPath, noun: "artikel", nameOf, notify: notice.show, onChanged });
//   rows.run(publish, selection.rows)   rows.askDelete(selection.rows)   <ConfirmDialog {...rows.dialogProps} />

export interface RowOperation<T> {
  key: string;
  /** On the button: "Terbitkan". */
  label: string;
  /** Past tense, for the notice: "diterbitkan" gives "3 artikel diterbitkan.". */
  verb: string;
  icon: LucideIcon;
  /** The rows it makes sense for (a published post cannot be published again); the others are left out of the run. */
  applies?: (row: T) => boolean;
  /** The request for one row; it sends the row's version. */
  run: (row: T) => Promise<ApiResult<unknown>>;
}

export interface RowOperationsOptions<T> {
  /** The collection's address: `/api/admin/blog`. */
  apiPath: string;
  /** Lower case: "artikel". */
  noun: string;
  nameOf: (row: T) => string;
  /** What else a delete takes with it ("File uploadnya juga akan dihapus."). */
  deleteNote?: string;
  notify: (message: FlashMessage) => void;
  /** Some rows went through (or all): the screen reloads the list and unticks them. */
  onChanged: (done: T[]) => void;
}

export interface RowOperations<T> {
  /** A run is in flight: the buttons wait. */
  busy: boolean;
  run(operation: RowOperation<T>, rows: readonly T[]): Promise<void>;
  /** Asks for the delete of these rows (the dialog names them); nothing happens until it is confirmed. */
  askDelete(rows: readonly T[]): void;
  dialogProps: ConfirmDialogProps;
}

/** How many names the delete question lists before "dan N lainnya". */
const NAMED = 5;

export function useRowOperations<T extends Versioned>(options: RowOperationsOptions<T>): RowOperations<T> {
  const { apiPath, noun, nameOf, deleteNote, notify, onChanged } = options;
  const [busy, setBusy] = useState(false);
  const locked = useRef(false);
  const [asked, setAsked] = useState<T[] | null>(null);
  const [finished, setFinished] = useState(0);
  // The rows stay named while the dialog closes.
  const lastAsked = useRef<T[]>([]);

  async function guarded(work: () => Promise<void>) {
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    try {
      await work();
    } finally {
      locked.current = false;
      setBusy(false);
    }
  }

  const run: RowOperations<T>["run"] = (operation, rows) => {
    const targets = operation.applies ? rows.filter(operation.applies) : [...rows];
    if (targets.length === 0) return Promise.resolve();
    return guarded(async () => {
      const result = await runEach(targets, operation.run);
      notify(describeBulk(result, { noun, verb: operation.verb, nameOf }));
      onChanged(result.done);
    });
  };

  const askDelete: RowOperations<T>["askDelete"] = (rows) => {
    if (rows.length === 0) return;
    lastAsked.current = [...rows];
    setAsked([...rows]);
  };

  const confirmDelete = () =>
    guarded(async () => {
      if (!asked) return;
      setFinished(0);
      const result = await runEach(
        asked,
        (row) => api(`${apiPath}/${encodeURIComponent(row.id)}`, { method: "DELETE", ifMatch: row.updatedAt ? ifMatch(row.updatedAt) : undefined }),
        // Someone else deleted it first: the goal is reached.
        { goneIsDone: true, onProgress: setFinished },
      );
      setAsked(null);
      notify(describeBulk(result, { noun, verb: "dihapus", nameOf }));
      onChanged(result.done);
    });

  const shown = asked ?? lastAsked.current;
  const listed = shown.slice(0, NAMED);

  return {
    busy,
    run,
    askDelete,
    dialogProps: {
      open: asked !== null,
      title: `Hapus ${shown.length} ${noun}?`,
      description: (
        <>
          <p>
            {shown.length} {noun} akan dihapus. Tindakan ini tidak bisa dibatalkan.{deleteNote ? ` ${deleteNote}` : ""}
          </p>
          <ul className="mt-2 list-disc space-y-0.5 pl-5">
            {listed.map((row) => (
              <li key={row.id} className="break-words">
                {nameOf(row)}
              </li>
            ))}
            {shown.length > listed.length && <li className="list-none text-gray-500">dan {shown.length - listed.length} lainnya</li>}
          </ul>
        </>
      ),
      confirmLabel: "Hapus",
      destructive: true,
      pending: busy,
      pendingLabel: `Menghapus ${Math.min(finished + 1, shown.length)} dari ${shown.length}...`,
      error: null,
      onConfirm: () => void confirmDelete(),
      onCancel: () => setAsked(null),
    },
  };
}
