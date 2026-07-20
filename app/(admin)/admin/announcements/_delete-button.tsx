"use client";

import { Trash2 } from "lucide-react";
import { deleteAnnouncement } from "./actions";

export function DeleteButton({
  id,
  title,
}: {
  id: string;
  title: string;
}) {
  return (
    <form
      action={deleteAnnouncement}
      className="inline"
      onSubmit={(e) => {
        if (
          !confirm(
            `Hapus pengumuman "${title}"? Tindakan ini tidak bisa dibatalkan.`,
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
