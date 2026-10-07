"use client";

import { useActionState, useState } from "react";

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
import { Field, Input, Textarea } from "@/components/ui/field";
import { EditorHeader, EditorMessages, FormSection, SaveButton } from "../_editor";

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

      <EditorHeader
        backHref="/admin/announcements"
        label={mode === "create" ? "Pengumuman Baru" : "Edit Pengumuman"}
      >
        <SaveButton
          label={mode === "create" ? "Buat Pengumuman" : "Simpan Perubahan"}
        />
      </EditorHeader>

      <div className="max-w-4xl px-6 md:px-10 pt-6 pb-12">
        <EditorMessages state={state} successMessage={successMessage} />

        <div className="bg-white rounded-2xl border border-gray-100 p-6 md:p-8 space-y-6">
          <FormSection title="Konten" description="Pesan yang muncul di strip pengumuman.">
            <Field
              label="Judul"
              id="title"
              required
              error={state.fieldErrors?.title?.[0]}
            >
              <Input
                type="text"
                id="title"
                name="title"
                required
                defaultValue={announcement?.title ?? ""}
                placeholder="Contoh: Pendaftaran Angkatan 2026 Dibuka"
              />
            </Field>
            <Field
              label="Isi"
              id="body"
              required
              error={state.fieldErrors?.body?.[0]}
              hint="Pesan singkat (5-500 karakter)."
            >
              <Textarea
                id="body"
                name="body"
                required
                rows={3}
                defaultValue={announcement?.body ?? ""}
                placeholder="Penjelasan singkat..."
              />
            </Field>
          </FormSection>

          <FormSection
            title="Tampilan"
            description="Warna dan ikon strip menyesuaikan severity."
          >
            <Field group
              label="Severity"
              id="severity"
              required
              error={state.fieldErrors?.severity?.[0]}
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
                      className={`relative cursor-pointer px-4 py-3 rounded-xl border-2 transition-all ${
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
                id="ctaLabel"
                error={state.fieldErrors?.ctaLabel?.[0]}
                hint="Kosongkan jika tidak ada tombol."
              >
                <Input
                  type="text"
                  id="ctaLabel"
                  name="ctaLabel"
                  defaultValue={announcement?.ctaLabel ?? ""}
                  placeholder="Contoh: Daftar Sekarang"
                />
              </Field>
              <Field
                label="URL CTA"
                id="ctaUrl"
                error={state.fieldErrors?.ctaUrl?.[0]}
                hint="/gabung-siswa atau URL lengkap (https://...)."
              >
                <Input
                  type="text"
                  id="ctaUrl"
                  name="ctaUrl"
                  defaultValue={announcement?.ctaUrl ?? ""}
                  placeholder="/gabung-siswa"
                />
              </Field>
            </div>
          </FormSection>

          <FormSection
            title="Jadwal"
            description="Kapan pengumuman aktif tampil di publik."
          >
            <div>
              <label className="flex items-center gap-3 px-4 py-2.5 bg-white border-2 border-gray-200 rounded-xl cursor-pointer hover:border-gray-300 transition-colors">
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
                id="startsAt"
                error={state.fieldErrors?.startsAt?.[0]}
                hint="Kosongkan untuk segera tampil saat aktif."
              >
                <Input
                  type="datetime-local"
                  id="startsAt"
                  name="startsAt"
                  defaultValue={toLocalDatetimeValue(announcement?.startsAt)}
                />
              </Field>
              <Field
                label="Berakhir (opsional)"
                id="endsAt"
                error={state.fieldErrors?.endsAt?.[0]}
                hint="Kosongkan untuk tampil tanpa batas waktu."
              >
                <Input
                  type="datetime-local"
                  id="endsAt"
                  name="endsAt"
                  defaultValue={toLocalDatetimeValue(announcement?.endsAt)}
                />
              </Field>
            </div>
          </FormSection>
        </div>
      </div>
    </form>
  );
}

