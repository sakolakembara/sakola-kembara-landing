"use client";

import {
  FATHER_OCCUPATIONS,
  LIVING_WITH_OPTIONS,
  MOTHER_OCCUPATIONS,
  OTHER_EARNER_RELATIONS,
  type FormValues,
  type HouseholdValues,
  type StepId,
} from "@/lib/student-form-types";
import { Field, Input, Select } from "@/components/ui/field";
import { RadioGroupWithOther, YesNoToggle, type FieldErrors } from "../_shared";
import { StepHeader } from "./identity";

type Props = {
  values: FormValues;
  updateStep: <K extends keyof FormValues>(step: K, patch: Partial<FormValues[K]>) => void;
  errors: Record<StepId, FieldErrors>;
  clearFieldError: (step: StepId, path: string) => void;
};

export function HouseholdStep({ values, updateStep, errors, clearFieldError }: Props) {
  const v = values.household;
  const e = errors.household;
  const bind =
    <K extends keyof HouseholdValues>(key: K) =>
    (val: HouseholdValues[K]) => {
      updateStep("household", { [key]: val } as Partial<HouseholdValues>);
      clearFieldError("household", key as string);
    };

  const toggleLivingWith = (option: string) => {
    const set = new Set(v.livingWith);
    if (set.has(option)) set.delete(option);
    else set.add(option);
    bind("livingWith")(Array.from(set));
  };

  const setLivingWithOther = (val: string) => {
    const withoutOther = v.livingWith.filter((x) =>
      (LIVING_WITH_OPTIONS as readonly string[]).includes(x),
    );
    bind("livingWith")(val.trim() ? [...withoutOther, val] : withoutOther);
  };

  const livingWithOther = v.livingWith.find(
    (x) => !(LIVING_WITH_OPTIONS as readonly string[]).includes(x),
  );

  return (
    <div className="space-y-6">
      <StepHeader
        title="Keluarga & Ekonomi"
        subtitle="Ceritakan kondisi ekonomi keluargamu dengan jujur. Data ini kami rahasiakan dan hanya digunakan untuk seleksi program."
      />

      {/* Tinggal bersama */}
      <Field group
        label="Kamu tinggal bersama siapa?"
        required
        hint="Centang keduanya jika masih tinggal dengan ayah dan ibu. Kalau tinggal dengan wali lain, isi kolom 'Lainnya'."
        error={e.livingWith}
      >
        <div className="space-y-2" data-error={!!e.livingWith}>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {LIVING_WITH_OPTIONS.map((opt) => {
              const active = v.livingWith.includes(opt);
              return (
                <label
                  key={opt}
                  className={`flex items-center gap-2.5 px-4 py-2.5 border-2 rounded-lg cursor-pointer transition-colors text-sm ${
                    active
                      ? "border-primary-blue bg-primary-blue/5 text-primary-blue font-semibold"
                      : "border-gray-200 hover:border-gray-300 text-gray-700"
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={active}
                    onChange={() => toggleLivingWith(opt)}
                    className="w-4 h-4 accent-primary-blue"
                  />
                  <span>{opt}</span>
                </label>
              );
            })}
          </div>
          <Input
            type="text"
            value={livingWithOther ?? ""}
            onChange={(ev) => setLivingWithOther(ev.target.value)}
            placeholder="Lainnya (mis. Nenek, Paman) — kosongkan jika tidak ada"
          />
        </div>
      </Field>

      {/* Ayah */}
      <FormSection title="Data Ayah">
        <Field
          label="Nama Ayah (sesuai KTP/KK)"
          id="fatherName"
          required
          error={e.fatherName}
        >
          <Input
            id="fatherName"
            type="text"
            value={v.fatherName}
            onChange={(ev) => bind("fatherName")(ev.target.value)}
            data-error={!!e.fatherName}
          />
        </Field>

        <Field group
          label="Pekerjaan Ayah"
          required
          hint='Pilih "Lainnya" hanya jika pekerjaan tidak ada di opsi.'
          error={e.fatherOccupation}
        >
          <div data-error={!!e.fatherOccupation}>
            <RadioGroupWithOther
              name="fatherOccupation"
              value={v.fatherOccupation}
              onChange={bind("fatherOccupation")}
              options={FATHER_OCCUPATIONS}
              columns={2}
              otherPlaceholder="Sebutkan pekerjaan"
            />
          </div>
        </Field>

        <IncomeField
          id="fatherIncome"
          label="Penghasilan Ayah per Bulan"
          value={v.fatherIncome}
          onChange={bind("fatherIncome")}
          error={e.fatherIncome}
        />
      </FormSection>

      {/* Ibu */}
      <FormSection title="Data Ibu">
        <Field
          label="Nama Ibu (sesuai KTP/KK)"
          id="motherName"
          required
          error={e.motherName}
        >
          <Input
            id="motherName"
            type="text"
            value={v.motherName}
            onChange={(ev) => bind("motherName")(ev.target.value)}
            data-error={!!e.motherName}
          />
        </Field>

        <Field group
          label="Pekerjaan Ibu"
          required
          hint='Pilih "Lainnya" hanya jika pekerjaan tidak ada di opsi.'
          error={e.motherOccupation}
        >
          <div data-error={!!e.motherOccupation}>
            <RadioGroupWithOther
              name="motherOccupation"
              value={v.motherOccupation}
              onChange={bind("motherOccupation")}
              options={MOTHER_OCCUPATIONS}
              columns={2}
              otherPlaceholder="Sebutkan pekerjaan"
            />
          </div>
        </Field>

        <IncomeField
          id="motherIncome"
          label="Penghasilan Ibu per Bulan"
          value={v.motherIncome}
          onChange={bind("motherIncome")}
          error={e.motherIncome}
        />
      </FormSection>

      {/* Anggota keluarga lain yang bekerja */}
      <FormSection title="Anggota Keluarga Lain yang Bekerja (Opsional)">
        <Field group
          label="Apakah ada anggota keluarga lain (selain ayah dan ibu) yang bekerja?"
          required={false}
        >
          <YesNoToggle
            name="hasOtherEarner1"
            value={v.hasOtherEarner1}
            onChange={(val) => {
              bind("hasOtherEarner1")(val);
              if (!val) {
                bind("earner1Relation")("");
                bind("earner1Income")("");
                bind("hasOtherEarner2")(false);
                bind("earner2Relation")("");
                bind("earner2Income")("");
              }
            }}
          />
        </Field>

        {v.hasOtherEarner1 && (
          <div className="rounded-xl border border-gray-200 bg-gray-50/60 p-4 md:p-5 space-y-5">
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
              Anggota 1
            </p>
            <Field group
              label="Hubungan dengan Kamu"
              required
              error={e.earner1Relation}
            >
              <div data-error={!!e.earner1Relation}>
                <RadioGroupWithOther
                  name="earner1Relation"
                  value={v.earner1Relation ?? ""}
                  onChange={bind("earner1Relation")}
                  options={OTHER_EARNER_RELATIONS}
                  columns={2}
                  otherPlaceholder="Sebutkan hubungan"
                />
              </div>
            </Field>
            <IncomeField
              id="earner1Income"
              label="Penghasilan per Bulan"
              value={v.earner1Income ?? ""}
              onChange={bind("earner1Income")}
              error={e.earner1Income}
            />

            <div className="pt-3 border-t border-gray-200">
              <Field group
                label="Ada anggota keluarga kedua yang bekerja?"
                required={false}
              >
                <YesNoToggle
                  name="hasOtherEarner2"
                  value={v.hasOtherEarner2}
                  onChange={(val) => {
                    bind("hasOtherEarner2")(val);
                    if (!val) {
                      bind("earner2Relation")("");
                      bind("earner2Income")("");
                    }
                  }}
                />
              </Field>
            </div>

            {v.hasOtherEarner2 && (
              <div className="rounded-xl border border-gray-200 bg-white p-4 md:p-5 space-y-5">
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                  Anggota 2
                </p>
                <Field group
                  label="Hubungan dengan Kamu"
                  required
                  error={e.earner2Relation}
                >
                  <div data-error={!!e.earner2Relation}>
                    <RadioGroupWithOther
                      name="earner2Relation"
                      value={v.earner2Relation ?? ""}
                      onChange={bind("earner2Relation")}
                      options={OTHER_EARNER_RELATIONS}
                      columns={2}
                      otherPlaceholder="Sebutkan hubungan"
                    />
                  </div>
                </Field>
                <IncomeField
                  id="earner2Income"
                  label="Penghasilan per Bulan"
                  value={v.earner2Income ?? ""}
                  onChange={bind("earner2Income")}
                  error={e.earner2Income}
                />
              </div>
            )}
          </div>
        )}
      </FormSection>

      {/* Jumlah anggota */}
      <Field
        label="Jumlah Anggota Keluarga (termasuk kamu)"
        id="familySize"
        required
        hint="Termasuk dirimu, adik/kakak, dan siapa pun yang tinggal serumah atau dinafkahi dari penghasilan keluarga. Tidak mungkin nol."
        error={e.familySize}
      >
        <Select
          id="familySize"
          value={String(v.familySize ?? "")}
          onChange={(ev) => bind("familySize")(Number(ev.target.value) as HouseholdValues["familySize"])}
          className="max-w-[200px]"
          data-error={!!e.familySize}
        >
          <option value="">— Pilih —</option>
          {Array.from({ length: 20 }, (_, i) => i + 1).map((n) => (
            <option key={n} value={n}>
              {n} orang
            </option>
          ))}
        </Select>
      </Field>
    </div>
  );
}

function FormSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="pt-2">
      <h3 className="text-sm font-bold text-gray-900 uppercase tracking-wide mb-4 pb-2 border-b border-gray-100">
        {title}
      </h3>
      <div className="space-y-5">{children}</div>
    </section>
  );
}

function IncomeField({
  id,
  label,
  value,
  onChange,
  error,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  error?: string;
}) {
  return (
    <Field
      label={label}
      id={id}
      required
      hint={
        <>
          Angka per bulan, <b>tanpa &quot;Rp&quot;</b>. Contoh benar:{" "}
          <b>1.200.000</b> atau <b>500.000</b>. Jika tidak menentu, isi
          perkiraan.
        </>
      }
      error={error}
    >
      <Input
        id={id}
        type="text"
        inputMode="numeric"
        value={value}
        onChange={(ev) => onChange(ev.target.value)}
        placeholder="1.200.000"
        data-error={!!error}
      />
    </Field>
  );
}
