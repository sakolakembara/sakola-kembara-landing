"use client";

import {
  INTERVIEW_MAX_CHARS,
  type FormValues,
  type InterviewValues,
  type StepId,
} from "@/lib/student-form-types";
import { Field, RadioGroup, TEXTAREA, type FieldErrors } from "../_shared";
import { StepHeader } from "./identity";

type Props = {
  values: FormValues;
  updateStep: <K extends keyof FormValues>(step: K, patch: Partial<FormValues[K]>) => void;
  errors: Record<StepId, FieldErrors>;
  clearFieldError: (step: StepId, path: string) => void;
};

export function InterviewStep({
  values,
  updateStep,
  errors,
  clearFieldError,
}: Props) {
  const v = values.interview;
  const e = errors.interview;
  const bind =
    <K extends keyof InterviewValues>(key: K) =>
    (val: InterviewValues[K]) => {
      updateStep("interview", { [key]: val } as Partial<InterviewValues>);
      clearFieldError("interview", key as string);
    };

  return (
    <div className="space-y-6">
      <StepHeader
        title="Interview Tertulis"
        subtitle="Jawab dengan jujur dan sesuai kepribadian kamu — kami ingin mengenal cara berpikir, semangat, dan nilai yang kamu pegang."
      />

      <FormSection title="Motivasi">
        <LongField
          id="motivationHigherEducation"
          label="Ceritakan alasanmu ingin melanjutkan ke jenjang pendidikan tinggi!"
          hint="Ceritakan alasan paling kuat kenapa kamu ingin sekali masuk perguruan tinggi."
          value={v.motivationHigherEducation}
          onChange={bind("motivationHigherEducation")}
          error={e.motivationHigherEducation}
        />
        <LongField
          id="motivationSakem"
          label="Mengapa kamu tertarik menjadi bagian dari Sakola Kembara?"
          value={v.motivationSakem}
          onChange={bind("motivationSakem")}
          error={e.motivationSakem}
        />
      </FormSection>

      <FormSection title="Komitmen">
        <LongField
          id="consistencyPlan"
          label="Sakola Kembara berlangsung setiap akhir pekan. Bagaimana kamu bisa tetap konsisten belajar? Apa yang akan menjadi prioritas kamu, dan kenapa?"
          value={v.consistencyPlan}
          onChange={bind("consistencyPlan")}
          error={e.consistencyPlan}
        />
        <LongField
          id="attendanceCommitment"
          label="Sebagai bentuk komitmen, kamu harus hadir minimal 80% dalam kegiatan Sakola Kembara. Apakah kamu siap menjalankannya?"
          value={v.attendanceCommitment}
          onChange={bind("attendanceCommitment")}
          error={e.attendanceCommitment}
        />
      </FormSection>

      <FormSection title="Perizinan Orang Tua">
        <LongField
          id="parentResponse"
          label="Apa tanggapan orang tuamu ketika tahu kamu mendaftar di Sakola Kembara? (jawab sejujur-jujurnya)"
          value={v.parentResponse}
          onChange={bind("parentResponse")}
          error={e.parentResponse}
        />
        <LongField
          id="ifParentChangesMind"
          label="Apakah orang tuamu sudah tahu kegiatan di Sakola Kembara dan sudah mengizinkanmu ikut? Kalau nanti orang tuamu berubah pikiran padahal kamu sudah diterima, apa yang akan kamu lakukan?"
          value={v.ifParentChangesMind}
          onChange={bind("ifParentChangesMind")}
          error={e.ifParentChangesMind}
        />
      </FormSection>

      <FormSection title="Pernyataan">
        <Field
          label="Jika diterima, apakah kamu benar-benar siap menandatangani surat pernyataan bermaterai dan menerima segala konsekuensi hukum yang menyertainya?"
          required
          error={e.agreedToSignedStatement}
        >
          <div data-error={!!e.agreedToSignedStatement}>
            <RadioGroup
              name="agreedToSignedStatement"
              value={v.agreedToSignedStatement}
              onChange={bind("agreedToSignedStatement")}
              options={[
                { value: "ya", label: "Ya, saya siap" },
                { value: "tidak", label: "Tidak" },
              ]}
            />
          </div>
        </Field>
      </FormSection>
    </div>
  );
}

function FormSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="pt-2">
      <h3 className="text-sm font-bold text-primary-blue uppercase tracking-wide mb-4 pb-2 border-b border-primary-blue/20">
        {title}
      </h3>
      <div className="space-y-5">{children}</div>
    </section>
  );
}

function LongField({
  id,
  label,
  hint,
  value,
  onChange,
  error,
}: {
  id: string;
  label: string;
  hint?: string;
  value: string;
  onChange: (v: string) => void;
  error?: string;
}) {
  return (
    <Field label={label} htmlFor={id} required hint={hint} error={error}>
      <textarea
        id={id}
        rows={5}
        maxLength={INTERVIEW_MAX_CHARS}
        value={value}
        onChange={(ev) => onChange(ev.target.value)}
        className={TEXTAREA}
        data-error={!!error}
      />
      <p
        className={`text-xs mt-1 text-right ${
          value.length >= INTERVIEW_MAX_CHARS
            ? "text-red-600 font-medium"
            : value.length >= INTERVIEW_MAX_CHARS * 0.9
              ? "text-amber-600"
              : "text-gray-400"
        }`}
      >
        {value.length} / {INTERVIEW_MAX_CHARS} karakter
      </p>
    </Field>
  );
}
