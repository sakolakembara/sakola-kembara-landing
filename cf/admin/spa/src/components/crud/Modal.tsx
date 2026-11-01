import { X } from "lucide-react";
import { type ReactNode, useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/cn";
import { Button } from "~/components/ui/button";
import { Heading } from "@/components/ui/heading";

/**
 * A window over the page that holds more than a question: the media picker, a file's panel on a phone
 * (`ConfirmDialog` is the one for a yes or no). The native `<dialog>` opened with `showModal()`, as DESIGN.md prescribes: the
 * browser makes the page behind it inert, keeps Tab inside, and asks to close on Escape. What this adds, the same as
 * `ConfirmDialog` does:
 *
 *  - `role="dialog"`, named by its title (and described by `description` when there is one);
 *  - the focus goes back to the button that opened it when it closes (or to the page's main area when that button is gone);
 *  - Escape, the backdrop and the close button ask `onClose`, and do nothing while `locked` (a request is in flight);
 *  - it is controlled (`open`), and its content exists only while it is open, so a picker loads nothing until it is
 *    shown and starts afresh each time;
 *  - it is drawn at the end of `<body>`, not where it is used: a picker is opened from inside a form (a field of Tim, the
 *    article), and a search box or a button in a window that sat in that form would belong to it (Enter in the search would
 *    save the form).
 *
 * The title bar stays in view. What is inside is the caller's: `ModalBody` is the part that scrolls and `ModalFooter` the bar
 * of buttons under it, both optional (a window whose content is short needs only the first).
 */
export interface ModalProps {
  open: boolean;
  title: string;
  description?: ReactNode;
  onClose(): void;
  locked?: boolean;
  /** For a picker: most of the screen, instead of a card. */
  wide?: boolean;
  children: ReactNode;
}

function focusMain() {
  document.getElementById("main")?.focus();
}

export function Modal({ open, title, description, onClose, locked = false, wide = false, children }: ModalProps) {
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

  return createPortal(
    <dialog
      ref={dialog}
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      // Escape: the browser would close the dialog itself, which would leave `open` true in the parent.
      onCancel={(event) => {
        event.preventDefault();
        if (!locked) onClose();
      }}
      // A click on the backdrop lands on the dialog element itself (its content fills the rest).
      onClick={(event) => {
        if (event.target === event.currentTarget && !locked) onClose();
      }}
      className={cn(
        "m-auto w-[calc(100%-1.5rem)] rounded-2xl border border-gray-100 bg-white p-0 text-gray-900 shadow-xl backdrop:bg-accent-navy/80 backdrop:backdrop-blur-sm",
        wide ? "max-w-5xl" : "max-w-md",
      )}
    >
      {open && (
        <div className="flex max-h-[calc(100dvh-1.5rem)] flex-col">
          <div className="flex items-start justify-between gap-4 border-b border-gray-100 px-5 py-4 md:px-6">
            <div className="min-w-0">
              <Heading level="card" as="h2" id={titleId} className="text-gray-900">
                {title}
              </Heading>
              {description && (
                <p id={descriptionId} className="mt-0.5 text-[13px] text-gray-600">
                  {description}
                </p>
              )}
            </div>
            <Button variant="ghost" size="sm" aria-label="Tutup" disabled={locked} onClick={onClose} className="-mr-2 shrink-0">
              <X aria-hidden="true" />
            </Button>
          </div>
          {children}
        </div>
      )}
    </dialog>,
    document.body,
  );
}

/** The part of a modal that scrolls when its content is taller than the screen. */
export function ModalBody({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("min-h-0 flex-1 overflow-y-auto", className)} {...props} />;
}

/** The bar under the body, for the buttons that finish the job. */
export function ModalFooter({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("flex flex-wrap items-center justify-between gap-3 border-t border-gray-100 px-5 py-3 md:px-6", className)} {...props} />;
}
