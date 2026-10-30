import { Save } from "lucide-react";
import { type FormEvent, type ReactNode, useEffect, useRef } from "react";
import { Link, useBlocker } from "react-router";
import { Alert } from "~/components/ui/alert";
import { Button } from "~/components/ui/button";
import type { FlashControl } from "~/lib/crud/flash";
import type { MutationState } from "~/lib/crud/useMutation";
import { usePageTitle } from "~/lib/hooks";
import { ConfirmDialog } from "./ConfirmDialog";
import { Flash } from "./Flash";

/**
 * The frame of a create or edit form (a port of the legacy editor: `app/(admin)/admin/_editor.tsx`), with what the
 * convention adds (docs/cloudflare/admin-crud.md#15-the-spa-kit):
 *
 *  - the sticky bar: "Kembali", what is being edited, and "Batal" / "Simpan" (a read-only role gets no "Simpan"
 *    and the fields are disabled, so nobody is offered a button that cannot work);
 *  - an error summary after a failed save, each line a link that puts the cursor in the field (a control's `id` is
 *    its field name), focused when it appears so a screen reader reads it;
 *  - the stale-save alert with "Muat ulang";
 *  - the unsaved-changes guard: closing the tab, or leaving the page by a link, the back button or "Batal", asks
 *    "Tinggalkan halaman?" while `dirty`. A save that worked lets the navigation after it pass.
 *
 * It needs a data router (`useBlocker`): the app has one (`main.tsx`), and so does `renderApp` in the tests.
 */
export interface FormShellProps {
  /** What the bar says next to "Kembali": "Pengumuman Baru", "Edit Pengumuman". */
  title: string;
  back: { href: string; label?: string };
  /** The `useMutation` of the save. */
  save: MutationState;
  /** The form differs from what was loaded. */
  dirty: boolean;
  onSubmit: () => void;
  /** The "Muat ulang" of the stale alert: load the item again (and remount the form). */
  onReload?: () => void;
  /** No write access: fields disabled, no "Simpan", no guard. */
  readOnly?: boolean;
  saveLabel?: string;
  /** Field name -> label, for the error summary ("Judul: Judul minimal 3 karakter"). */
  fieldLabels?: Record<string, string>;
  /** Next to the title in the bar (a status tag, "Terakhir diubah ..."). */
  meta?: ReactNode;
  /** The page's `useFlash()`: "Pengumuman berhasil disimpan." is shown above the form. */
  flash?: FlashControl;
  children: ReactNode;
}

