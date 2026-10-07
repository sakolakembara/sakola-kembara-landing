"use client";

import {
  RESIDENCE_STATUSES,
  type FormValues,
  type HousingValues,
  type StepId,
} from "@/lib/student-form-types";
import { Field, Input } from "@/components/ui/field";
import { RadioGroup, YesNoToggle, type FieldErrors } from "../_shared";
import { StepHeader } from "./identity";

type Props = {
  values: FormValues;
  updateStep: <K extends keyof FormValues>(step: K, patch: Partial<FormValues[K]>) => void;
  errors: Record<StepId, FieldErrors>;
  clearFieldError: (step: StepId, path: string) => void;
};

export function HousingStep({ values, updateStep, errors, clearFieldError }: Props) {
  const v = values.housing;
  const e = errors.housing;
  const bind =
    <K extends keyof HousingValues>(key: K) =>
    (val: HousingValues[K]) => {
      updateStep("housing", { [key]: val } as Partial<HousingValues>);
      clearFieldError("housing", key as string);
    };

  return (
    <div className="space-y-6">
      <StepHeader
        title="Tempat Tinggal & Hutang"
        subtitle="Isi kondisi tempat tinggal dan (jika ada) tanggungan hutang keluarga. Kalau tidak memiliki hutang, cukup pilih Tidak."
      />

      <Field group label="Status Tempat Tinggal" required error={e.residenceStatus}>
        <div data-error={!!e.residenceStatus}>
          <RadioGroup
            name="residenceStatus"
            value={v.residenceStatus}
            onChange={bind("residenceStatus")}
            columns={3}
            options={RESIDENCE_STATUSES.map((s) => ({ value: s, label: s }))}
          />
        </div>
      </Field>

      <Field
        label="Luas Bangunan Tempat Tinggal"
        id="buildingArea"
        required
        hint="Isi dalam meter persegi. Tidak perlu menuliskan satuan. Contoh: 120 artinya 120 m²."
        error={e.buildingArea}
      >
        <div className="relative max-w-[240px]">
          <Input
            id="buildingArea"
            type="number"
            inputMode="numeric"
            min={0}
            value={v.buildingArea === undefined || (v.buildingArea as unknown as string) === "" ? "" : v.buildingArea}
            onChange={(ev) => bind("buildingArea")(Number(ev.target.value) as HousingValues["buildingArea"])}
            className="pr-14"
            data-error={!!e.buildingArea}
          />
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-gray-500">
            m²
          </span>
        </div>
      </Field>

      <div className="grid sm:grid-cols-2 gap-5">
        <Field
          label="Jumlah Kepemilikan Motor"
          id="motorcycles"
          required
          error={e.motorcycles}
        >
          <Input
            id="motorcycles"
            type="number"
            inputMode="numeric"
            min={0}
            value={v.motorcycles}
            onChange={(ev) => bind("motorcycles")(Number(ev.target.value) as HousingValues["motorcycles"])}
            data-error={!!e.motorcycles}
          />
        </Field>
        <Field
          label="Jumlah Kepemilikan Mobil"
          id="cars"
          required
          error={e.cars}
        >
          <Input
            id="cars"
            type="number"
            inputMode="numeric"
            min={0}
            value={v.cars}
            onChange={(ev) => bind("cars")(Number(ev.target.value) as HousingValues["cars"])}
            data-error={!!e.cars}
          />
        </Field>
      </div>

      <div className="pt-2">
        <h3 className="text-sm font-bold text-gray-900 uppercase tracking-wide mb-4 pb-2 border-b border-gray-100">
          Hutang (Opsional)
        </h3>
        <div className="space-y-5">
          <Field group label="Apakah keluarga kamu memiliki hutang?" required={false}>
            <YesNoToggle
              name="hasDebt"
              value={v.hasDebt}
              onChange={(val) => {
                bind("hasDebt")(val);
                if (!val) {
                  bind("debtType")("");
                  bind("debtAmount")("");
                  bind("debtInstallmentMonths")("");
                  bind("debtDescription")("");
                }
              }}
            />
          </Field>

          {v.hasDebt && (
            <div className="rounded-xl border border-gray-200 bg-gray-50/60 p-4 md:p-5 space-y-5">
              <Field
                label="Jenis Hutang"
                id="debtType"
                required
                hint="Contoh: pinjaman bank, gadai, hutang pribadi, cicilan koperasi."
                error={e.debtType}
              >
                <Input
                  id="debtType"
                  type="text"
                  value={v.debtType ?? ""}
                  onChange={(ev) => bind("debtType")(ev.target.value)}
                  data-error={!!e.debtType}
                />
              </Field>

              <Field
                label="Jumlah Hutang"
                id="debtAmount"
                required
                hint={
                  <>
                    Angka pasti, tanpa &quot;Rp&quot;. Contoh: <b>1.200.000</b>.
                  </>
                }
                error={e.debtAmount}
              >
                <Input
                  id="debtAmount"
                  type="text"
                  inputMode="numeric"
                  value={v.debtAmount ?? ""}
                  onChange={(ev) => bind("debtAmount")(ev.target.value)}
                  placeholder="1.200.000"
                  data-error={!!e.debtAmount}
                />
              </Field>

              <Field
                label="Lama Waktu Cicilan"
                id="debtInstallmentMonths"
                required
                hint="Isi dalam angka bulan tanpa satuan. Contoh: 12 artinya 12 bulan."
                error={e.debtInstallmentMonths}
              >
                <div className="relative max-w-[240px]">
                  <Input
                    id="debtInstallmentMonths"
                    type="number"
                    inputMode="numeric"
                    min={1}
                    value={v.debtInstallmentMonths ?? ""}
                    onChange={(ev) =>
                      bind("debtInstallmentMonths")(ev.target.value)
                    }
                    className="pr-16"
                    data-error={!!e.debtInstallmentMonths}
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-gray-500">
                    bulan
                  </span>
                </div>
              </Field>

              <Field
                label="Keterangan Hutang"
                id="debtDescription"
                required
                hint="Contoh: cicilan rumah, cicilan mobil, cicilan modal usaha."
                error={e.debtDescription}
              >
                <Input
                  id="debtDescription"
                  type="text"
                  value={v.debtDescription ?? ""}
                  onChange={(ev) => bind("debtDescription")(ev.target.value)}
                  data-error={!!e.debtDescription}
                />
              </Field>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
