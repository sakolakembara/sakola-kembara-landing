import type { ReactNode } from "react";
import type { FlashControl } from "~/lib/crud/flash";
import { usePageTitle } from "~/lib/hooks";
import { Flash } from "./Flash";
import { FormColumns } from "./FormShell";
import { PageBar } from "./PageBar";

/**
 * The frame of a page that shows one thing (an applicant, a batch, a message): the same single bar as the editors
 * (`PageBar`, cf/admin/DESIGN.md "Forms: one bar"), with what the page is about as the last step of the breadcrumb and
 * its status next to it. There is no big title and no "Kembali" link under the bar: the breadcrumb is the way back, and
 * on a phone the thin bar's arrow.
 *
 *  - `title` is the hidden heading of the page (and the tab's title, unless `documentTitle` says otherwise: a message
 *    keeps "Detail Pesan" there, not the sender's name).
 *  - `actions` are the page's own, in the bar: a button of the bar changes nothing by itself or opens a page ("Ubah
 *    Data", "Balas lewat email"). A decision that has fields or a question belongs to a card in `aside`.
 *  - `meta` is one line under the bar: who, which batch, when.
 *  - `children` are the facts, in the main column; `aside` is the narrow column of decisions, which stays in view
 *    while the facts scroll.
 */
export interface DetailShellProps {
  title: string;
  documentTitle?: string;
  back: { href: string; label?: string };
  /** The list's step of the breadcrumb leads here instead of the plain list (the list with the person's filters). */
  crumbHref?: string;
  status?: ReactNode;
  actions?: ReactNode;
  meta?: ReactNode;
  flash?: FlashControl;
  aside?: ReactNode;
  children: ReactNode;
}

export function DetailShell({ title, documentTitle, back, crumbHref, status, actions, meta, flash, aside, children }: DetailShellProps) {
  usePageTitle(documentTitle ?? title);
  return (
    <>
      <h1 className="sr-only">{title}</h1>
      <PageBar title={title} back={back} crumbHref={crumbHref} status={status} actions={actions} />
      {/* Room under the content for the phone's bar of actions, when there is one. */}
      <div className={actions ? "px-4 pb-28 pt-6 md:px-10 md:pb-12" : "px-4 pb-12 pt-6 md:px-10"}>
        {flash && <Flash flash={flash.flash} dismiss={flash.dismiss} />}
        {meta && <div className="mb-6 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-gray-600">{meta}</div>}
        <FormColumns aside={aside} sticky>
          {children}
        </FormColumns>
      </div>
    </>
  );
}
