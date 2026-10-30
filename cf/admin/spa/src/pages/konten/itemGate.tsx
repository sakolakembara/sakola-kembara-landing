import type { ReactNode } from "react";
import { Alert } from "~/components/ui/alert";
import { Button } from "~/components/ui/button";
import { describeFailure } from "~/lib/crud/errors";
import type { ItemState } from "~/lib/crud/useItem";

/**
 * What an edit screen shows INSTEAD of its form while the item is loading or could not be loaded: "Memuat laporan...",
 * or the sentence of the failure with "Kembali ke daftar" (the item is gone) or "Coba lagi". Returns null once the form
 * can be shown (or for a new item, which loads nothing). The three Konten Situs screens share it; it is the same
 * markup the announcements screen writes out by hand (pages/announcements/AnnouncementFormPage.tsx).
 *
 * Call it after the screen's hooks, before its return: `const gate = itemGate(...); if (gate) return gate;`.
 */
export function itemGate<T>(id: string | undefined, state: ItemState<T>, options: { noun: string; listHref: string }): ReactNode {
  const { noun, listHref } = options;
  if (id && (state.status === "loading" || state.status === "idle") && !state.item) {
    return (
      <div className="p-6 md:p-10">
        <p role="status" className="text-sm text-gray-500">
          Memuat {noun}...
        </p>
      </div>
    );
  }
  if (id && state.status === "error") {
    const missing = state.failure?.status === 404;
    return (
      <div className="max-w-xl space-y-4 p-6 md:p-10">
        <Alert>{state.failure ? describeFailure(state.failure).message : `Gagal memuat ${noun}.`}</Alert>
        {missing ? (
          <Button variant="neutral" href={listHref}>
            Kembali ke daftar
          </Button>
        ) : (
          <Button variant="neutral" onClick={state.refetch}>
            Coba lagi
          </Button>
        )}
      </div>
    );
  }
  return null;
}
