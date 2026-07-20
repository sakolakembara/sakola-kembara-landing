"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import Link from "next/link";
import { ArrowLeft, Save } from "lucide-react";
import {
  announcementSeverity,
  type Announcement,
  type AnnouncementSeverity,
} from "@/lib/db/schema";
import {
  createAnnouncement,
  updateAnnouncement,
  type AnnouncementFormState,
} from "./actions";

const initialState: AnnouncementFormState = { status: "idle" };

interface EditorFormProps {
  mode: "create" | "edit";
  announcement?: Announcement;
  successMessage?: string;
}

const SEVERITY_LABEL: Record<AnnouncementSeverity, string> = {
  info: "Info",
  warning: "Peringatan",
  urgent: "Mendesak",
};

const SEVERITY_HINT: Record<AnnouncementSeverity, string> = {
  info: "Biru — pengumuman netral",
  warning: "Kuning — perhatian, tapi tidak mendesak",
  urgent: "Merah — perlu segera diperhatikan",
};

const TEXT_INPUT =
  "w-full px-4 py-2.5 border-2 border-gray-200 rounded-lg focus:border-primary-blue focus:outline-none";

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="inline-flex items-center gap-2 px-6 py-2.5 bg-primary-blue text-white font-semibold rounded-lg hover:bg-primary-blue-dark transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
    >
      <Save size={16} />
      {pending ? "Menyimpan..." : label}
    </button>
  );
}

function toLocalDatetimeValue(d: Date | null | undefined): string {
  if (!d) return "";
  // <input type="datetime-local"> expects YYYY-MM-DDTHH:mm in local tz.
  const tzOffset = d.getTimezoneOffset() * 60 * 1000;
  return new Date(d.getTime() - tzOffset).toISOString().slice(0, 16);
}