export function FormShell({ title, back, save, dirty, onSubmit, onReload, readOnly = false, saveLabel = "Simpan", fieldLabels = {}, meta, flash, children }: FormShellProps) {
  usePageTitle(title);
  const guarded = dirty && !readOnly;
  // Read when a navigation is attempted, not when it was rendered: a save that just worked has not re-rendered yet.
  const latest = useRef({ guarded, save });
  latest.current = { guarded, save };
  const blocker = useBlocker(({ currentLocation, nextLocation }) => {
    const { guarded: block, save: mutation } = latest.current;
    if (!block || mutation.succeededRef.current) return false;
    return currentLocation.pathname + currentLocation.search !== nextLocation.pathname + nextLocation.search;
  });

  // Closing or reloading the tab. The browser shows its own text; ours cannot be set.
  useEffect(() => {
    if (!guarded) return;
    const warn = (event: BeforeUnloadEvent) => {
      if (latest.current.save.succeededRef.current) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [guarded]);

  const summary = useRef<HTMLDivElement>(null);
  const errorLines = Object.entries(save.fields);
  // After each failed save, move to the summary: it is announced, and its links are the way to the fields.
  useEffect(() => {
    if (save.failures > 0) summary.current?.focus();
  }, [save.failures]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (readOnly) return;
    onSubmit();
  }

  return (
    <>
      <form onSubmit={submit} aria-label={title}>
        <header className="sticky top-0 z-20 border-b border-gray-200 bg-white/95 px-6 py-3 backdrop-blur md:px-10">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex min-w-0 flex-wrap items-center gap-3">
              <Link to={back.href} className="text-sm text-gray-600 transition-colors hover:text-gray-900">
                {back.label ?? "Kembali"}
              </Link>
              <span aria-hidden="true" className="select-none text-gray-300">
                ·
              </span>
              <h1 className="whitespace-nowrap text-xs font-semibold uppercase tracking-wide text-gray-500">{title}</h1>
              {meta}
            </div>
            <div className="flex items-center gap-2">
              <Button variant="neutral" href={back.href}>
                {readOnly ? "Tutup" : "Batal"}
              </Button>
              {!readOnly && (
                <Button type="submit" disabled={save.pending}>
                  <Save size={16} aria-hidden="true" />
                  {save.pending ? "Menyimpan..." : saveLabel}
                </Button>
              )}
            </div>
          </div>
        </header>

        <div className="max-w-4xl px-6 pb-12 pt-6 md:px-10">
          {flash && <Flash flash={flash.flash} dismiss={flash.dismiss} />}
          <div className="mb-5 space-y-3 empty:hidden">
            {readOnly && <Alert tone="info">Kamu hanya bisa melihat data ini. Perubahan tidak bisa disimpan dengan peranmu.</Alert>}
            {save.stale && (
              <Alert tone="warning">
                <p>Data ini sudah diubah orang lain sejak kamu membukanya. Muat ulang untuk melihat versi terbaru. Perubahan yang belum disimpan akan hilang.</p>
                {onReload && (
                  <Button variant="neutral" className="mt-3" onClick={onReload}>
                    Muat ulang
                  </Button>
                )}
              </Alert>
            )}
            {!save.stale && save.formError && errorLines.length === 0 && <Alert>{save.formError}</Alert>}
          </div>

          {errorLines.length > 0 && (
            <div ref={summary} tabIndex={-1} role="alert" className="mb-5 rounded-lg border border-danger-border bg-danger-bg px-4 py-3 text-sm leading-relaxed text-danger-fg outline-none">
              <p className="font-semibold">{save.formError ?? "Periksa kembali isian formulir."}</p>
              <ul className="mt-1 list-disc pl-5">
                {errorLines.map(([name, message]) => (
                  <li key={name}>
                    <a
                      href={`#${name}`}
                      className="underline"
                      onClick={(event) => {
                        // The control is somewhere on this page: put the cursor there, without touching the address bar.
                        const target = document.getElementById(name);
                        if (!target) return;
                        event.preventDefault();
                        target.focus();
                        target.scrollIntoView?.({ block: "center" });
                      }}
                    >
                      {fieldLabels[name] ? `${fieldLabels[name]}: ${message}` : message}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* A disabled fieldset disables every control inside it. */}
          <fieldset disabled={readOnly} className="min-w-0 space-y-6 rounded-2xl border border-gray-100 bg-white p-6 md:p-8">
            <legend className="sr-only">{title}</legend>
            {children}
          </fieldset>
        </div>
      </form>

      <ConfirmDialog
        open={blocker.state === "blocked"}
        title="Tinggalkan halaman?"
        description="Perubahan yang belum disimpan akan hilang."
        confirmLabel="Tinggalkan"
        cancelLabel="Tetap di sini"
        onConfirm={() => blocker.proceed?.()}
        onCancel={() => blocker.reset?.()}
      />
    </>
  );
}

/** A titled group of fields inside the form card (a port of the legacy `FormSection`). */
export function FormSection({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <section className="border-b border-gray-100 pb-6 last:border-b-0 last:pb-0">
      <header className="mb-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-900">{title}</h2>
        {description && <p className="mt-1 text-xs text-gray-500">{description}</p>}
      </header>
      <div className="space-y-5">{children}</div>
    </section>
  );
}
