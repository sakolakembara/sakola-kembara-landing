"use client";

import { useState } from "react";
import { AlertTriangle } from "lucide-react";
import {
  applicationStatus,
  type ApplicationStatus,
} from "@/lib/db/schema";
import { updateApplicationStatus } from "./actions";

// Extracted from page.tsx so we can react to the selected status in
// real time. Two behaviours the previous server-only form couldn't
// express:
//   1. Warn when the operator is about to REVOKE an existing acceptance
//      (current status is "accepted", they pick "rejected"). This is a
//      high-stakes transition — the server also enforces a stricter
//      note requirement, but the UI cue prevents the "oops, wrong row"
//      accident before it reaches the server.
//   2. Contextual submit label — "Cabut Penerimaan" for the revocation
//      case, plain "Simpan Perubahan" otherwise. Same button, honest
//      framing.

const STATUS_LABEL: Record<ApplicationStatus, string> = {
  pending: "Pending",
  under_review: "Dalam Review",
  accepted: "Diterima",
  rejected: "Ditolak",
};

const REVOCATION_NOTES_MIN = 20;

interface Props {
  applicationId: string;
  currentStatus: ApplicationStatus;
  currentReviewNotes: string | null;
  formError: string | null;
}

export function ReviewForm({
  applicationId,
  currentStatus,
  currentReviewNotes,
  formError,
}: Props) {
  const [selected, setSelected] = useState<ApplicationStatus>(currentStatus);
  const [notes, setNotes] = useState(currentReviewNotes ?? "");

  const isRevocation = currentStatus === "accepted" && selected === "rejected";
  const notesRequired = selected === "accepted" || selected === "rejected";
  const notesTooShort = isRevocation && notes.trim().length < REVOCATION_NOTES_MIN;

  return (
    <form action={updateApplicationStatus} className="p-6 space-y-4">
      <input type="hidden" name="id" value={applicationId} />

      {formError && (
        <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-sm text-red-700">
          {formError}
        </div>
      )}

      <div>
        <label
          htmlFor="status"
          className="block text-sm font-medium text-gray-700 mb-2"
        >
          Status baru
        </label>
        <select
          id="status"
          name="status"
          value={selected}
          onChange={(e) => setSelected(e.target.value as ApplicationStatus)}
          required
          className="w-full px-4 py-2.5 border-2 border-gray-200 rounded-lg focus:border-primary-blue focus:outline-none bg-white"
        >
          {applicationStatus.map((s) => (
            <option key={s} value={s}>
              {STATUS_LABEL[s]}
            </option>
          ))}
        </select>
      </div>

      {isRevocation && (
        <div
          role="alert"
          className="bg-red-50 border border-red-200 rounded-lg px-3 py-3 flex items-start gap-2"
        >
          <AlertTriangle
            size={18}
            className="text-red-600 shrink-0 mt-0.5"
          />
          <div className="text-xs text-red-800 leading-relaxed">
            <p className="font-semibold mb-1">
              Kamu akan mencabut penerimaan siswa ini.
            </p>
            <p>
              Tuliskan alasan revokasi di catatan review (minimal{" "}
              {REVOCATION_NOTES_MIN} karakter). Alasan tercatat permanen di
              audit log dan tidak dapat dihapus.
            </p>
          </div>
        </div>
      )}

      <div>
        <label
          htmlFor="reviewNotes"
          className="block text-sm font-medium text-gray-700 mb-2"
        >
          {isRevocation ? "Alasan pencabutan" : "Catatan Review"}
          {notesRequired && <span className="text-red-500 ml-0.5">*</span>}
        </label>
        <textarea
          id="reviewNotes"
          name="reviewNotes"
          rows={6}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder={
            isRevocation
              ? "Contoh: Siswa mengundurkan diri via WhatsApp pada 12 Sep. Bukti percakapan tersimpan di Drive panitia."
              : "Wajib diisi saat menerima atau menolak. Catatan ini tersimpan di audit log."
          }
          className={`w-full px-4 py-2.5 border-2 rounded-lg focus:outline-none resize-none text-sm transition-colors ${
            notesTooShort
              ? "border-red-300 focus:border-red-500"
              : "border-gray-200 focus:border-primary-blue"
          }`}
        />
        {isRevocation && (
          <p className="text-xs text-gray-500 mt-1">
            {notes.trim().length} / {REVOCATION_NOTES_MIN} karakter minimum
          </p>
        )}
      </div>

      <button
        type="submit"
        className={`w-full px-6 py-2.5 text-white font-semibold rounded-lg transition-colors ${
          isRevocation
            ? "bg-red-600 hover:bg-red-700"
            : "bg-primary-blue hover:bg-primary-blue-dark"
        }`}
      >
        {isRevocation ? "Cabut Penerimaan" : "Simpan Perubahan"}
      </button>

      <p className="text-xs text-gray-500">
        Perubahan status menulis entry di{" "}
        <span className="font-mono">audit_log</span> dengan email reviewer dan
        timestamp
        {isRevocation && (
          <>
            {" "}
            (aksi{" "}
            <span className="font-mono text-red-700">
              application.revoke
            </span>
            )
          </>
        )}
        .
      </p>
    </form>
  );
}
