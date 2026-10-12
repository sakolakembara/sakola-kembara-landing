import { type ReactNode, useCallback, useRef, useState } from "react";
import type { ConfirmDialogProps } from "~/components/crud/ConfirmDialog";
import { api } from "~/lib/api";
import { describeFailure } from "~/lib/crud/errors";
import { API_PATH, type AdminItem } from "./model";

// A change to an admin that is not an edit (a verb route, `POST /api/admin/users/:id/<verb>`): ask first, say what
// will happen to this person, send it, and say what the Worker answered. The twin of the kit's `useDeleteAction`
// for a POST (docs/cloudflare/admin-crud.md#2-the-url-scheme). It gives the props of the `ConfirmDialog` to render
// next to the table.
//
// What the dialog does with each answer:
//   200                                      closes, `onDone(row)` (the screen shows the notice and reloads)
//   404 (the admin is gone)                  closes, `onReload()`
//   409 last_super_admin, cannot_deactivate_self, not_pending_invite
//                                            says it, in the Worker's words; only "Tutup" is left, since asking
//                                            again cannot work
//   anything else                            the sentence of `describeFailure`; the button can be pressed again

export interface AdminActionOptions {
  verb: "deactivate" | "reactivate";
  title: string;
  describe: (row: AdminItem) => ReactNode;
  confirmLabel: string;
  pendingLabel: string;
  /** Red button. Neither verb here is final (an account is never deleted), so the screens leave it off. */
  destructive?: boolean;
  onDone: (row: AdminItem) => void;
  onReload: () => void;
}

export interface AdminAction {
  ask(row: AdminItem): void;
  dialogProps: ConfirmDialogProps;
}

/** The answers that ask for nothing more from the person: asking again would get the same one. */
const FINAL = new Set(["last_super_admin", "cannot_deactivate_self", "not_pending_invite"]);

export function useAdminAction(options: AdminActionOptions): AdminAction {
  const [target, setTarget] = useState<AdminItem | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [final, setFinal] = useState(false);
  // The row stays described while the dialog closes.
  const lastRow = useRef<AdminItem | null>(null);
  const locked = useRef(false);

  const close = useCallback(() => {
    setTarget(null);
    setError(null);
    setFinal(false);
  }, []);

  function ask(row: AdminItem) {
    lastRow.current = row;
    setError(null);
    setFinal(false);
    setTarget(row);
  }

  async function confirm() {
    if (!target || locked.current) return;
    locked.current = true;
    setPending(true);
    setError(null);
    try {
      const result = await api(`${API_PATH}/${encodeURIComponent(target.id)}/${options.verb}`, { method: "POST", json: {} });
      if (result.ok) {
        const row = target;
        close();
        options.onDone(row);
        return;
      }
      if (result.status === 404) {
        close();
        options.onReload();
        return;
      }
      setFinal(result.code !== undefined && FINAL.has(result.code));
      setError(describeFailure(result).message);
    } finally {
      locked.current = false;
      setPending(false);
    }
  }

  const row = target ?? lastRow.current;
  return {
    ask,
    dialogProps: {
      open: target !== null,
      title: options.title,
      description: row ? options.describe(row) : null,
      confirmLabel: final ? null : options.confirmLabel,
      destructive: options.destructive ?? false,
      pending,
      pendingLabel: options.pendingLabel,
      error,
      onConfirm: () => void confirm(),
      onCancel: close,
    },
  };
}
