"use client";

import Link from "next/link";
import { useFormStatus } from "react-dom";
import { Save } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

/**
 * Shared parts of the admin editor forms (blog, team, reports, …): the sticky
 * top bar, the save button, the message banners and the titled sections.
 */

/** Sticky bar above an editor: back link, what is being edited, extra `meta`, and the actions. */
export function EditorHeader({
  backHref,
  label,
  meta,
  children,
}: {
  backHref: string;
  label: React.ReactNode;
  meta?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <header className="sticky top-0 z-20 border-b border-gray-200 bg-white/95 px-6 py-3 backdrop-blur md:px-10">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex min-w-0 flex-wrap items-center gap-3">
          <Link href={backHref} className="text-sm text-gray-600 transition-colors hover:text-gray-900">
            Kembali
          </Link>
          <span className="select-none text-gray-300">·</span>
          <span className="whitespace-nowrap text-xs font-semibold uppercase tracking-wide text-gray-500">
            {label}
          </span>
          {meta}
        </div>
        {children}
      </div>
    </header>
  );
}

/** The editor's submit button; shows "Menyimpan..." while the action runs. */
export function SaveButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      <Save size={16} />
      {pending ? "Menyimpan..." : label}
    </Button>
  );
}

/**
 * The result of the last save (from the action state), or a success message
 * passed in after a redirect, e.g. "Artikel berhasil dibuat".
 */
export function EditorMessages({
  state,
  successMessage,
}: {
  state: { status: string; message?: string };
  successMessage?: string;
}) {
  const error = state.status === "error" ? state.message : undefined;
  const success =
    state.status === "success" ? state.message : state.status === "error" ? undefined : successMessage;
  if (!error && !success) return null;
  return (
    <div className="mb-5 space-y-3">
      {error && <Alert>{error}</Alert>}
      {success && <Alert tone="success">{success}</Alert>}
    </div>
  );
}

/** A titled group of fields inside the editor card. */
export function FormSection({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
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
