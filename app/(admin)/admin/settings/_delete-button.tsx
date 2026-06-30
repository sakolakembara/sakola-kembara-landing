"use client";

import { Trash2 } from "lucide-react";
import { deleteAdminUser } from "./actions";

export function DeleteButton({
  id,
  email,
  disabled,
  disabledReason,
}: {
  id: string;
  email: string;
  disabled?: boolean;
  disabledReason?: string;
}) {
  if (disabled) {
    return (
      <span
        className="inline-flex items-center gap-1 text-gray-300 text-sm font-medium cursor-not-allowed"
        title={disabledReason}
      >
        <Trash2 size={14} /> Hapus
      </span>
    );
  }
  return (
    <form
      action={deleteAdminUser}
      className="inline"
      onSubmit={(e) => {
        if (!confirm(`Hapus akses admin untuk ${email}?`)) {
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
