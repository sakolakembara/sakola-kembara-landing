"use client";

import { useActionState, useRef, useState } from "react";
import { Plus, Trash2, Upload, User, X } from "lucide-react";
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
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { EditorHeader, EditorMessages, FormSection, SaveButton } from "../_editor";
import { Button } from "@/components/ui/button";

const initialState: TeamFormState = { status: "idle" };

interface EditorFormProps {
  mode: "create" | "edit";
  member?: TeamMember;
  successMessage?: string;
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

      <EditorHeader
        backHref="/admin/team"
        label={mode === "create" ? "Anggota Baru" : "Edit Anggota"}
      >
        <SaveButton
          label={mode === "create" ? "Buat Anggota" : "Simpan Perubahan"}
        />
      </EditorHeader>

      <div className="max-w-4xl px-6 md:px-10 pt-6 pb-12">
        <EditorMessages state={state} successMessage={successMessage} />

        <div className="bg-white rounded-2xl border border-gray-100 p-6 md:p-8 space-y-6">
          <FormSection
            title="Identitas"
            description="Informasi dasar yang muncul di halaman /tim publik."
          >
            <div className="grid md:grid-cols-2 gap-5">
              <Field label="Nama Lengkap" id="name" required error={state.fieldErrors?.name?.[0]}>
                <Input
                  type="text"
                  id="name"
                  name="name"
                  required
                  defaultValue={member?.name ?? ""}
                  placeholder="Contoh: Ahmad Fadillah"
                />
              </Field>
              <Field label="Peran" id="role" required error={state.fieldErrors?.role?.[0]}>
                <Input
                  type="text"
                  id="role"
                  name="role"
                  required
                  defaultValue={member?.role ?? ""}
                  placeholder="Contoh: Ketua Umum"
                />
              </Field>
            </div>
            <div className="grid md:grid-cols-2 gap-5">
              <Field
                label="Kategori"
                id="category"
                required
                error={state.fieldErrors?.category?.[0]}
                hint="Menentukan section di /tim tempat kartu ini tampil."
              >
                <Select
                  id="category"
                  name="category"
                  required
                  defaultValue={member?.category ?? "pengurus"}
                >
                  {TEAM_CATEGORY_ORDER.map((c) => (
                    <option key={c} value={c}>
                      {TEAM_CATEGORY_LABEL[c]}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field
                label="Urutan Tampil"
                id="displayOrder"
                required
                error={state.fieldErrors?.displayOrder?.[0]}
                hint="Lebih kecil = lebih dulu (dalam kategori yang sama). Kelipatan 10 dianjurkan."
              >
                <Input
                  type="number"
                  id="displayOrder"
                  name="displayOrder"
                  required
                  min={0}
                  max={9999}
                  defaultValue={member?.displayOrder ?? 100}
                />
              </Field>
            </div>
          </FormSection>

          <FormSection
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
                  <Button
                    variant="neutral"
                    size="sm"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={photoUploading}
                  >
                    <Upload size={14} />
                    {photoUploading
                      ? "Mengupload..."
                      : photo
                        ? "Ganti Foto"
                        : "Upload Foto"}
                  </Button>
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
          </FormSection>

          <FormSection
            title="Bio"
            description="Deskripsi panjang yang muncul di drawer profil publik."
          >
            <Field label="Bio" id="bio" error={state.fieldErrors?.bio?.[0]}>
              <Textarea
                id="bio"
                name="bio"
                rows={5}
                defaultValue={member?.bio ?? ""}
                placeholder="Latar belakang singkat, fokus kerja, dan minat pribadi."
                className="resize-y min-h-[120px]"
              />
            </Field>
          </FormSection>

          <FormSection
            title="Riwayat Pendidikan"
            description="Kosongkan institusi untuk menghapus baris saat disimpan."
          >
            <div className="space-y-3">
              {education.map((row, idx) => (
                <div
                  key={row.key}
                  className="rounded-lg border border-gray-200 p-3 grid md:grid-cols-[minmax(0,2fr)_minmax(0,2fr)_minmax(0,1fr)_auto] gap-2 items-start"
                >
                  <Input
                    type="text"
                    name={`education[${idx}][institution]`}
                    value={row.value.institution ?? ""}
                    onChange={(e) => updateEducation(row.key, { institution: e.target.value })}
                    placeholder="Institusi (mis. Universitas Indonesia)"
                    size="sm"
                  />
                  <Input
                    type="text"
                    name={`education[${idx}][degree]`}
                    value={row.value.degree ?? ""}
                    onChange={(e) => updateEducation(row.key, { degree: e.target.value })}
                    placeholder="Gelar / jurusan (mis. S1 Pendidikan)"
                    size="sm"
                  />
                  <Input
                    type="text"
                    name={`education[${idx}][year]`}
                    value={row.value.year ?? ""}
                    onChange={(e) => updateEducation(row.key, { year: e.target.value })}
                    placeholder="Tahun (mis. 2018)"
                    size="sm"
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
          </FormSection>

          <FormSection
            title="Riwayat Pekerjaan"
            description="Kosongkan organisasi untuk menghapus baris saat disimpan."
          >
            <div className="space-y-3">
              {work.map((row, idx) => (
                <div
                  key={row.key}
                  className="rounded-lg border border-gray-200 p-3 grid md:grid-cols-[minmax(0,2fr)_minmax(0,2fr)_minmax(0,1fr)_auto] gap-2 items-start"
                >
                  <Input
                    type="text"
                    name={`work[${idx}][organization]`}
                    value={row.value.organization ?? ""}
                    onChange={(e) => updateWork(row.key, { organization: e.target.value })}
                    placeholder="Organisasi (mis. Kemendikbud)"
                    size="sm"
                  />
                  <Input
                    type="text"
                    name={`work[${idx}][role]`}
                    value={row.value.role ?? ""}
                    onChange={(e) => updateWork(row.key, { role: e.target.value })}
                    placeholder="Peran (mis. Analis Program)"
                    size="sm"
                  />
                  <Input
                    type="text"
                    name={`work[${idx}][period]`}
                    value={row.value.period ?? ""}
                    onChange={(e) => updateWork(row.key, { period: e.target.value })}
                    placeholder="Periode (mis. 2019–2022)"
                    size="sm"
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
          </FormSection>
        </div>
      </div>
    </form>
  );
}

