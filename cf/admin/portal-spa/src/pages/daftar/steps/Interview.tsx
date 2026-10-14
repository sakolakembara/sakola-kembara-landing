import { INTERVIEW_MAX_CHARS } from "@shared/application-form/steps";
import { AreaField, ChoiceField, FormSection, StepHeader } from "../form";

/** Step 6 of 8, "Interview Tertulis": the six questions and the statement, in the legacy words (app/(portal)/portal/daftar/_steps/interview.tsx). */
export function InterviewStep() {
  const long = (name: string, label: string, hint?: string) => <AreaField bucket="interview" name={name} label={label} hint={hint} rows={5} maxLength={INTERVIEW_MAX_CHARS} />;

  return (
    <div className="space-y-6">
      <StepHeader title="Interview Tertulis" subtitle="Jawab dengan jujur dan sesuai kepribadian kamu — kami ingin mengenal cara berpikir, semangat, dan nilai yang kamu pegang." />

      <FormSection title="Motivasi" tone="blue">
        {long("motivationHigherEducation", "Ceritakan alasanmu ingin melanjutkan ke jenjang pendidikan tinggi!", "Ceritakan alasan paling kuat kenapa kamu ingin sekali masuk perguruan tinggi.")}
        {long("motivationSakem", "Mengapa kamu tertarik menjadi bagian dari Sakola Kembara?")}
      </FormSection>

      <FormSection title="Komitmen" tone="blue">
        {long("consistencyPlan", "Sakola Kembara berlangsung setiap akhir pekan. Bagaimana kamu bisa tetap konsisten belajar? Apa yang akan menjadi prioritas kamu, dan kenapa?")}
        {long("attendanceCommitment", "Sebagai bentuk komitmen, kamu harus hadir minimal 80% dalam kegiatan Sakola Kembara. Apakah kamu siap menjalankannya?")}
      </FormSection>

      <FormSection title="Perizinan Orang Tua" tone="blue">
        {long("parentResponse", "Apa tanggapan orang tuamu ketika tahu kamu mendaftar di Sakola Kembara? (jawab sejujur-jujurnya)")}
        {long(
          "ifParentChangesMind",
          "Apakah orang tuamu sudah tahu kegiatan di Sakola Kembara dan sudah mengizinkanmu ikut? Kalau nanti orang tuamu berubah pikiran padahal kamu sudah diterima, apa yang akan kamu lakukan?",
        )}
      </FormSection>

      <FormSection title="Pernyataan" tone="blue">
        <ChoiceField
          bucket="interview"
          name="agreedToSignedStatement"
          label="Jika diterima, apakah kamu benar-benar siap menandatangani surat pernyataan bermaterai dan menerima segala konsekuensi hukum yang menyertainya?"
          options={[
            { value: "ya", label: "Ya, saya siap" },
            { value: "tidak", label: "Tidak" },
          ]}
        />
      </FormSection>
    </div>
  );
}
