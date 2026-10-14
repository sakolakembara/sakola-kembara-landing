import { RESIDENCE_STATUSES } from "@shared/application-form/steps";
import { ChoiceField, StepHeader, TextField, useForm, YesNoField } from "../form";

/** Step 4 of 8, "Tempat Tinggal & Hutang": the legacy fields, words and hints (app/(portal)/portal/daftar/_steps/housing.tsx). */
export function HousingStep() {
  const { values, update } = useForm();

  return (
    <div className="space-y-6">
      <StepHeader title="Tempat Tinggal & Hutang" subtitle="Isi kondisi tempat tinggal dan (jika ada) tanggungan hutang keluarga. Kalau tidak memiliki hutang, cukup pilih Tidak." />

      <ChoiceField bucket="housing" name="residenceStatus" label="Status Tempat Tinggal" columns={3} options={RESIDENCE_STATUSES.map((status) => ({ value: status, label: status }))} />

      <TextField
        bucket="housing"
        name="buildingArea"
        label="Luas Bangunan Tempat Tinggal"
        inputMode="numeric"
        suffix="m²"
        hint="Isi dalam meter persegi. Tidak perlu menuliskan satuan. Contoh: 120 artinya 120 m²."
      />

      <div className="grid gap-5 sm:grid-cols-2">
        <TextField bucket="housing" name="motorcycles" label="Jumlah Kepemilikan Motor" inputMode="numeric" />
        <TextField bucket="housing" name="cars" label="Jumlah Kepemilikan Mobil" inputMode="numeric" />
      </div>

      <div className="pt-2">
        <h3 className="mb-4 border-b border-gray-100 pb-2 text-sm font-bold uppercase tracking-wide text-gray-900">Hutang (Opsional)</h3>
        <div className="space-y-5">
          <YesNoField
            bucket="housing"
            name="hasDebt"
            label="Apakah keluarga kamu memiliki hutang?"
            onChange={(on) => {
              // Turning it off forgets what was written under it, as the legacy form did.
              if (!on) update("housing", { debtType: "", debtAmount: "", debtInstallmentMonths: "", debtDescription: "" });
            }}
          />

          {values.housing.hasDebt && (
            <div className="space-y-5 rounded-xl border border-gray-200 bg-gray-50/60 p-4 md:p-5">
              <TextField bucket="housing" name="debtType" label="Jenis Hutang" hint="Contoh: pinjaman bank, gadai, hutang pribadi, cicilan koperasi." />
              <TextField
                bucket="housing"
                name="debtAmount"
                label="Jumlah Hutang"
                inputMode="numeric"
                placeholder="1.200.000"
                hint={
                  <>
                    Angka pasti, tanpa &quot;Rp&quot;. Contoh: <b>1.200.000</b>.
                  </>
                }
              />
              <TextField
                bucket="housing"
                name="debtInstallmentMonths"
                label="Lama Waktu Cicilan"
                inputMode="numeric"
                suffix="bulan"
                hint="Isi dalam angka bulan tanpa satuan. Contoh: 12 artinya 12 bulan."
              />
              <TextField bucket="housing" name="debtDescription" label="Keterangan Hutang" hint="Contoh: cicilan rumah, cicilan mobil, cicilan modal usaha." />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
