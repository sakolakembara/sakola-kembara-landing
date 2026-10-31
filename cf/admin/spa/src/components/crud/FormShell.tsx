import { ArrowLeft, Save } from "lucide-react";
import { type FormEvent, type ReactNode, useEffect, useId, useRef } from "react";
import { Link, useBlocker } from "react-router";
import { cn } from "@/lib/cn";
import { Alert } from "~/components/ui/alert";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import type { FlashControl } from "~/lib/crud/flash";
import type { MutationState } from "~/lib/crud/useMutation";
import { usePageTitle } from "~/lib/hooks";
import { ConfirmDialog } from "./ConfirmDialog";
import { Flash } from "./Flash";
import { PageBar } from "./PageBar";

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
  /**
   * The editor layout (cf/admin/DESIGN.md, "Forms: one bar"), for a page that has tabs and a column beside its text:
   * no bar of its own and no card around the fields. The title, the status and the actions are put in the shell's top bar
   * (`PageBar`), the tabs sit under it, and the page is as wide as the window. `title` is then the page's hidden heading and
   * `crumb` the last step of the breadcrumb. The actions are the page's own when it has more than one way to save (a
   * draft has "Simpan" and "Terbitkan"); a button that saves is `type="submit" form={formId}`, so the browser's own
   * checks of the fields still run first. Without `actions` the page gets the usual pair: "Batal" (or "Tutup" for a
   * reader) and the save button named by `saveLabel`. The fields are then `FormCard`s in `FormColumns`.
   */
  page?: { crumb: string; status?: ReactNode; actions?: (formId: string) => ReactNode; tabs?: ReactNode };
  children: ReactNode;
}

export function FormShell({ title, back, save, dirty, onSubmit, onReload, readOnly = false, saveLabel = "Simpan", fieldLabels = {}, meta, flash, page, children }: FormShellProps) {
  usePageTitle(title);
  const formId = useId();
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

  const usualActions = (
    <>
      <Button variant="ghost" href={back.href}>
        {readOnly ? "Tutup" : "Batal"}
      </Button>
      {!readOnly && (
        <Button type="submit" form={formId} disabled={save.pending}>
          <Save aria-hidden="true" />
          {save.pending ? "Menyimpan..." : saveLabel}
        </Button>
      )}
    </>
  );

  return (
    <>
      <form id={formId} onSubmit={submit} aria-label={title}>
        {/* The classic bar (no `page`): from `md` it stays at the top while the form scrolls: the title and what is known about the item (status,
            address, links) on the left, wrapping among themselves, the two buttons together on the right. On a phone the
            title scrolls away (it would take a third of the screen) and the buttons stay in a bar at the bottom: no
            backdrop blur on the header there, because that would make it the box a fixed child is placed in. */}
        {page ? (
          <>
            <h1 className="sr-only">{title}</h1>
            <PageBar title={page.crumb} back={back} status={page.status} actions={page.actions ? page.actions(formId) : usualActions} />
            {page.tabs}
          </>
        ) : (
          <header className="border-b border-gray-200 bg-white px-6 py-3 md:sticky md:top-0 md:z-20 md:bg-white/95 md:px-10 md:backdrop-blur">
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
              <div className="min-w-0 flex-1 basis-72">
                <Link to={back.href} className="inline-flex items-center gap-1 text-[13px] text-gray-600 transition-colors hover:text-gray-900">
                  <ArrowLeft size={14} aria-hidden="true" />
                  {back.label ?? "Kembali"}
                </Link>
                <h1 className="text-lg font-semibold leading-snug tracking-tight text-primary-blue-dark">{title}</h1>
                {meta && <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[13px]">{meta}</div>}
              </div>
              <div className="flex shrink-0 items-center gap-2 *:flex-1 max-md:fixed max-md:inset-x-0 max-md:bottom-0 max-md:z-30 max-md:border-t max-md:border-gray-200 max-md:bg-white max-md:px-4 max-md:pb-[max(0.75rem,env(safe-area-inset-bottom))] max-md:pt-3 md:w-auto md:*:flex-none">
                <Button variant="neutral" href={back.href}>
                  {readOnly ? "Tutup" : "Batal"}
                </Button>
                {!readOnly && (
                  <Button type="submit" disabled={save.pending}>
                    <Save aria-hidden="true" />
                    {save.pending ? "Menyimpan..." : saveLabel}
                  </Button>
                )}
              </div>
            </div>
          </header>
        )}

        <div className={page ? "px-4 pb-28 pt-6 md:px-10 md:pb-12" : "max-w-4xl px-6 pb-28 pt-6 md:px-10 md:pb-12"}>
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
          <fieldset disabled={readOnly} className={page ? "min-w-0 space-y-6" : "min-w-0 space-y-6 rounded-xl border border-gray-200 bg-white p-5 md:p-8"}>
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

/**
 * A titled card of fields, for a form with the `page` frame (cf/admin/DESIGN.md, "Forms: one bar"): what the card is
 * and what it is for in its header, the fields under it.
 */
export function FormCard({ title, description, children }: { title: string; description?: ReactNode; children: ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

/**
 * The columns of a one-page form: its cards on the left and, from `lg`, a 340 px column of the smaller ones (status,
 * schedule, the file) on the right; one column below that, the main cards first. It is as wide as the window, like the
 * article page and the wireframe that was approved: a cap on the width left a wide window empty at the right. A detail
 * page (`DetailShell`) uses the same columns; `sticky` keeps its column of decisions in view while the facts scroll.
 */
export function FormColumns({ children, aside, sticky }: { children: ReactNode; aside?: ReactNode; sticky?: boolean }) {
  return (
    <div className={cn("grid items-start gap-6", aside && "lg:grid-cols-[minmax(0,1fr)_340px]")}>
      <div className="min-w-0 space-y-6">{children}</div>
      {aside && <div className={cn("min-w-0 space-y-6", sticky && "lg:sticky lg:top-6")}>{aside}</div>}
    </div>
  );
}

/** A titled group of fields inside the form card (a port of the legacy `FormSection`). */
export function FormSection({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <section className="border-b border-gray-100 pb-6 last:border-b-0 last:pb-0">
      <header className="mb-4">
        <h2 className="text-base font-semibold tracking-tight text-gray-900">{title}</h2>
        {description && <p className="mt-0.5 text-[13px] text-gray-600">{description}</p>}
      </header>
      <div className="space-y-5">{children}</div>
    </section>
  );
}
