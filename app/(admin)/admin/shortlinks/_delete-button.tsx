"use client";

import { Trash2 } from "lucide-react";
import { deleteShortlink } from "./actions";

export function DeleteButton({ id, slug }: { id: string; slug: string }) {
  return (
    <form
      action={deleteShortlink}
      className="inline"
      onSubmit={(e) => {
        if (
          !confirm(
            `Hapus shortlink "/${slug}"? Alamat yang sudah tersebar tidak akan berfungsi lagi.`,
          )
        ) {
          e.preventDefault();
        }
      }}
    >
      <input type="hidden" name="id" value={id} />
      <button
        type="submit"
        className="inline-flex items-center gap-1 text-red-600 text-sm font-medium hover:underline"
      >
        <Trash2 size={14} /> Hapus
      </button>
    </form>
  );
}
