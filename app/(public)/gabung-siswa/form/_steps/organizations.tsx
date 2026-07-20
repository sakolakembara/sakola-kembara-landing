"use client";

import { Plus, Trash2 } from "lucide-react";
import type {
  FormValues,
  OrganizationsValues,
  StepId,
} from "@/lib/student-form-types";
import {
  Field,
  TEXT_INPUT,
  YesNoToggle,
  type FieldErrors,
} from "../_shared";
import { StepHeader } from "./identity";

type Props = {
  values: FormValues;
  updateStep: <K extends keyof FormValues>(step: K, patch: Partial<FormValues[K]>) => void;
  errors: Record<StepId, FieldErrors>;
  clearFieldError: (step: StepId, path: string) => void;
};

export function OrganizationsStep({
  values,
  updateStep,
  errors,
  clearFieldError,
}: Props) {
  const v = values.organizations;
  const e = errors.organizations;

  const setEntries = (entries: OrganizationsValues["entries"]) => {
    updateStep("organizations", { entries });
    clearFieldError("organizations", "entries");
  };

  const updateEntry = (i: number, patch: Partial<OrganizationsValues["entries"][number]>) => {
    const next = v.entries.map((entry, idx) => (idx === i ? { ...entry, ...patch } : entry));
    setEntries(next);
    clearFieldError("organizations", `entries.${i}.name`);
    clearFieldError("organizations", `entries.${i}.position`);
  };

  const addEntry = () => setEntries([...v.entries, { name: "", position: "" }]);
  const removeEntry = (i: number) => {
    if (v.entries.length === 1) {
      setEntries([{ name: "", position: "" }]);
    } else {
      setEntries(v.entries.filter((_, idx) => idx !== i));
    }
  };

  return (
    <div className="space-y-6">
      <StepHeader
        title="Organisasi"
        subtitle="Ceritakan pengalaman organisasi, kepanitiaan, komunitas, atau kegiatan sosial yang pernah kamu ikuti — di sekolah maupun di luar sekolah. Kalau belum pernah, tidak masalah."
      />

      <Field
        label="Pernah mengikuti organisasi atau kepanitiaan?"
        required={false}
      >
        <YesNoToggle
          name="hasOrganizations"
          value={v.hasOrganizations}
          onChange={(val) => {
            updateStep("organizations", { hasOrganizations: val });
            clearFieldError("organizations", "entries");
            if (!val) {
              setEntries([{ name: "", position: "" }]);
            }
          }}
        />
      </Field>

      {v.hasOrganizations && (
        <div className="space-y-3">
          {e.entries && (
            <p className="text-xs text-red-600" data-error="true">
              {e.entries}
            </p>
          )}
          {v.entries.map((entry, i) => (
            <div
              key={i}
              className="rounded-xl border border-gray-200 p-4 space-y-3"
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                  Organisasi #{i + 1}
                </span>
                <button
                  type="button"
                  onClick={() => removeEntry(i)}
                  className="text-gray-400 hover:text-red-600 transition-colors p-1"
                  aria-label="Hapus baris"
                >
                  <Trash2 size={16} />
                </button>
              </div>
              <Field
                label="Nama Organisasi"
                htmlFor={`org-name-${i}`}
                required
                error={e[`entries.${i}.name`]}
              >
                <input
                  id={`org-name-${i}`}
                  type="text"
                  value={entry.name ?? ""}
                  onChange={(ev) => updateEntry(i, { name: ev.target.value })}
                  className={TEXT_INPUT}
                  placeholder="Contoh: OSIS SMAN 1 Cililin"
                  data-error={!!e[`entries.${i}.name`]}
                />
              </Field>
              <Field
                label="Jabatan / Posisi"
                htmlFor={`org-position-${i}`}
                required
                error={e[`entries.${i}.position`]}
              >
                <input
                  id={`org-position-${i}`}
                  type="text"
                  value={entry.position ?? ""}
                  onChange={(ev) => updateEntry(i, { position: ev.target.value })}
                  className={TEXT_INPUT}
                  placeholder="Contoh: Ketua, Anggota Divisi Humas"
                  data-error={!!e[`entries.${i}.position`]}
                />
              </Field>
            </div>
          ))}
          <button
            type="button"
            onClick={addEntry}
            className="inline-flex items-center gap-2 px-4 py-2.5 border-2 border-dashed border-gray-300 hover:border-primary-blue hover:text-primary-blue rounded-lg text-sm font-semibold text-gray-600 transition-colors"
          >
            <Plus size={16} />
            Tambah Organisasi
          </button>
        </div>
      )}

      {!v.hasOrganizations && (
        <p className="text-sm text-gray-500 italic bg-gray-50 rounded-lg px-4 py-3 border border-gray-200">
          Tidak masalah! Kamu bisa langsung lanjut ke bagian berikutnya.
        </p>
      )}
    </div>
  );
}