export function EditorForm({
  mode,
  announcement,
  successMessage,
}: EditorFormProps) {
  const action = mode === "create" ? createAnnouncement : updateAnnouncement;
  const [state, formAction] = useActionState(action, initialState);
  const [severity, setSeverity] = useState<AnnouncementSeverity>(
    announcement?.severity ?? "info",
  );

  return (
    <form action={formAction}>
      {announcement && <input type="hidden" name="id" value={announcement.id} />}

      <header className="sticky top-0 z-20 px-6 md:px-10 py-3 bg-white/95 backdrop-blur border-b border-gray-200">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3 flex-wrap min-w-0">
            <Link
              href="/admin/announcements"
              className="inline-flex items-center gap-1 text-sm text-gray-600 hover:text-gray-900 transition-colors"
            >
              <ArrowLeft size={14} /> Kembali
            </Link>
            <span className="text-gray-300 select-none">·</span>
            <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap">
              {mode === "create" ? "Pengumuman Baru" : "Edit Pengumuman"}
            </span>
          </div>
          <SubmitButton
            label={mode === "create" ? "Buat Pengumuman" : "Simpan Perubahan"}
          />
        </div>
      </header>

      <div className="max-w-4xl px-6 md:px-10 pt-6 pb-12">
        {(state.status === "error" && state.message) ||
        (state.status === "success" && state.message) ||
        (successMessage &&
          state.status !== "error" &&
          state.status !== "success") ? (
          <div className="mb-5">
            {state.status === "error" && state.message && (
              <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">
                {state.message}
              </div>
            )}
            {state.status === "success" && state.message && (
              <div className="bg-green-50 border border-green-200 rounded-lg px-4 py-3 text-sm text-green-700">
                {state.message}
              </div>
            )}
            {successMessage &&
              state.status !== "error" &&
              state.status !== "success" && (
                <div className="bg-green-50 border border-green-200 rounded-lg px-4 py-3 text-sm text-green-700">
                  {successMessage}
                </div>
              )}
          </div>
        ) : null}

        <div className="bg-white rounded-2xl border border-gray-100 p-6 md:p-8 space-y-6">
          <Section title="Konten" description="Pesan yang muncul di strip pengumuman.">
            <Field
              label="Judul"
              name="title"
              required
              errors={state.fieldErrors?.title}
            >
              <input
                type="text"
                id="title"
                name="title"
                required
                defaultValue={announcement?.title ?? ""}
                placeholder="Contoh: Pendaftaran Angkatan 2026 Dibuka"
                className={TEXT_INPUT}
              />
            </Field>
            <Field
              label="Isi"
              name="body"
              required
              errors={state.fieldErrors?.body}
              hint="Pesan singkat (5-500 karakter)."
            >
              <textarea
                id="body"
                name="body"
                required
                rows={3}
                defaultValue={announcement?.body ?? ""}
                placeholder="Penjelasan singkat..."
                className={`${TEXT_INPUT} resize-none`}
              />
            </Field>
          </Section>

          <Section
            title="Tampilan"
            description="Warna dan ikon strip menyesuaikan severity."
          >
            <Field
              label="Severity"
              name="severity"
              required
              errors={state.fieldErrors?.severity}
            >
              <div className="grid grid-cols-3 gap-2">
                {announcementSeverity.map((s) => {
                  const ringClass =
                    s === "info"
                      ? "ring-blue-500 bg-blue-50 border-blue-300"
                      : s === "warning"
                        ? "ring-amber-500 bg-amber-50 border-amber-300"
                        : "ring-red-500 bg-red-50 border-red-300";
                  return (
                    <label
                      key={s}
                      className={`relative cursor-pointer px-4 py-3 rounded-lg border-2 transition-all ${
                        severity === s
                          ? `ring-2 ${ringClass}`
                          : "border-gray-200 hover:border-gray-300 bg-white"
                      }`}
                    >
                      <input
                        type="radio"
                        name="severity"
                        value={s}
                        required
                        checked={severity === s}
                        onChange={() => setSeverity(s)}
                        className="sr-only"
                      />
                      <div className="font-semibold text-sm text-gray-900">
                        {SEVERITY_LABEL[s]}
                      </div>
                      <div className="text-xs text-gray-500 mt-0.5">
                        {SEVERITY_HINT[s]}
                      </div>
                    </label>
                  );
                })}
              </div>
            </Field>
            <div className="grid md:grid-cols-2 gap-5">
              <Field
                label="Label CTA"
                name="ctaLabel"
                errors={state.fieldErrors?.ctaLabel}
                hint="Kosongkan jika tidak ada tombol."
              >
                <input
                  type="text"
                  id="ctaLabel"
                  name="ctaLabel"
                  defaultValue={announcement?.ctaLabel ?? ""}
                  placeholder="Contoh: Daftar Sekarang"
                  className={TEXT_INPUT}
                />
              </Field>
              <Field
                label="URL CTA"
                name="ctaUrl"
                errors={state.fieldErrors?.ctaUrl}
                hint="/gabung-siswa atau URL lengkap (https://...)."
              >
                <input
                  type="text"
                  id="ctaUrl"
                  name="ctaUrl"
                  defaultValue={announcement?.ctaUrl ?? ""}
                  placeholder="/gabung-siswa"
                  className={TEXT_INPUT}
                />
              </Field>
            </div>
          </Section>

          <Section
            title="Jadwal"
            description="Kapan pengumuman aktif tampil di publik."
          >
            <div>
              <label className="flex items-center gap-3 px-4 py-2.5 bg-white border-2 border-gray-200 rounded-lg cursor-pointer hover:border-gray-300 transition-colors">
                <input
                  type="checkbox"
                  name="active"
                  defaultChecked={announcement?.active ?? false}
                  className="w-4 h-4 accent-primary-blue"
                />
                <span className="text-sm text-gray-700">
                  <span className="font-medium text-gray-900">Aktifkan.</span>{" "}
                  Pengumuman akan tampil di seluruh halaman publik selama
                  jendela jadwal di bawah.
                </span>
              </label>
            </div>
            <div className="grid md:grid-cols-2 gap-5">
              <Field
                label="Mulai (opsional)"
                name="startsAt"
                errors={state.fieldErrors?.startsAt}
                hint="Kosongkan untuk segera tampil saat aktif."
              >
                <input
                  type="datetime-local"
                  id="startsAt"
                  name="startsAt"
                  defaultValue={toLocalDatetimeValue(announcement?.startsAt)}
                  className={TEXT_INPUT}
                />
              </Field>
              <Field
                label="Berakhir (opsional)"
                name="endsAt"
                errors={state.fieldErrors?.endsAt}
                hint="Kosongkan untuk tampil tanpa batas waktu."
              >
                <input
                  type="datetime-local"
                  id="endsAt"
                  name="endsAt"
                  defaultValue={toLocalDatetimeValue(announcement?.endsAt)}
                  className={TEXT_INPUT}
                />
              </Field>
            </div>
          </Section>
        </div>
      </div>
    </form>
  );
}

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="pb-6 border-b border-gray-100 last:border-b-0 last:pb-0">
      <header className="mb-4">
        <h2 className="text-sm font-semibold text-gray-900 uppercase tracking-wide">
          {title}
        </h2>
        {description && (
          <p className="text-xs text-gray-500 mt-1">{description}</p>
        )}
      </header>
      <div className="space-y-5">{children}</div>
    </section>
  );
}

function Field({
  label,
  name,
  required,
  errors,
  hint,
  children,
}: {
  label: string;
  name: string;
  required?: boolean;
  errors?: string[];
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label
        htmlFor={name}
        className="block text-sm font-medium text-gray-700 mb-2"
      >
        {label}
        {required && <span className="text-red-500 ml-0.5">*</span>}
      </label>
      {children}
      {hint && !errors?.length && (
        <p className="text-xs text-gray-500 mt-1">{hint}</p>
      )}
      {errors?.[0] && <p className="text-xs text-red-600 mt-1">{errors[0]}</p>}
    </div>
  );
}
