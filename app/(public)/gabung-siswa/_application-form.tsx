"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { CheckCircle2 } from "lucide-react";
import {
  submitApplication,
  type ApplicationFormState,
} from "./actions";

const initialState: ApplicationFormState = { status: "idle" };

interface FieldProps {
  label: string;
  htmlFor: string;
  required?: boolean;
  errors?: string[];
  children: React.ReactNode;
  hint?: string;
}

function Field({ label, htmlFor, required, errors, children, hint }: FieldProps) {
  return (
    <div>
      <label
        htmlFor={htmlFor}
        className="block text-sm font-medium text-gray-700 mb-2"
      >
        {label}
        {required && <span className="text-red-500 ml-0.5">*</span>}
      </label>
      {children}
      {hint && !errors?.length && (
        <p className="text-xs text-gray-500 mt-1">{hint}</p>
      )}
      {errors?.length ? (
        <p className="text-xs text-red-600 mt-1">{errors[0]}</p>
      ) : null}
    </div>
  );
}

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="w-full md:w-auto px-8 py-3.5 bg-primary-blue text-white font-semibold rounded-xl hover:bg-primary-blue-dark transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
    >
      {pending ? "Mengirim..." : "Kirim Pendaftaran"}
    </button>
  );
}

export function ApplicationForm({ branches }: { branches: string[] }) {
  const [state, formAction] = useActionState(submitApplication, initialState);

  if (state.status === "success") {
    return (
      <div className="bg-green-50 border border-green-200 rounded-2xl p-8 md:p-10 text-center">
        <div className="w-14 h-14 bg-green-600 rounded-full mx-auto mb-4 flex items-center justify-center">
          <CheckCircle2 className="text-white" size={32} />
        </div>
        <h3 className="font-[var(--font-display)] text-2xl text-gray-900 mb-2">
          Pendaftaran Diterima
        </h3>
        <p className="text-gray-700 max-w-md mx-auto">
          {state.message ||
            "Pendaftaran kamu sudah kami terima. Tim akademik akan menghubungi via email."}
        </p>
      </div>
    );
  }

  const inputClass =
    "w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:border-primary-blue focus:outline-none";

  return (
    <form action={formAction} className="space-y-5" noValidate>
      {state.status === "error" && state.message && (
        <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">
          {state.message}
        </div>
      )}

      {/* Honeypot — hidden from humans by clip + tab-out, visible to bots */}
      <div
        aria-hidden="true"
        className="absolute -left-[10000px] top-auto w-px h-px overflow-hidden"
      >
        <label htmlFor="website">
          Website
          <input
            id="website"
            type="text"
            name="website"
            tabIndex={-1}
            autoComplete="off"
          />
        </label>
      </div>

      <div className="grid md:grid-cols-2 gap-5">
        <Field
          label="Nama Lengkap"
          htmlFor="fullName"
          required
          errors={state.fieldErrors?.fullName}
        >
          <input
            id="fullName"
            name="fullName"
            type="text"
            required
            placeholder="Nama sesuai KTP/KK"
            className={inputClass}
          />
        </Field>
        <Field
          label="Email"
          htmlFor="email"
          required
          errors={state.fieldErrors?.email}
        >
          <input
            id="email"
            name="email"
            type="email"
            required
            placeholder="email@contoh.com"
            autoComplete="email"
            className={inputClass}
          />
        </Field>
      </div>

      <div className="grid md:grid-cols-2 gap-5">
        <Field
          label="Nomor WhatsApp"
          htmlFor="whatsapp"
          required
          errors={state.fieldErrors?.whatsapp}
          hint="Contoh: 081234567890"
        >
          <input
            id="whatsapp"
            name="whatsapp"
            type="tel"
            required
            inputMode="tel"
            placeholder="081234567890"
            autoComplete="tel"
            className={inputClass}
          />
        </Field>
        <Field
          label="Tahun Lulus SMA"
          htmlFor="graduationYear"
          required
          errors={state.fieldErrors?.graduationYear}
        >
          <input
            id="graduationYear"
            name="graduationYear"
            type="number"
            required
            min={2020}
            max={2030}
            placeholder="2026"
            className={inputClass}
          />
        </Field>
      </div>

      <Field
        label="Asal Sekolah"
        htmlFor="schoolName"
        required
        errors={state.fieldErrors?.schoolName}
      >
        <input
          id="schoolName"
          name="schoolName"
          type="text"
          required
          placeholder="Nama SMA / SMK / MA"
          className={inputClass}
        />
      </Field>

      <Field
        label="Cabang Pilihan"
        htmlFor="branchPreference"
        errors={state.fieldErrors?.branchPreference}
        hint="Cabang Sakola Kembara terdekat dari domisilimu (opsional)."
      >
        <select
          id="branchPreference"
          name="branchPreference"
          defaultValue=""
          className={`${inputClass} bg-white`}
        >
          <option value="">— Pilih cabang —</option>
          {branches.map((b) => (
            <option key={b} value={b}>
              {b}
            </option>
          ))}
          <option value="Belum tahu">Belum tahu / lainnya</option>
        </select>
      </Field>

      <Field
        label="Motivasi"
        htmlFor="motivation"
        required
        errors={state.fieldErrors?.motivation}
        hint="Ceritakan kenapa kamu ingin bergabung dengan Sakola Kembara dan apa cita-citamu setelah lulus."
      >
        <textarea
          id="motivation"
          name="motivation"
          required
          rows={5}
          placeholder="Tulis motivasimu di sini..."
          className={`${inputClass} resize-none`}
        />
      </Field>

      <Field
        label="Latar Belakang Ekonomi"
        htmlFor="economicBackground"
        errors={state.fieldErrors?.economicBackground}
        hint="Jelaskan singkat kondisi ekonomi keluarga (opsional). Informasi ini membantu tim seleksi memahami situasimu."
      >
        <textarea
          id="economicBackground"
          name="economicBackground"
          rows={3}
          placeholder="Contoh: anak ke-2 dari 4 bersaudara, ayah petani, ibu ibu rumah tangga..."
          className={`${inputClass} resize-none`}
        />
      </Field>

      <div className="pt-2">
        <SubmitButton />
        <p className="text-xs text-gray-500 mt-3">
          Dengan mengirim formulir ini, kamu menyetujui tim Sakola Kembara
          menghubungi kamu via email atau WhatsApp untuk proses seleksi.
        </p>
      </div>
    </form>
  );
}
