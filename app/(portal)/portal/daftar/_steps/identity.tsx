"use client";

import {
  BRANCHES,
  GRADUATION_BATCHES,
  RELIGIONS,
  type FormValues,
  type IdentityValues,
} from "@/lib/student-form-types";
import type { StepId } from "@/lib/student-form-types";
import { Field, RadioGroup, TEXT_INPUT, type FieldErrors } from "../_shared";

type Props = {
  values: FormValues;
  updateStep: <K extends keyof FormValues>(step: K, patch: Partial<FormValues[K]>) => void;
  errors: Record<StepId, FieldErrors>;
  clearFieldError: (step: StepId, path: string) => void;
};

export function IdentityStep({ values, updateStep, errors, clearFieldError }: Props) {
  const v = values.identity;
  const e = errors.identity;
  const bind =
    <K extends keyof IdentityValues>(key: K) =>
    (val: IdentityValues[K]) => {
      updateStep("identity", { [key]: val } as Partial<IdentityValues>);
      clearFieldError("identity", key as string);
    };

  return (
    <div className="space-y-6">
      <StepHeader
        title="Identitas Pribadi"
        subtitle="Bagian ini berisi informasi dasar tentang dirimu. Kami gunakan data ini untuk mengenalmu lebih jauh dan mempermudah komunikasi selama program berlangsung."
      />

      <Field
        label="Nama Lengkap"
        htmlFor="fullName"
        required
        hint={
          <>
            Isi sesuai KTP/KK/Akta dan gunakan huruf kapital di awal setiap kata.<br />
            Contoh benar: <b>Dadi Dinan Haris</b>. Hindari <s>DADI DINAN</s> atau <s>dadi din</s>.
          </>
        }
        error={e.fullName}
      >
        <input
          id="fullName"
          type="text"
          value={v.fullName}
          onChange={(ev) => bind("fullName")(ev.target.value)}
          className={TEXT_INPUT}
          placeholder="Contoh: Dadi Dinan Haris"
          data-error={!!e.fullName}
        />
      </Field>

      <Field
        label="Nama Panggilan"
        htmlFor="nickname"
        required
        hint="Isi bebas sesuai nama sehari-hari kamu. Contoh: Dadi, Joy."
        error={e.nickname}
      >
        <input
          id="nickname"
          type="text"
          value={v.nickname}
          onChange={(ev) => bind("nickname")(ev.target.value)}
          className={TEXT_INPUT}
          data-error={!!e.nickname}
        />
      </Field>

      <Field label="Jenis Kelamin" required error={e.gender}>
        <div data-error={!!e.gender}>
          <RadioGroup<"laki-laki" | "perempuan">
            name="gender"
            value={v.gender}
            onChange={bind("gender")}
            options={[
              { value: "laki-laki", label: "Laki-laki" },
              { value: "perempuan", label: "Perempuan" },
            ]}
          />
        </div>
      </Field>

      <Field label="Agama" required error={e.religion}>
        <div data-error={!!e.religion}>
          <RadioGroup
            name="religion"
            value={v.religion}
            onChange={bind("religion")}
            columns={3}
            options={RELIGIONS.map((r) => ({ value: r, label: r }))}
          />
        </div>
      </Field>

      <Field
        label="Asal Sekolah"
        htmlFor="schoolName"
        required
        hint={
          <>
            Tulis lengkap, jangan disingkat.<br />
            Benar: <b>SMAN 1 Cililin</b>. Kurang tepat: <s>SMA Negeri 1 Cililin</s>.
          </>
        }
        error={e.schoolName}
      >
        <input
          id="schoolName"
          type="text"
          value={v.schoolName}
          onChange={(ev) => bind("schoolName")(ev.target.value)}
          className={TEXT_INPUT}
          placeholder="Contoh: SMAN 1 Cililin"
          data-error={!!e.schoolName}
        />
      </Field>

      <Field label="Cabang Sakola Kembara" required error={e.branch}>
        <div data-error={!!e.branch}>
          <RadioGroup
            name="branch"
            value={v.branch}
            onChange={bind("branch")}
            columns={3}
            options={BRANCHES.map((b) => ({ value: b, label: b }))}
          />
        </div>
      </Field>

      <Field
        label="Alamat Rumah (sesuai KTP/KK)"
        htmlFor="homeAddress"
        required
        error={e.homeAddress}
      >
        <textarea
          id="homeAddress"
          rows={3}
          value={v.homeAddress}
          onChange={(ev) => bind("homeAddress")(ev.target.value)}
          className={`${TEXT_INPUT} resize-y min-h-[80px]`}
          placeholder="Alamat lengkap: jalan, RT/RW, kelurahan, kecamatan, kota/kabupaten, provinsi"
          data-error={!!e.homeAddress}
        />
      </Field>

      <Field
        label="Tahun Angkatan Kelulusan"
        required
        hint="Isi sesuai tahun kelulusan SMA. Kalau kamu sekarang kelas 12, pilih 2027."
        error={e.graduationBatch}
      >
        <div data-error={!!e.graduationBatch}>
          <RadioGroup
            name="graduationBatch"
            value={v.graduationBatch}
            onChange={bind("graduationBatch")}
            columns={2}
            options={GRADUATION_BATCHES.map((g) => ({ value: g, label: g }))}
          />
        </div>
      </Field>

      <Field
        label="Nomor WhatsApp Pribadi"
        htmlFor="whatsapp"
        required
        hint={
          <>
            Tulis dengan format <b>62</b> di depan (tanpa spasi, tanpa +).<br />
            Contoh: <b>6281392254544</b>.
          </>
        }
        error={e.whatsapp}
      >
        <input
          id="whatsapp"
          type="tel"
          inputMode="numeric"
          value={v.whatsapp}
          onChange={(ev) => bind("whatsapp")(ev.target.value.replace(/\s+/g, ""))}
          className={TEXT_INPUT}
          placeholder="6281392254544"
          data-error={!!e.whatsapp}
        />
      </Field>
    </div>
  );
}

export function StepHeader({
  title,
  subtitle,
}: {
  title: string;
  subtitle?: string;
}) {
  return (
    <header className="border-b border-gray-100 pb-4 mb-2">
      <h2 className="font-[family-name:var(--font-display)] text-2xl md:text-3xl text-gray-900 mb-2">
        {title}
      </h2>
      {subtitle && (
        <p className="text-sm md:text-base text-gray-600 leading-relaxed">
          {subtitle}
        </p>
      )}
    </header>
  );
}
