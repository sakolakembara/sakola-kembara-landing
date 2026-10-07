"use client";

import { useActionState, useRef, useState } from "react";
import {
  FileText,
  Link as LinkIcon,
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
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { EditorHeader, EditorMessages, FormSection, SaveButton } from "../_editor";
import { Button } from "@/components/ui/button";

const initialState: ResourceFormState = { status: "idle" };

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

      <EditorHeader
        backHref="/admin/resources"
        label={mode === "create" ? "Berkas Baru" : "Edit Berkas"}
      >
        <SaveButton
          label={mode === "create" ? "Buat Berkas" : "Simpan Perubahan"}
        />
      </EditorHeader>

      <div className="max-w-4xl px-6 md:px-10 pt-6 pb-12">
        <EditorMessages state={state} />

        <div className="bg-white rounded-2xl border border-gray-100 p-6 md:p-8 space-y-6">
          <FormSection title="Metadata">
            <Field
              label="Judul"
              id="title"
              required
              error={state.fieldErrors?.title?.[0]}
            >
              <Input
                id="title"
                type="text"
                name="title"
                required
                defaultValue={resource?.title ?? ""}
                placeholder="Contoh: Panduan Pendaftaran Sakola Kembara Gen 6"
              />
            </Field>

            <Field
              label="Deskripsi"
              id="description"
              error={state.fieldErrors?.description?.[0]}
              hint="Muncul di bawah judul di /gabung-siswa/docs. Boleh dikosongkan."
            >
              <Textarea
                id="description"
                name="description"
                rows={3}
                defaultValue={resource?.description ?? ""}
                placeholder="Ringkas isi atau instruksi penggunaan berkas ini."
                className="resize-y min-h-[80px]"
              />
            </Field>

            <div className="grid md:grid-cols-2 gap-5">
              <Field
                label="Kategori"
                id="category"
                required
                error={state.fieldErrors?.category?.[0]}
                hint="Menentukan section di halaman /gabung-siswa/docs."
              >
                <Select
                  id="category"
                  name="category"
                  required
                  defaultValue={resource?.category ?? "berkas-pendaftaran"}
                >
                  {RESOURCE_CATEGORY_ORDER.map((c) => (
                    <option key={c} value={c}>
                      {RESOURCE_CATEGORY_LABEL[c]}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field
                label="Urutan Tampil"
                id="displayOrder"
                required
                error={state.fieldErrors?.displayOrder?.[0]}
                hint="Lebih kecil = lebih dulu di dalam kategori."
              >
                <Input
                  id="displayOrder"
                  type="number"
                  name="displayOrder"
                  required
                  min={0}
                  max={9999}
                  defaultValue={resource?.displayOrder ?? 100}
                />
              </Field>
            </div>
          </FormSection>

          <FormSection
            title="Tipe Konten"
            description="Setiap berkas hanya salah satu tipe: file, link, atau teks."
          >
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {resourceContentType.map((t) => {
                const meta = CONTENT_TYPE_META[t];
                const active = contentType === t;
                return (
                  <label
                    key={t}
                    className={`flex flex-col gap-2 p-4 border-2 rounded-xl cursor-pointer transition-colors ${
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
          </FormSection>

          {contentType === "file" && (
            <FormSection title="File">
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
                <Button
                  variant="neutral"
                  size="sm"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <Upload size={14} />
                  {selectedFile
                    ? "Ganti File Terpilih"
                    : resource?.filePath
                      ? "Upload File Pengganti"
                      : "Pilih File"}
                </Button>
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
            </FormSection>
          )}

          {contentType === "url" && (
            <FormSection title="Link Eksternal">
              <Field
                label="URL"
                id="externalUrl"
                required
                error={state.fieldErrors?.externalUrl?.[0]}
                hint="Contoh: https://drive.google.com/…, https://youtube.com/…"
              >
                <Input
                  id="externalUrl"
                  type="url"
                  name="externalUrl"
                  defaultValue={resource?.externalUrl ?? ""}
                  placeholder="https://…"
                />
              </Field>
            </FormSection>
          )}

          {contentType === "text" && (
            <FormSection
              title="Teks Isi"
              description="Muncul di /gabung-siswa/docs dalam blok kode dengan tombol Salin."
            >
              <Field
                label="Teks"
                id="bodyText"
                required
                error={state.fieldErrors?.bodyText?.[0]}
                hint="Contoh: caption Instagram, template pesan broadcast."
              >
                <Textarea
                  id="bodyText"
                  name="bodyText"
                  rows={10}
                  defaultValue={resource?.bodyText ?? ""}
                  placeholder="Tulis teks yang ingin bisa disalin calon siswa…"
                  className="resize-y min-h-[200px] font-mono text-xs"
                />
              </Field>
            </FormSection>
          )}

          <FormSection
            title="Catatan Internal"
            description="Tidak ditampilkan ke publik. Untuk keperluan tim admin saja."
          >
            <Field
              label="Catatan"
              id="notes"
              error={state.fieldErrors?.notes?.[0]}
            >
              <Input
                id="notes"
                type="text"
                name="notes"
                defaultValue={resource?.notes ?? ""}
                placeholder="Sumber asli, kredit desain, dsb."
              />
            </Field>
          </FormSection>
        </div>
      </div>
    </form>
  );
}

