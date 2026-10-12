import { AlertTriangle } from "lucide-react";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, Select, Textarea } from "@/components/ui/field";
import { api } from "~/lib/api";
import { ifMatch } from "~/lib/crud/etag";
import type { ItemPayload } from "~/lib/crud/types";
import { useMutation } from "~/lib/crud/useMutation";
import { API_PATH, type ApplicationDetail, type ApplicationStatus, isRevocation, REVOCATION_NOTES_MIN, STATUS_OPTIONS } from "./model";

// "Ubah Status": the review of one application. A port of app/(admin)/admin/applications/[id]/_review-form.tsx.
//
//  - Two things the legacy form could not say are said here BEFORE the server does: picking "Ditolak" for someone
//    who was accepted is a revocation (a warning, a note of at least 20 characters, a red button "Cabut
//    Penerimaan"); and accepting or rejecting needs a note.
//  - The Worker decides every time (src/admission/review.ts, src/api/applications.ts): this form only shows the
//    rules, it does not enforce them. What the Worker refuses comes back under the field it is about.
//  - The save carries the version the page loaded (`If-Match`): if somebody else decided in the meantime, the
//    person is told and offered "Muat ulang" instead of overwriting a decision they never saw.
//  - Where the legacy text said the note was written to the audit log, this one says what is true: the note is kept
//    with the application, and the change is recorded in Aktivitas without repeating the note (it can name a
//    person; an audit row holds field names only).

interface Props {
  application: ApplicationDetail;
  /** The save worked: the application as the Worker answered. */
  onSaved: (next: ApplicationDetail) => void;
  /** "Muat ulang" of a stale save. */
  onReload: () => void;
}

export function ReviewPanel({ application, onSaved, onReload }: Props) {
  const [selected, setSelected] = useState<ApplicationStatus>(application.status);
  const [notes, setNotes] = useState(application.reviewNotes ?? "");
  const notesRef = useRef<HTMLTextAreaElement>(null);

  const save = useMutation<{ status: ApplicationStatus; reviewNotes: string }, ItemPayload<ApplicationDetail>>((input) =>
    api<ItemPayload<ApplicationDetail>>(`${API_PATH}/${encodeURIComponent(application.id)}/status`, { method: "POST", json: input, ifMatch: ifMatch(application.updatedAt) }),
  );

  const revocation = isRevocation(application.status, selected);
  const notesRequired = selected === "accepted" || selected === "rejected";
  const tooShort = revocation && notes.trim().length < REVOCATION_NOTES_MIN;
  const fieldErrors = save.fields;

  // A refusal about the note: put the cursor there.
  useEffect(() => {
    if (save.failures > 0 && save.fields.reviewNotes) notesRef.current?.focus();
  }, [save.failures, save.fields.reviewNotes]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const result = await save.submit({ status: selected, reviewNotes: notes });
    if (result?.ok) onSaved(result.data.item);
  }

  return (
    <form onSubmit={(event) => void submit(event)} aria-label="Ubah status pendaftar" className="space-y-4 p-6">
      {save.stale && (
        <Alert tone="warning">
          <p>Data ini sudah diubah orang lain sejak kamu membukanya. Muat ulang untuk melihat versi terbaru. Perubahan yang belum disimpan akan hilang.</p>
          <Button variant="neutral" className="mt-3" onClick={onReload}>
            Muat ulang
          </Button>
        </Alert>
      )}
      {!save.stale && save.formError && Object.keys(fieldErrors).length === 0 && <Alert>{save.formError}</Alert>}

      <Field id="status" label="Status baru" error={fieldErrors.status}>
        <Select name="status" required value={selected} onChange={(event) => setSelected(event.target.value as ApplicationStatus)}>
          {STATUS_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </Select>
      </Field>

      {revocation && (
        <Alert className="flex items-start gap-2">
          <AlertTriangle size={18} aria-hidden="true" className="mt-0.5 shrink-0" />
          <div>
            <p className="mb-1 font-semibold">Kamu akan mencabut penerimaan siswa ini.</p>
            <p>
              Tuliskan alasan revokasi di catatan review (minimal {REVOCATION_NOTES_MIN} karakter). Alasan disimpan di catatan review pendaftar ini, dan pencabutan tercatat di Aktivitas.
            </p>
          </div>
        </Alert>
      )}

      <Field
        id="reviewNotes"
        label={revocation ? "Alasan pencabutan" : "Catatan Review"}
        required={notesRequired}
        error={fieldErrors.reviewNotes}
        hint={revocation ? `${notes.trim().length} / ${REVOCATION_NOTES_MIN} karakter minimum` : undefined}
      >
        <Textarea
          ref={notesRef}
          name="reviewNotes"
          rows={6}
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          placeholder={
            revocation
              ? "Contoh: Siswa mengundurkan diri via WhatsApp pada 12 Sep. Bukti percakapan tersimpan di Drive panitia."
              : "Wajib diisi saat menerima atau menolak. Catatan ini disimpan di data pendaftar."
          }
          className={tooShort ? "border-danger-border focus:border-danger-fg" : undefined}
        />
      </Field>

      <Button type="submit" fullWidth variant={revocation ? "danger" : "primary"} disabled={save.pending}>
        {save.pending ? "Menyimpan..." : revocation ? "Cabut Penerimaan" : "Simpan Perubahan"}
      </Button>

      <p className="text-xs text-gray-500">
        Perubahan status dicatat di Aktivitas dengan email pereview dan waktunya
        {revocation && (
          <>
            {" "}
            (aksi <span className="font-mono text-red-700">application.revoke</span>)
          </>
        )}
        .
      </p>
    </form>
  );
}
