"use client";

import { Trash2 } from "lucide-react";
import { deleteTeamMember } from "./actions";

export function DeleteButton({ id, name }: { id: string; name: string }) {
  return (
    <form
      action={deleteTeamMember}
      className="inline"
      onSubmit={(e) => {
        if (
          !confirm(
            `Hapus ${name} dari daftar tim? Foto juga akan dihapus dari server.`,
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
