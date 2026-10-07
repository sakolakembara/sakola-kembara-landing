"use client";

import { useActionState } from "react";

import type { AdmissionBatch } from "@/lib/db/schema";
import {
  createBatch,
  updateBatch,
  type BatchFormState,
} from "./actions";
import { Field, Input, Textarea } from "@/components/ui/field";
import { EditorHeader, EditorMessages, SaveButton } from "../_editor";

const initialState: BatchFormState = { status: "idle" };

function toDateTimeLocal(d: Date | null): string {
  if (!d) return "";
  // <input type="datetime-local"> wants "YYYY-MM-DDTHH:mm" in local time.
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

interface Props {
  mode: "create" | "edit";
  batch?: AdmissionBatch;
}

export function BatchEditorForm({ mode, batch }: Props) {
  const action = mode === "create" ? createBatch : updateBatch;
  const [state, formAction] = useActionState(action, initialState);

  return (
    <form action={formAction}>
      {batch && <input type="hidden" name="id" value={batch.id} />}

      <EditorHeader
        backHref={batch ? `/admin/batches/${batch.id}` : "/admin/batches"}
        label={mode === "create" ? "Batch Baru" : "Edit Batch"}
      >
        <SaveButton label={mode === "create" ? "Buat Batch" : "Simpan Perubahan"} />
      </EditorHeader>

      <div className="max-w-3xl px-6 md:px-10 pt-6 pb-12">
        <EditorMessages state={state} />

        <div className="bg-white rounded-2xl border border-gray-100 p-6 md:p-8 space-y-6">
          <Field
            label="Tahun angkatan"
            id="year"
            required
            error={state.fieldErrors?.year?.[0]}
            hint="Contoh: 2026 untuk periode 2026/2027."
          >
            <Input
              type="number"
              id="year"
              name="year"
              required
              min={2024}
              max={2100}
              defaultValue={batch?.year ?? new Date().getFullYear() + 1}
            />
          </Field>

          <Field
            label="Nama batch"
            id="name"
            required
            error={state.fieldErrors?.name?.[0]}
            hint="Muncul di halaman siswa dan admin. Contoh: “Gen 7 — 2026/2027”."
          >
            <Input
              type="text"
              id="name"
              name="name"
              required
              defaultValue={batch?.name ?? ""}
              placeholder="Contoh: Gen 7 — 2026/2027"
            />
          </Field>

          <Field
            label="Deskripsi (opsional)"
            id="description"
            error={state.fieldErrors?.description?.[0]}
          >
            <Textarea
              id="description"
              name="description"
              rows={3}
              defaultValue={batch?.description ?? ""}
            />
          </Field>

          <div className="grid md:grid-cols-2 gap-4">
            <Field
              label="Buka pendaftaran"
              id="opensAt"
              required
              error={state.fieldErrors?.opensAt?.[0]}
            >
              <Input
                type="datetime-local"
                id="opensAt"
                name="opensAt"
                required
                defaultValue={toDateTimeLocal(batch?.opensAt ?? null)}
              />
            </Field>
            <Field
              label="Tutup pendaftaran"
              id="closesAt"
              required
              error={state.fieldErrors?.closesAt?.[0]}
            >
              <Input
                type="datetime-local"
                id="closesAt"
                name="closesAt"
                required
                defaultValue={toDateTimeLocal(batch?.closesAt ?? null)}
              />
            </Field>
          </div>
        </div>
      </div>
    </form>
  );
}

