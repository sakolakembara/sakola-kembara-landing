"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import Link from "next/link";
import { ArrowLeft, Save } from "lucide-react";
import type { AdmissionBatch } from "@/lib/db/schema";
import {
  createBatch,
  updateBatch,
  type BatchFormState,
} from "./actions";

const initialState: BatchFormState = { status: "idle" };

const INPUT =
  "w-full px-4 py-2.5 border-2 border-gray-200 rounded-lg focus:border-primary-blue focus:outline-none";

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

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="inline-flex items-center gap-2 px-6 py-2.5 bg-primary-blue text-white font-semibold rounded-lg hover:bg-primary-blue-dark transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
    >
      <Save size={16} />
      {pending ? "Menyimpan..." : label}
    </button>
  );
}

export function BatchEditorForm({ mode, batch }: Props) {
  const action = mode === "create" ? createBatch : updateBatch;
  const [state, formAction] = useActionState(action, initialState);

  return (
    <form action={formAction}>
      {batch && <input type="hidden" name="id" value={batch.id} />}

      <header className="sticky top-0 z-20 px-6 md:px-10 py-3 bg-white/95 backdrop-blur border-b border-gray-200">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3 flex-wrap min-w-0">
            <Link
              href={batch ? `/admin/batches/${batch.id}` : "/admin/batches"}
              className="inline-flex items-center gap-1 text-sm text-gray-600 hover:text-gray-900 transition-colors"
            >
              <ArrowLeft size={14} /> Kembali
            </Link>
            <span className="text-gray-300 select-none">·</span>
            <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap">
              {mode === "create" ? "Batch Baru" : "Edit Batch"}
            </span>
          </div>
          <SubmitButton label={mode === "create" ? "Buat Batch" : "Simpan Perubahan"} />
        </div>
      </header>

      <div className="max-w-3xl px-6 md:px-10 pt-6 pb-12">
        {state.status === "error" && state.message && (
          <div className="mb-5 bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">
            {state.message}
          </div>
        )}
        {state.status === "success" && state.message && (
          <div className="mb-5 bg-green-50 border border-green-200 rounded-lg px-4 py-3 text-sm text-green-700">
            {state.message}
          </div>
        )}

        <div className="bg-white rounded-2xl border border-gray-100 p-6 md:p-8 space-y-6">
          <Field
            label="Tahun angkatan"
            name="year"
            required
            errors={state.fieldErrors?.year}
            hint="Contoh: 2026 untuk periode 2026/2027."
          >
            <input
              type="number"
              id="year"
              name="year"
              required
              min={2024}
              max={2100}
              defaultValue={batch?.year ?? new Date().getFullYear() + 1}
              className={INPUT}
            />
          </Field>

          <Field
            label="Nama batch"
            name="name"
            required
            errors={state.fieldErrors?.name}
            hint="Muncul di halaman siswa dan admin. Contoh: “Gen 7 — 2026/2027”."
          >
            <input
              type="text"
              id="name"
              name="name"
              required
              defaultValue={batch?.name ?? ""}
              placeholder="Contoh: Gen 7 — 2026/2027"
              className={INPUT}
            />
          </Field>

          <Field
            label="Deskripsi (opsional)"
            name="description"
            errors={state.fieldErrors?.description}
          >
            <textarea
              id="description"
              name="description"
              rows={3}
              defaultValue={batch?.description ?? ""}
              className={INPUT}
            />
          </Field>

          <div className="grid md:grid-cols-2 gap-4">
            <Field
              label="Buka pendaftaran"
              name="opensAt"
              required
              errors={state.fieldErrors?.opensAt}
            >
              <input
                type="datetime-local"
                id="opensAt"
                name="opensAt"
                required
                defaultValue={toDateTimeLocal(batch?.opensAt ?? null)}
                className={INPUT}
              />
            </Field>
            <Field
              label="Tutup pendaftaran"
              name="closesAt"
              required
              errors={state.fieldErrors?.closesAt}
            >
              <input
                type="datetime-local"
                id="closesAt"
                name="closesAt"
                required
                defaultValue={toDateTimeLocal(batch?.closesAt ?? null)}
                className={INPUT}
              />
            </Field>
          </div>
        </div>
      </div>
    </form>
  );
}

function Field({
  label,
  name,
  required,
  errors,
  hint,
  children,
}: {
  label: string;
  name: string;
  required?: boolean;
  errors?: string[];
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label htmlFor={name} className="block text-sm font-medium text-gray-700 mb-2">
        {label}
        {required && <span className="text-red-500 ml-0.5">*</span>}
      </label>
      {children}
      {hint && !errors?.length && (
        <p className="text-xs text-gray-500 mt-1">{hint}</p>
      )}
      {errors?.[0] && <p className="text-xs text-red-600 mt-1">{errors[0]}</p>}
    </div>
  );
}
