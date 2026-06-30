"use client";

import { useActionState, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import Link from "next/link";
import { ArrowLeft, Save, Upload, User, X } from "lucide-react";
import type { TeamMember } from "@/lib/db/schema";
import {
  createTeamMember,
  updateTeamMember,
  uploadTeamPhoto,
  type TeamFormState,
} from "./actions";

const initialState: TeamFormState = { status: "idle" };

interface EditorFormProps {
  mode: "create" | "edit";
  member?: TeamMember;
  successMessage?: string;
}

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

export function EditorForm({
  mode,
  member,
  successMessage,
}: EditorFormProps) {
  const action = mode === "create" ? createTeamMember : updateTeamMember;
  const [state, formAction] = useActionState(action, initialState);
  const [photo, setPhoto] = useState(member?.image ?? "");
  const [photoUploading, setPhotoUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function handleUpload(file: File) {
    setUploadError(null);
    setPhotoUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const result = await uploadTeamPhoto(fd);
      if (!result.ok) {
        setUploadError(result.error);
        return;
      }
      setPhoto(result.path);
    } catch {
      setUploadError("Upload gagal. Coba lagi.");
    } finally {
      setPhotoUploading(false);
    }
  }

  return (
    <form action={formAction}>
      {member && <input type="hidden" name="id" value={member.id} />}

      <header className="sticky top-0 z-20 px-6 md:px-10 py-3 bg-white/95 backdrop-blur border-b border-gray-200">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3 flex-wrap min-w-0">
            <Link
              href="/admin/team"
              className="inline-flex items-center gap-1 text-sm text-gray-600 hover:text-gray-900 transition-colors"
            >
              <ArrowLeft size={14} /> Kembali
            </Link>
            <span className="text-gray-300 select-none">·</span>
            <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap">
              {mode === "create" ? "Anggota Baru" : "Edit Anggota"}
            </span>
          </div>
          <SubmitButton
            label={mode === "create" ? "Buat Anggota" : "Simpan Perubahan"}
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
          <Section
            title="Identitas"
            description="Informasi dasar yang muncul di halaman /tim publik."
          >
            <div className="grid md:grid-cols-2 gap-5">
              <Field label="Nama Lengkap" name="name" required errors={state.fieldErrors?.name}>
                <input
                  type="text"
                  id="name"
                  name="name"
                  required
                  defaultValue={member?.name ?? ""}
                  placeholder="Contoh: Ahmad Fadillah"
                  className={TEXT_INPUT}
                />
              </Field>
              <Field label="Peran" name="role" required errors={state.fieldErrors?.role}>
                <input
                  type="text"
                  id="role"
                  name="role"
                  required
                  defaultValue={member?.role ?? ""}
                  placeholder="Contoh: Ketua Umum"
                  className={TEXT_INPUT}
                />
              </Field>
            </div>
            <Field
              label="Asal Universitas / Institusi"
              name="university"
              errors={state.fieldErrors?.university}
              hint="Opsional. Tampil di bawah peran di kartu publik."
            >
              <input
                type="text"
                id="university"
                name="university"
                defaultValue={member?.university ?? ""}
                placeholder="Contoh: Institut Teknologi Bandung"
                className={TEXT_INPUT}
              />
            </Field>
            <Field
              label="Urutan Tampil"
              name="displayOrder"
              required
              errors={state.fieldErrors?.displayOrder}
              hint="Angka lebih kecil tampil lebih dulu. Disarankan kelipatan 10 (10, 20, 30…) agar mudah disisipkan."
            >
              <input
                type="number"
                id="displayOrder"
                name="displayOrder"
                required
                min={0}
                max={9999}
                defaultValue={member?.displayOrder ?? 100}
                className={`${TEXT_INPUT} max-w-[160px]`}
              />
            </Field>
          </Section>

          <Section
            title="Foto"
            description="Foto kotak 1:1 paling rapi (akan ditampilkan sebagai lingkaran di publik). Maksimal 5 MB."
          >
            <input
              type="hidden"
              name="image"
              value={photo}
            />
            <div className="flex items-center gap-5 flex-wrap">
              <div className="shrink-0 w-24 h-24 rounded-full overflow-hidden border-2 border-gray-200 bg-gray-50 flex items-center justify-center">
                {photo ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={photo}
                    alt="Preview"
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <User size={32} className="text-gray-300" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) handleUpload(f);
                    e.target.value = "";
                  }}
                />
                <div className="flex gap-2 flex-wrap">
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={photoUploading}
                    className="inline-flex items-center gap-1.5 px-4 py-2 bg-gray-900 text-white text-sm font-medium rounded-lg hover:bg-gray-800 disabled:opacity-60 transition-colors"
                  >
                    <Upload size={14} />
                    {photoUploading
                      ? "Mengupload..."
                      : photo
                        ? "Ganti Foto"
                        : "Upload Foto"}
                  </button>
                  {photo && (
                    <button
                      type="button"
                      onClick={() => setPhoto("")}
                      className="inline-flex items-center gap-1 px-3 py-2 text-sm text-gray-600 hover:text-red-600 border-2 border-gray-200 hover:border-red-200 rounded-lg transition-colors"
                    >
                      <X size={14} /> Hapus
                    </button>
                  )}
                </div>
                {photo && (
                  <p className="text-xs text-gray-500 mt-2 font-mono break-all">
                    {photo}
                  </p>
                )}
                {uploadError && (
                  <p className="text-xs text-red-600 mt-2">{uploadError}</p>
                )}
              </div>
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
