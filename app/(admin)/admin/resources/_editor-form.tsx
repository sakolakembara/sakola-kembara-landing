"use client";

import { useActionState, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import Link from "next/link";
import {
  ArrowLeft,
  FileText,
  Link as LinkIcon,
  Save,
  Type,
  Upload,
} from "lucide-react";
import {
  resourceContentType,
  type ResourceContentType,
  type SiteResource,
} from "@/lib/db/schema";
import { formatBytes } from "@/lib/report-types";
import {
  RESOURCE_CATEGORY_LABEL,
  RESOURCE_CATEGORY_ORDER,
} from "@/lib/site-resources-config";
import {
  createResource,
  updateResource,
  type ResourceFormState,
} from "./actions";

const initialState: ResourceFormState = { status: "idle" };

const TEXT_INPUT =
  "w-full px-4 py-2.5 border-2 border-gray-200 rounded-lg focus:border-primary-blue focus:outline-none text-sm";

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="inline-flex items-center gap-2 px-6 py-2.5 bg-primary-blue text-white font-semibold rounded-lg hover:bg-primary-blue-dark disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
    >
      <Save size={16} />
      {pending ? "Menyimpan…" : label}
    </button>
  );
}

const CONTENT_TYPE_META: Record<
  ResourceContentType,
  { label: string; description: string; icon: typeof FileText }
> = {
  file: {
    label: "File",
    description: "Upload file yang bisa diunduh oleh calon siswa.",
    icon: FileText,
  },
  url: {
    label: "Link Eksternal",
    description: "Tautan ke Google Drive, Canva, YouTube, dan sejenisnya.",
    icon: LinkIcon,
  },
  text: {
    label: "Teks",
    description: "Snippet teks yang bisa disalin (mis. caption IG, template broadcast).",
    icon: Type,
  },
};

