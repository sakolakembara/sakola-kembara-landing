"use client";

import { useActionState, useState } from "react";
import { FileText, Upload } from "lucide-react";
import {
  reportCategory,
  type Report,
} from "@/lib/db/schema";
import { REPORT_CATEGORY_LABEL, formatBytes } from "@/lib/report-types";
import {
  createReport,
  updateReport,
  type ReportFormState,
} from "./actions";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { EditorHeader, EditorMessages, FormSection, SaveButton } from "../_editor";

const initialState: ReportFormState = { status: "idle" };

interface EditorFormProps {
  mode: "create" | "edit";
  report?: Report;
  successMessage?: string;
}

export function EditorForm({
  mode,
  report,
  successMessage,
}: EditorFormProps) {
  const action = mode === "create" ? createReport : updateReport;
  const [state, formAction] = useActionState(action, initialState);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);

  const currentYear = new Date().getUTCFullYear();
  const defaultYear = report?.year ?? `${currentYear}/${currentYear + 1}`;

  return (
    <form action={formAction}>
      {report && <input type="hidden" name="id" value={report.id} />}

      <EditorHeader
        backHref="/admin/reports"
        label={mode === "create" ? "Upload Laporan" : "Edit Metadata"}
      >
        <SaveButton
          label={mode === "create" ? "Upload Laporan" : "Simpan Perubahan"}
        />
      </EditorHeader>

      <div className="max-w-4xl px-6 md:px-10 pt-6 pb-12">
        <EditorMessages state={state} successMessage={successMessage} />

        <div className="bg-white rounded-2xl border border-gray-100 p-6 md:p-8 space-y-6">
          <FormSection
            title="Metadata"
            description="Informasi yang muncul di list publik dan admin."
          >
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
                defaultValue={report?.title ?? ""}
                placeholder="Contoh: Laporan Tahunan Sakola Kembara 2025/2026"
              />
            </Field>
            <Field
              label="Deskripsi"
              id="description"
              error={state.fieldErrors?.description?.[0]}
              hint="Ringkasan isi laporan. Muncul di kartu laporan publik."
            >
              <Textarea
                id="description"
                name="description"
                rows={3}
                defaultValue={report?.description ?? ""}
                placeholder="Contoh: Ringkasan kegiatan, pencapaian, dan tantangan sepanjang tahun ajaran 2025/2026."
                className="resize-y min-h-[80px]"
              />
            </Field>
            <div className="grid md:grid-cols-2 gap-5">
              <Field
                label="Kategori"
                id="category"
                required
                error={state.fieldErrors?.category?.[0]}
              >
                <Select
                  id="category"
                  name="category"
                  required
                  defaultValue={report?.category ?? "yearly"}
                >
                  {reportCategory.map((c) => (
                    <option key={c} value={c}>
                      {REPORT_CATEGORY_LABEL[c]}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field
                label="Tahun"
                id="year"
                required
                error={state.fieldErrors?.year?.[0]}
                hint={`Tahun laporan. Gunakan format tahun ajaran (${currentYear}/${currentYear + 1}) atau tahun tunggal (${currentYear}).`}
              >
                <Input
                  type="text"
                  id="year"
                  name="year"
                  required
                  inputMode="numeric"
                  pattern="\d{4}(/\d{4})?"
                  defaultValue={defaultYear}
                  placeholder={`${currentYear}/${currentYear + 1}`}
                />
              </Field>
            </div>
          </FormSection>

          <FormSection
            title="File"
            description={
              mode === "create"
                ? "PDF, maksimal 20 MB. Wajib diupload."
                : "File PDF tidak bisa diganti dari sini. Hapus laporan dan buat baru jika perlu mengganti file."
            }
          >
            {mode === "edit" && report ? (
              <div className="flex items-center gap-3 p-4 bg-gray-50 border border-gray-200 rounded-lg">
                <FileText size={20} className="text-gray-500 shrink-0" />
                <div className="min-w-0 flex-1">
                  <a
                    href={report.filePath}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm font-medium text-primary-blue hover:underline truncate block"
                    title={report.filePath}
                  >
                    {report.filePath}
                  </a>
                  <div className="text-xs text-gray-500 mt-0.5">
                    {formatBytes(report.fileSize)} · diupload{" "}
                    {report.uploadedAt.toLocaleString("id-ID", {
                      dateStyle: "medium",
                      timeStyle: "short",
                    })}
                  </div>
                </div>
              </div>
            ) : (
              <Field
                label="File PDF"
                id="file"
                required
                error={state.fieldErrors?.file?.[0]}
              >
                <label
                  htmlFor="file"
                  className="flex items-center gap-3 p-6 border-2 border-dashed border-gray-300 rounded-lg cursor-pointer hover:border-primary-blue hover:bg-blue-50/30 transition-colors"
                >
                  <Upload size={20} className="text-gray-500 shrink-0" />
                  <div className="flex-1 min-w-0">
                    {selectedFile ? (
                      <>
                        <div className="text-sm font-medium text-gray-900 truncate">
                          {selectedFile.name}
                        </div>
                        <div className="text-xs text-gray-500 mt-0.5">
                          {formatBytes(selectedFile.size)} · klik untuk ganti
                        </div>
                      </>
                    ) : (
                      <>
                        <div className="text-sm font-medium text-gray-900">
                          Klik untuk pilih file PDF
                        </div>
                        <div className="text-xs text-gray-500 mt-0.5">
                          Maksimal 20 MB
                        </div>
                      </>
                    )}
                  </div>
                </label>
                <input
                  type="file"
                  id="file"
                  name="file"
                  accept="application/pdf"
                  required
                  className="hidden"
                  onChange={(e) =>
                    setSelectedFile(e.target.files?.[0] ?? null)
                  }
                />
              </Field>
            )}
          </FormSection>
        </div>
      </div>
    </form>
  );
}

