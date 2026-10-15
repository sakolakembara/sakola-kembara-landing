import { Plus, Trash2 } from "lucide-react";
import { Field, Input } from "@/components/ui/field";
import { BLANK_ENTRY } from "~/lib/wizard/values";
import { StepHeader, useForm, YesNoField } from "../form";

/** Step 5 of 8, "Organisasi": the legacy words (app/(portal)/portal/daftar/_steps/organizations.tsx). */
export function OrganizationsStep() {
  const { values, errors, update } = useForm();
  const v = values.organizations;

  // Any change to the list forgets the messages under it ("Tambahkan minimal satu organisasi" and the rows'), as the legacy form did.
  const setEntries = (entries: typeof v.entries) => update("organizations", { entries }, ["entries"]);
  const edit = (index: number, patch: Partial<(typeof v.entries)[number]>) => setEntries(v.entries.map((entry, i) => (i === index ? { ...entry, ...patch } : entry)));
  const add = () => setEntries([...v.entries, { ...BLANK_ENTRY }]);
  const remove = (index: number) => setEntries(v.entries.length === 1 ? [{ ...BLANK_ENTRY }] : v.entries.filter((_, i) => i !== index));

  return (
    <div className="space-y-6">
      <StepHeader
        title="Organisasi"
        subtitle="Ceritakan pengalaman organisasi, kepanitiaan, komunitas, atau kegiatan sosial yang pernah kamu ikuti — di sekolah maupun di luar sekolah. Kalau belum pernah, tidak masalah."
      />

      <YesNoField
        bucket="organizations"
        name="hasOrganizations"
        label="Pernah mengikuti organisasi atau kepanitiaan?"
        onChange={(on) => {
          if (!on) update("organizations", { entries: [{ ...BLANK_ENTRY }] }, ["entries"]);
        }}
      />

      {v.hasOrganizations && (
        <div className="space-y-3">
          {errors.entries && (
            <p id="entries-error" role="alert" tabIndex={-1} data-field="entries" className="text-xs text-danger-fg">
              {errors.entries}
            </p>
          )}
          {v.entries.map((entry, i) => (
            <div key={i} className="space-y-3 rounded-xl border border-gray-200 p-4">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">Organisasi #{i + 1}</span>
                <button
                  type="button"
                  onClick={() => remove(i)}
                  aria-label={`Hapus organisasi ${i + 1}`}
                  className="-m-2 inline-flex size-11 items-center justify-center rounded-lg text-gray-500 transition-colors hover:text-danger-fg"
                >
                  <Trash2 size={16} aria-hidden />
                </button>
              </div>
              <Field label="Nama Organisasi" id={`org-name-${i}`} required error={errors[`entries.${i}.name`]}>
                <Input
                  id={`org-name-${i}`}
                  data-field={`entries.${i}.name`}
                  type="text"
                  autoComplete="off"
                  value={entry.name}
                  onChange={(event) => edit(i, { name: event.target.value })}
                  placeholder="Contoh: OSIS SMAN 1 Cililin"
                />
              </Field>
              <Field label="Jabatan / Posisi" id={`org-position-${i}`} required error={errors[`entries.${i}.position`]}>
                <Input
                  id={`org-position-${i}`}
                  data-field={`entries.${i}.position`}
                  type="text"
                  autoComplete="off"
                  value={entry.position}
                  onChange={(event) => edit(i, { position: event.target.value })}
                  placeholder="Contoh: Ketua, Anggota Divisi Humas"
                />
              </Field>
            </div>
          ))}
          <button
            type="button"
            onClick={add}
            className="inline-flex min-h-11 items-center gap-2 rounded-lg border-2 border-dashed border-gray-300 px-4 py-2.5 text-sm font-semibold text-gray-600 transition-colors hover:border-primary-blue hover:text-primary-blue"
          >
            <Plus size={16} aria-hidden />
            Tambah Organisasi
          </button>
        </div>
      )}

      {!v.hasOrganizations && <p className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-sm italic text-gray-500">Tidak masalah! Kamu bisa langsung lanjut ke bagian berikutnya.</p>}
    </div>
  );
}
