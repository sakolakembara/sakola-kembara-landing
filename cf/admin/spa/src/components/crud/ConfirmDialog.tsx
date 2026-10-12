import { type ReactNode, useEffect, useId, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Heading } from "@/components/ui/heading";

/**
 * A question that needs an answer before anything happens: "Hapus pengumuman ...?" (docs/cloudflare/admin-crud.md).
 *
 * The native `<dialog>` opened with `showModal()`, as DESIGN.md prescribes for modals: the browser makes the
 * page behind it inert, traps Tab inside, and Escape asks to close it. What this adds:
 *
 *  - `role="alertdialog"` with the title and the description as its name and description: a screen reader
 *    reads the question when it opens;
 *  - the focus starts on the SAFE button ("Batal"), and returns to the button that opened the dialog when it
 *    closes (or to the page's main area when that button is gone, as after a delete);
 *  - Escape and a click on the backdrop answer "Batal", and do nothing while a request is in flight;
 *  - the dialog is controlled (`open`), so a parent can keep it open to show an error from the server.
 *
 * It is the DESIGN.md modal in white on the navy backdrop: the legacy admin used the browser's `confirm()` and
 * has no modal of its own.
 */
export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  /** What will happen, naming the item: `Pengumuman "X" akan dihapus. Tindakan ini tidak bisa dibatalkan.` */
  description: ReactNode;
  /** The label of the action; `null` leaves only the close button (a delete that cannot be retried). */
  confirmLabel: string | null;
  cancelLabel?: string;
  /** Red button for something that cannot be undone. Default true. */
  destructive?: boolean;
  pending?: boolean;
  pendingLabel?: string;
  /** A failure to show inside the dialog, announced as an alert. */
  error?: ReactNode;
  onConfirm(): void;
  onCancel(): void;
}

function focusMain() {
  document.getElementById("main")?.focus();
}

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  cancelLabel = "Batal",
  destructive = true,
  pending = false,
  pendingLabel = "Memproses...",
  error,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) {
      opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      if (typeof element.showModal === "function") element.showModal();
      else element.setAttribute("open", ""); // a browser without <dialog> modals: still a dialog, just not modal
      element.querySelector<HTMLElement>("[data-cancel]")?.focus();
    } else if (!open && element.open) {
      if (typeof element.close === "function") element.close();
      else element.removeAttribute("open");
      const target = opener.current;
      opener.current = null;
      if (target?.isConnected) target.focus();
      else focusMain();
    }
  }, [open]);

  // Left open while unmounting (a route change): let the browser drop the modal state.
  useEffect(
    () => () => {
      const element = dialog.current;
      if (element?.open && typeof element.close === "function") element.close();
    },
    [],
  );

  return (
    <dialog
      ref={dialog}
      role="alertdialog"
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      // Escape: the browser would close the dialog itself, which would leave `open` true in the parent.
      onCancel={(event) => {
        event.preventDefault();
        if (!pending) onCancel();
      }}
      // A click on the backdrop lands on the dialog element itself (its content fills the rest).
      onClick={(event) => {
        if (event.target === event.currentTarget && !pending) onCancel();
      }}
      className="m-auto w-[calc(100%-2.5rem)] max-w-md rounded-2xl border border-gray-100 bg-white p-0 text-gray-900 shadow-xl backdrop:bg-accent-navy/80 backdrop:backdrop-blur-sm"
    >
      <div className="space-y-4 p-6">
        <Heading level="card" as="h2" id={titleId} className="text-gray-900">
          {title}
        </Heading>
        <div id={descriptionId} className="text-sm leading-relaxed text-gray-600">
          {description}
        </div>
        {error && (
          <p role="alert" className="rounded-lg border border-danger-border bg-danger-bg px-4 py-3 text-sm leading-relaxed text-danger-fg">
            {error}
          </p>
        )}
        <div className="flex flex-col-reverse gap-3 pt-2 sm:flex-row sm:justify-end">
          <Button data-cancel="" variant="neutral" disabled={pending} onClick={onCancel}>
            {confirmLabel === null ? "Tutup" : cancelLabel}
          </Button>
          {confirmLabel !== null && (
            <Button variant={destructive ? "danger" : "primary"} disabled={pending} onClick={onConfirm}>
              {pending ? pendingLabel : confirmLabel}
            </Button>
          )}
        </div>
      </div>
    </dialog>
  );
}
