"use client";

import { useActionState, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import Link from "next/link";
import { ArrowLeft, Plus, Save, Trash2, Upload, User, X } from "lucide-react";
import {
  type EducationEntry,
  type TeamMember,
  type WorkEntry,
} from "@/lib/db/schema";
import { TEAM_CATEGORY_LABEL, TEAM_CATEGORY_ORDER } from "@/lib/team-types";
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

const SMALL_INPUT =
  "w-full px-3 py-2 border-2 border-gray-200 rounded-lg text-sm focus:border-primary-blue focus:outline-none";

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

type EduRow = { key: string; value: EducationEntry };
type WorkRow = { key: string; value: WorkEntry };

let rowKeyCounter = 0;
const nextKey = () => `${Date.now()}-${++rowKeyCounter}`;

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

  const [education, setEducation] = useState<EduRow[]>(() =>
    (member?.educationHistory ?? []).length > 0
      ? member!.educationHistory.map((e) => ({ key: nextKey(), value: e }))
      : [{ key: nextKey(), value: { institution: "", degree: "", year: "" } }],
  );
  const [work, setWork] = useState<WorkRow[]>(() =>
    (member?.workHistory ?? []).length > 0
      ? member!.workHistory.map((w) => ({ key: nextKey(), value: w }))
      : [{ key: nextKey(), value: { organization: "", role: "", period: "" } }],
  );

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

  function updateEducation(key: string, patch: Partial<EducationEntry>) {
    setEducation((rows) =>
      rows.map((r) =>
        r.key === key ? { ...r, value: { ...r.value, ...patch } } : r,
      ),
    );
  }
  function updateWork(key: string, patch: Partial<WorkEntry>) {
    setWork((rows) =>
      rows.map((r) =>
        r.key === key ? { ...r, value: { ...r.value, ...patch } } : r,
      ),
    );
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
            <div className="grid md:grid-cols-2 gap-5">
              <Field
                label="Kategori"
                name="category"
                required
                errors={state.fieldErrors?.category}
                hint="Menentukan section di /tim tempat kartu ini tampil."
              >
                <select
                  id="category"
                  name="category"
                  required
                  defaultValue={member?.category ?? "pengurus"}
                  className={`${TEXT_INPUT} bg-white`}
                >
                  {TEAM_CATEGORY_ORDER.map((c) => (
                    <option key={c} value={c}>
                      {TEAM_CATEGORY_LABEL[c]}
                    </option>
                  ))}
                </select>
              </Field>
              <Field
                label="Urutan Tampil"
                name="displayOrder"
                required
                errors={state.fieldErrors?.displayOrder}
                hint="Lebih kecil = lebih dulu (dalam kategori yang sama). Kelipatan 10 dianjurkan."
              >
                <input
                  type="number"
                  id="displayOrder"
                  name="displayOrder"
                  required
                  min={0}
                  max={9999}
                  defaultValue={member?.displayOrder ?? 100}
                  className={TEXT_INPUT}
                />
              </Field>
            </div>
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

          <Section
            title="Bio"
            description="Deskripsi panjang yang muncul di drawer profil publik."
          >
            <Field label="Bio" name="bio" errors={state.fieldErrors?.bio}>
              <textarea
                id="bio"
                name="bio"
                rows={5}
                defaultValue={member?.bio ?? ""}
                placeholder="Latar belakang singkat, fokus kerja, dan minat pribadi."
                className={`${TEXT_INPUT} resize-y min-h-[120px]`}
              />
            </Field>
          </Section>

          <Section
            title="Riwayat Pendidikan"
            description="Kosongkan institusi untuk menghapus baris saat disimpan."
          >
            <div className="space-y-3">
              {education.map((row, idx) => (
                <div
                  key={row.key}
                  className="rounded-lg border border-gray-200 p-3 grid md:grid-cols-[minmax(0,2fr)_minmax(0,2fr)_minmax(0,1fr)_auto] gap-2 items-start"
                >
                  <input
                    type="text"
                    name={`education[${idx}][institution]`}
                    value={row.value.institution ?? ""}
                    onChange={(e) => updateEducation(row.key, { institution: e.target.value })}
                    placeholder="Institusi (mis. Universitas Indonesia)"
                    className={SMALL_INPUT}
                  />
                  <input
                    type="text"
                    name={`education[${idx}][degree]`}
                    value={row.value.degree ?? ""}
                    onChange={(e) => updateEducation(row.key, { degree: e.target.value })}
                    placeholder="Gelar / jurusan (mis. S1 Pendidikan)"
                    className={SMALL_INPUT}
                  />
                  <input
                    type="text"
                    name={`education[${idx}][year]`}
                    value={row.value.year ?? ""}
                    onChange={(e) => updateEducation(row.key, { year: e.target.value })}
                    placeholder="Tahun (mis. 2018)"
                    className={SMALL_INPUT}
                  />
                  <button
                    type="button"
                    onClick={() =>
                      setEducation((rows) => rows.filter((r) => r.key !== row.key))
                    }
                    className="p-2 text-gray-400 hover:text-red-600 transition-colors"
                    aria-label="Hapus baris"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              ))}
              <button
                type="button"
                onClick={() =>
                  setEducation((rows) => [
                    ...rows,
                    { key: nextKey(), value: { institution: "", degree: "", year: "" } },
                  ])
                }
                className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-primary-blue hover:bg-blue-50 rounded-lg transition-colors"
              >
                <Plus size={14} /> Tambah Pendidikan
              </button>
            </div>
          </Section>

          <Section
            title="Riwayat Pekerjaan"
            description="Kosongkan organisasi untuk menghapus baris saat disimpan."
          >
            <div className="space-y-3">
              {work.map((row, idx) => (
                <div
                  key={row.key}
                  className="rounded-lg border border-gray-200 p-3 grid md:grid-cols-[minmax(0,2fr)_minmax(0,2fr)_minmax(0,1fr)_auto] gap-2 items-start"
                >
                  <input
                    type="text"
                    name={`work[${idx}][organization]`}
                    value={row.value.organization ?? ""}
                    onChange={(e) => updateWork(row.key, { organization: e.target.value })}
                    placeholder="Organisasi (mis. Kemendikbud)"
                    className={SMALL_INPUT}
                  />
                  <input
                    type="text"
                    name={`work[${idx}][role]`}
                    value={row.value.role ?? ""}
                    onChange={(e) => updateWork(row.key, { role: e.target.value })}
                    placeholder="Peran (mis. Analis Program)"
                    className={SMALL_INPUT}
                  />
                  <input
                    type="text"
                    name={`work[${idx}][period]`}
                    value={row.value.period ?? ""}
                    onChange={(e) => updateWork(row.key, { period: e.target.value })}
                    placeholder="Periode (mis. 2019–2022)"
                    className={SMALL_INPUT}
                  />
                  <button
                    type="button"
                    onClick={() =>
                      setWork((rows) => rows.filter((r) => r.key !== row.key))
                    }
                    className="p-2 text-gray-400 hover:text-red-600 transition-colors"
                    aria-label="Hapus baris"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              ))}
              <button
                type="button"
                onClick={() =>
                  setWork((rows) => [
                    ...rows,
                    { key: nextKey(), value: { organization: "", role: "", period: "" } },
                  ])
                }
                className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-primary-blue hover:bg-blue-50 rounded-lg transition-colors"
              >
                <Plus size={14} /> Tambah Pekerjaan
              </button>
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
