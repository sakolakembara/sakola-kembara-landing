import { useCallback, useRef, useState } from "react";
import type { ConfirmDialogProps } from "~/components/crud/ConfirmDialog";
import { api } from "../api";
import { describeFailure } from "./errors";
import { ifMatch } from "./etag";

// Deleting a row from a list: ask, name the item, send `DELETE` with the version the row was loaded at, and say
// what happened (docs/cloudflare/admin-crud.md#15-the-spa-kit). It gives the props of the `ConfirmDialog` to
// render next to the table:
//
//   const remove = useDeleteAction<Announcement>({ basePath, noun: "pengumuman", nameOf: (row) => row.title, onDeleted, onReload });
//   ... <button onClick={() => remove.ask(row)}>Hapus</button> ... <ConfirmDialog {...remove.dialogProps} />
//
// What the dialog does with each answer:
//   204, or 404 (it is gone already)   closes, `onDeleted(row)` (the screen shows the notice and reloads)
//   409 stale (edited since the list)  says so; the button becomes "Muat ulang" and reloads the list
//   409 in_use (something refers to it) says what; only "Tutup" is left, since asking again cannot work
//   anything else                      the sentence of `describeFailure`, "Hapus" can be pressed again

export interface DeleteActionOptions<T> {
  /** The collection's address: `/api/admin/announcements`. */
  basePath: string;
  /** Lower case, in the question: "pengumuman", "anggota tim". */
  noun: string;
  nameOf: (row: T) => string;
  /** An extra sentence for what else goes with it ("File uploadnya juga akan dihapus."). */
  note?: string;
  onDeleted: (row: T) => void;
  /** The row changed underneath: load the list again. */
  onReload: () => void;
}

export interface DeleteAction<T> {
  ask(row: T): void;
  dialogProps: ConfirmDialogProps;
}

interface Row {
  id: string;
  updatedAt?: string;
}

const capitalise = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

export function useDeleteAction<T extends Row>(options: DeleteActionOptions<T>): DeleteAction<T> {
  const [target, setTarget] = useState<T | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  const [inUse, setInUse] = useState(false);
  // The row stays named while the dialog closes.
  const lastName = useRef("");
  const locked = useRef(false);

  const close = useCallback(() => {
    setTarget(null);
    setError(null);
    setStale(false);
    setInUse(false);
  }, []);

  function ask(row: T) {
    lastName.current = options.nameOf(row);
    setError(null);
    setStale(false);
    setInUse(false);
    setTarget(row);
  }

  async function confirm() {
    if (!target || locked.current) return;
    locked.current = true;
    setPending(true);
    setError(null);
    try {
      const result = await api(`${options.basePath}/${encodeURIComponent(target.id)}`, {
        method: "DELETE",
        ifMatch: target.updatedAt ? ifMatch(target.updatedAt) : undefined,
      });
      // 404: someone else deleted it first. The goal is reached.
      if (result.ok || result.status === 404) {
        const row = target;
        close();
        options.onDeleted(row);
        return;
      }
      const described = describeFailure(result);
      setStale(described.stale);
      setInUse(result.code === "in_use");
      setError(described.message);
    } finally {
      locked.current = false;
      setPending(false);
    }
  }

  const name = target ? options.nameOf(target) : lastName.current;
  const noun = options.noun;

  return {
    ask,
    dialogProps: {
      open: target !== null,
      title: `Hapus ${noun}?`,
      description: (
        <>
          {capitalise(noun)} &ldquo;{name}&rdquo; akan dihapus. Tindakan ini tidak bisa dibatalkan.{options.note ? ` ${options.note}` : ""}
        </>
      ),
      confirmLabel: stale ? "Muat ulang" : inUse ? null : "Hapus",
      destructive: !stale,
      pending,
      pendingLabel: "Menghapus...",
      error,
      onConfirm: stale
        ? () => {
            close();
            options.onReload();
          }
        : () => void confirm(),
      onCancel: close,
    },
  };
}
