"use client";

import { Trash2 } from "lucide-react";
import { deleteBlogPost } from "./actions";

export function DeleteButton({
  slug,
  title,
}: {
  slug: string;
  title: string;
}) {
  return (
    <form
      action={deleteBlogPost}
      className="inline"
      onSubmit={(e) => {
        if (
          !confirm(
            `Hapus artikel "${title}"? Tindakan ini tidak bisa dibatalkan.`,
          )
        ) {
          e.preventDefault();
        }
      }}
    >
      <input type="hidden" name="slug" value={slug} />
      <button
        type="submit"
        className="inline-flex items-center gap-1 text-red-600 text-sm font-medium hover:underline"
      >
        <Trash2 size={14} /> Hapus
      </button>
    </form>
  );
}
