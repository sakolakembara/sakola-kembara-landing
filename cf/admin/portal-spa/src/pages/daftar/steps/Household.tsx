import { Field, Input } from "@/components/ui/field";
import { cn } from "@/lib/cn";
import { FATHER_OCCUPATIONS, LIVING_WITH_OPTIONS, MOTHER_OCCUPATIONS, OTHER_EARNER_RELATIONS } from "@shared/application-form/steps";
import { ChoiceOrOtherField, FormSection, SelectField, StepHeader, TextField, useForm, YesNoField } from "../form";

const FAMILY_SIZES = Array.from({ length: 20 }, (_, i) => ({ value: String(i + 1), label: `${i + 1} orang` }));

const incomeHint = (
  <>
    Angka per bulan, <b>tanpa &quot;Rp&quot;</b>. Contoh benar: <b>1.200.000</b> atau <b>500.000</b>. Jika tidak menentu, isi perkiraan.
  </>
);

/** Step 3 of 8, "Keluarga & Ekonomi": the legacy fields, words and hints (app/(portal)/portal/daftar/_steps/household.tsx). */
export function HouseholdStep() {
  const { values, update } = useForm();
  const v = values.household;

  return (
    <div className="space-y-6">
      <StepHeader title="Keluarga & Ekonomi" subtitle="Ceritakan kondisi ekonomi keluargamu dengan jujur. Data ini kami rahasiakan dan hanya digunakan untuk seleksi program." />

      <LivingWith />

      <FormSection title="Data Ayah">
        <TextField bucket="household" name="fatherName" label="Nama Ayah (sesuai KTP/KK)" />
        <ChoiceOrOtherField bucket="household" name="fatherOccupation" label="Pekerjaan Ayah" hint='Pilih "Lainnya" hanya jika pekerjaan tidak ada di opsi.' options={FATHER_OCCUPATIONS} otherPlaceholder="Sebutkan pekerjaan" />
        <TextField bucket="household" name="fatherIncome" label="Penghasilan Ayah per Bulan" inputMode="numeric" placeholder="1.200.000" hint={incomeHint} />
      </FormSection>

      <FormSection title="Data Ibu">
        <TextField bucket="household" name="motherName" label="Nama Ibu (sesuai KTP/KK)" />
        <ChoiceOrOtherField bucket="household" name="motherOccupation" label="Pekerjaan Ibu" hint='Pilih "Lainnya" hanya jika pekerjaan tidak ada di opsi.' options={MOTHER_OCCUPATIONS} otherPlaceholder="Sebutkan pekerjaan" />
        <TextField bucket="household" name="motherIncome" label="Penghasilan Ibu per Bulan" inputMode="numeric" placeholder="1.200.000" hint={incomeHint} />
      </FormSection>

      <FormSection title="Anggota Keluarga Lain yang Bekerja (Opsional)">
        <YesNoField
          bucket="household"
          name="hasOtherEarner1"
          label="Apakah ada anggota keluarga lain (selain ayah dan ibu) yang bekerja?"
          onChange={(on) => {
            // Turning it off forgets what was written under it, as the legacy form did (the second member needs the first).
            if (!on) update("household", { earner1Relation: "", earner1Income: "", hasOtherEarner2: false, earner2Relation: "", earner2Income: "" });
          }}
        />

        {v.hasOtherEarner1 && (
          <div className="space-y-5 rounded-xl border border-gray-200 bg-gray-50/60 p-4 md:p-5">
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Anggota 1</p>
            <ChoiceOrOtherField bucket="household" name="earner1Relation" label="Hubungan dengan Kamu" options={OTHER_EARNER_RELATIONS} otherPlaceholder="Sebutkan hubungan" />
            <TextField bucket="household" name="earner1Income" label="Penghasilan per Bulan" inputMode="numeric" placeholder="1.200.000" hint={incomeHint} />

            <div className="border-t border-gray-200 pt-3">
              <YesNoField
                bucket="household"
                name="hasOtherEarner2"
                label="Ada anggota keluarga kedua yang bekerja?"
                onChange={(on) => {
                  if (!on) update("household", { earner2Relation: "", earner2Income: "" });
                }}
              />
            </div>

            {v.hasOtherEarner2 && (
              <div className="space-y-5 rounded-xl border border-gray-200 bg-white p-4 md:p-5">
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Anggota 2</p>
                <ChoiceOrOtherField bucket="household" name="earner2Relation" label="Hubungan dengan Kamu" options={OTHER_EARNER_RELATIONS} otherPlaceholder="Sebutkan hubungan" />
                <TextField bucket="household" name="earner2Income" label="Penghasilan per Bulan" inputMode="numeric" placeholder="1.200.000" hint={incomeHint} />
              </div>
            )}
          </div>
        )}
      </FormSection>

      <SelectField
        bucket="household"
        name="familySize"
        label="Jumlah Anggota Keluarga (termasuk kamu)"
        placeholder="— Pilih —"
        options={FAMILY_SIZES}
        hint="Termasuk dirimu, adik/kakak, dan siapa pun yang tinggal serumah atau dinafkahi dari penghasilan keluarga. Tidak mungkin nol."
      />
    </div>
  );
}

const isPreset = (item: string) => (LIVING_WITH_OPTIONS as readonly string[]).includes(item);

/** "Kamu tinggal bersama siapa?": Ayah and Ibu as checkboxes, and a box for anyone else (the legacy "Other"). */
function LivingWith() {
  const { values, errors, update } = useForm();
  const list = values.household.livingWith;
  const other = list.find((item) => !isPreset(item)) ?? "";
  const set = (next: string[]) => update("household", { livingWith: next });

  return (
    <Field
      group
      id="livingWith"
      label="Kamu tinggal bersama siapa?"
      required
      hint="Centang keduanya jika masih tinggal dengan ayah dan ibu. Kalau tinggal dengan wali lain, isi kolom 'Lainnya'."
      error={errors.livingWith}
    >
      <div className="space-y-2" data-field="livingWith">
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {LIVING_WITH_OPTIONS.map((option) => {
            const on = list.includes(option);
            return (
              <label
                key={option}
                className={cn(
                  "flex min-h-11 cursor-pointer items-center gap-2.5 rounded-lg border-2 px-4 py-2.5 text-sm transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-primary-blue has-[:focus-visible]:ring-offset-2",
                  on ? "border-primary-blue bg-primary-blue/5 font-semibold text-primary-blue" : "border-gray-200 text-gray-700 hover:border-gray-300",
                )}
              >
                <input type="checkbox" checked={on} onChange={() => set(on ? list.filter((item) => item !== option) : [...list, option])} className="size-4 accent-primary-blue" />
                <span>{option}</span>
              </label>
            );
          })}
        </div>
        <Input
          type="text"
          aria-label="Lainnya"
          autoComplete="off"
          value={other}
          onChange={(event) => {
            const typed = event.target.value;
            set(typed.trim() === "" ? list.filter(isPreset) : [...list.filter(isPreset), typed]);
          }}
          placeholder="Lainnya (mis. Nenek, Paman) — kosongkan jika tidak ada"
        />
      </div>
    </Field>
  );
}