export function EditorForm({
  mode,
  resource,
}: {
  mode: "create" | "edit";
  resource?: SiteResource;
}) {
  const action = mode === "create" ? createResource : updateResource;
  const [state, formAction] = useActionState(action, initialState);
  const [contentType, setContentType] = useState<ResourceContentType>(
    resource?.contentType ?? "file",
  );
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [removeFile, setRemoveFile] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const showExistingFile =
    contentType === "file" &&
    resource?.filePath &&
    !selectedFile &&
    !removeFile;

  return (
    <form action={formAction}>
      {resource && <input type="hidden" name="id" value={resource.id} />}
      <input type="hidden" name="contentType" value={contentType} />
      {removeFile && <input type="hidden" name="removeFile" value="on" />}

      <header className="sticky top-0 z-20 px-6 md:px-10 py-3 bg-white/95 backdrop-blur border-b border-gray-200">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3 flex-wrap min-w-0">
            <Link
              href="/admin/resources"
              className="inline-flex items-center gap-1 text-sm text-gray-600 hover:text-gray-900 transition-colors"
            >
              <ArrowLeft size={14} /> Kembali
            </Link>
            <span className="text-gray-300 select-none">·</span>
            <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap">
              {mode === "create" ? "Resource Baru" : "Edit Resource"}
            </span>
          </div>
          <SubmitButton
            label={mode === "create" ? "Buat Resource" : "Simpan Perubahan"}
          />
        </div>
      </header>

      <div className="max-w-4xl px-6 md:px-10 pt-6 pb-12">
        {state.status === "error" && state.message && (
          <div className="mb-5 bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">
            {state.message}
          </div>
        )}
        {state.status === "success" && state.message && (
          <div className="mb-5 bg-green-50 border border-green-200 rounded-lg px-4 py-3 text-sm text-green-700">
            {state.message}
          </div>
        )}

        <div className="bg-white rounded-2xl border border-gray-100 p-6 md:p-8 space-y-6">
          <Section title="Metadata">
            <Field
              label="Judul"
              name="title"
              required
              errors={state.fieldErrors?.title}
            >
              <input
                id="title"
                type="text"
                name="title"
                required
                defaultValue={resource?.title ?? ""}
                placeholder="Contoh: Panduan Pendaftaran Sakola Kembara Gen 6"
                className={TEXT_INPUT}
              />
            </Field>

            <Field
              label="Deskripsi"
              name="description"
              errors={state.fieldErrors?.description}
              hint="Muncul di bawah judul di /gabung-siswa/docs. Boleh dikosongkan."
            >
              <textarea
                id="description"
                name="description"
                rows={3}
                defaultValue={resource?.description ?? ""}
                placeholder="Ringkas isi atau instruksi penggunaan resource ini."
                className={`${TEXT_INPUT} resize-y min-h-[80px]`}
              />
            </Field>

            <div className="grid md:grid-cols-2 gap-5">
              <Field
                label="Kategori"
                name="category"
                required
                errors={state.fieldErrors?.category}
                hint="Menentukan section di halaman /gabung-siswa/docs."
              >
                <select
                  id="category"
                  name="category"
                  required
                  defaultValue={resource?.category ?? "berkas-pendaftaran"}
                  className={`${TEXT_INPUT} bg-white`}
                >
                  {RESOURCE_CATEGORY_ORDER.map((c) => (
                    <option key={c} value={c}>
                      {RESOURCE_CATEGORY_LABEL[c]}
                    </option>
                  ))}
                </select>
              </Field>
              <Field
                label="Urutan Tampil"
                name="displayOrder"
                required
                errors={state.fieldErrors?.displayOrder}
                hint="Lebih kecil = lebih dulu di dalam kategori."
              >
                <input
                  id="displayOrder"
                  type="number"
                  name="displayOrder"
                  required
                  min={0}
                  max={9999}
                  defaultValue={resource?.displayOrder ?? 100}
                  className={TEXT_INPUT}
                />
              </Field>
            </div>
          </Section>

          <Section
            title="Tipe Konten"
            description="Setiap resource hanya salah satu tipe: file, link, atau teks."
          >
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {resourceContentType.map((t) => {
                const meta = CONTENT_TYPE_META[t];
                const active = contentType === t;
                return (
                  <label
                    key={t}
                    className={`flex flex-col gap-2 p-4 border-2 rounded-lg cursor-pointer transition-colors ${
                      active
                        ? "border-primary-blue bg-primary-blue/5"
                        : "border-gray-200 hover:border-gray-300"
                    }`}
                  >
                    <input
                      type="radio"
                      name="_contentType"
                      value={t}
                      checked={active}
                      onChange={() => setContentType(t)}
                      className="hidden"
                    />
                    <span className="flex items-center gap-2">
                      <meta.icon
                        size={16}
                        className={active ? "text-primary-blue" : "text-gray-500"}
                      />
                      <span
                        className={`text-sm font-semibold ${
                          active ? "text-primary-blue" : "text-gray-800"
                        }`}
                      >
                        {meta.label}
                      </span>
                    </span>
                    <span className="text-xs text-gray-600 leading-relaxed">
                      {meta.description}
                    </span>
                  </label>
                );
              })}
            </div>
          </Section>

          {contentType === "file" && (
            <Section title="File">
              {showExistingFile && (
                <div className="flex items-center gap-3 p-3 rounded-lg bg-gray-50 border border-gray-200">
                  <FileText size={18} className="text-gray-500 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <a
                      href={resource!.filePath!}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm font-medium text-primary-blue hover:underline truncate block"
                    >
                      {resource!.filePath}
                    </a>
                    <div className="text-xs text-gray-500 mt-0.5">
                      {resource!.fileSize
                        ? formatBytes(resource!.fileSize)
                        : "—"}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setRemoveFile(true)}
                    className="text-xs text-red-600 hover:underline shrink-0"
                  >
                    Hapus
                  </button>
                </div>
              )}

              <input
                ref={fileInputRef}
                type="file"
                name="file"
                onChange={(e) => {
                  const f = e.target.files?.[0] ?? null;
                  setSelectedFile(f);
                  if (f) setRemoveFile(false);
                }}
                className="hidden"
              />
              <div className="flex items-center gap-2 flex-wrap">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="inline-flex items-center gap-1.5 px-4 py-2 border-2 border-gray-200 hover:border-gray-300 text-gray-700 text-sm font-semibold rounded-lg transition-colors"
                >
                  <Upload size={14} />
                  {selectedFile
                    ? "Ganti File Terpilih"
                    : resource?.filePath
                      ? "Upload File Pengganti"
                      : "Pilih File"}
                </button>
                {selectedFile && (
                  <>
                    <span className="text-xs text-gray-600 font-mono truncate max-w-[280px]">
                      {selectedFile.name} · {formatBytes(selectedFile.size)}
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedFile(null);
                        if (fileInputRef.current)
                          fileInputRef.current.value = "";
                      }}
                      className="text-xs text-red-600 hover:underline"
                    >
                      Batal
                    </button>
                  </>
                )}
              </div>
              {state.fieldErrors?.file?.[0] && (
                <p className="text-xs text-red-600 mt-1">
                  {state.fieldErrors.file[0]}
                </p>
              )}
              <p className="text-xs text-gray-500 mt-2">Maksimal 25 MB.</p>
            </Section>
          )}

          {contentType === "url" && (
            <Section title="Link Eksternal">
              <Field
                label="URL"
                name="externalUrl"
                required
                errors={state.fieldErrors?.externalUrl}
                hint="Contoh: https://drive.google.com/…, https://youtube.com/…"
              >
                <input
                  id="externalUrl"
                  type="url"
                  name="externalUrl"
                  defaultValue={resource?.externalUrl ?? ""}
                  placeholder="https://…"
                  className={TEXT_INPUT}
                />
              </Field>
            </Section>
          )}

          {contentType === "text" && (
            <Section
              title="Teks Isi"
              description="Muncul di /gabung-siswa/docs dalam blok kode dengan tombol Salin."
            >
              <Field
                label="Teks"
                name="bodyText"
                required
                errors={state.fieldErrors?.bodyText}
                hint="Contoh: caption Instagram, template pesan broadcast."
              >
                <textarea
                  id="bodyText"
                  name="bodyText"
                  rows={10}
                  defaultValue={resource?.bodyText ?? ""}
                  placeholder="Tulis teks yang ingin bisa disalin calon siswa…"
                  className={`${TEXT_INPUT} resize-y min-h-[200px] font-mono text-xs`}
                />
              </Field>
            </Section>
          )}

          <Section
            title="Catatan Internal"
            description="Tidak ditampilkan ke publik. Untuk keperluan tim admin saja."
          >
            <Field
              label="Catatan"
              name="notes"
              errors={state.fieldErrors?.notes}
            >
              <input
                id="notes"
                type="text"
                name="notes"
                defaultValue={resource?.notes ?? ""}
                placeholder="Sumber asli, kredit desain, dsb."
                className={TEXT_INPUT}
              />
            </Field>
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

