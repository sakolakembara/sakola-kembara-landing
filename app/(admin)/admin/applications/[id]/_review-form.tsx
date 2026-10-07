"use client";

import { useState } from "react";
import { AlertTriangle } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, Select, Textarea } from "@/components/ui/field";
import { APPLICATION_STATUS_LABEL } from "@/lib/application-status";
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

      {formError && <Alert>{formError}</Alert>}

      <Field id="status" label="Status baru">
        <Select
          name="status"
          value={selected}
          onChange={(e) => setSelected(e.target.value as ApplicationStatus)}
          required
        >
          {applicationStatus.map((s) => (
            <option key={s} value={s}>
              {APPLICATION_STATUS_LABEL[s]}
            </option>
          ))}
        </Select>
      </Field>

      {isRevocation && (
        <Alert className="flex items-start gap-2">
          <AlertTriangle size={18} className="shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold mb-1">
              Kamu akan mencabut penerimaan siswa ini.
            </p>
            <p>
              Tuliskan alasan revokasi di catatan review (minimal{" "}
              {REVOCATION_NOTES_MIN} karakter). Alasan tercatat permanen di
              audit log dan tidak dapat dihapus.
            </p>
          </div>
        </Alert>
      )}

      <Field
        id="reviewNotes"
        label={isRevocation ? "Alasan pencabutan" : "Catatan Review"}
        required={notesRequired}
        hint={
          isRevocation
            ? `${notes.trim().length} / ${REVOCATION_NOTES_MIN} karakter minimum`
            : undefined
        }
      >
        <Textarea
          name="reviewNotes"
          rows={6}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder={
            isRevocation
              ? "Contoh: Siswa mengundurkan diri via WhatsApp pada 12 Sep. Bukti percakapan tersimpan di Drive panitia."
              : "Wajib diisi saat menerima atau menolak. Catatan ini tersimpan di audit log."
          }
          className={
            notesTooShort ? "border-danger-border focus:border-danger-fg" : undefined
          }
        />
      </Field>

      <Button type="submit" fullWidth variant={isRevocation ? "danger" : "primary"}>
        {isRevocation ? "Cabut Penerimaan" : "Simpan Perubahan"}
      </Button>

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
