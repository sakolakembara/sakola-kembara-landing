"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import Link from "next/link";
import { ArrowLeft, FileText, Save, Upload } from "lucide-react";
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

const initialState: ReportFormState = { status: "idle" };

interface EditorFormProps {
  mode: "create" | "edit";
  report?: Report;
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
  report,
  successMessage,
}: EditorFormProps) {
  const action = mode === "create" ? createReport : updateReport;
  const [state, formAction] = useActionState(action, initialState);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);

  const currentYear = new Date().getUTCFullYear();

  return (
    <form action={formAction} encType="multipart/form-data">
      {report && <input type="hidden" name="id" value={report.id} />}

      <header className="sticky top-0 z-20 px-6 md:px-10 py-3 bg-white/95 backdrop-blur border-b border-gray-200">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3 flex-wrap min-w-0">
            <Link
              href="/admin/reports"
              className="inline-flex items-center gap-1 text-sm text-gray-600 hover:text-gray-900 transition-colors"
            >
              <ArrowLeft size={14} /> Kembali
            </Link>
            <span className="text-gray-300 select-none">·</span>
            <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap">
              {mode === "create" ? "Upload Laporan" : "Edit Metadata"}
            </span>
          </div>
          <SubmitButton
            label={mode === "create" ? "Upload Laporan" : "Simpan Perubahan"}
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
            title="Metadata"
            description="Informasi yang muncul di list publik dan admin."
          >
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
                defaultValue={report?.title ?? ""}
                placeholder="Contoh: Laporan Tahunan Sakola Kembara 2025"
                className={TEXT_INPUT}
              />
            </Field>
            <div className="grid md:grid-cols-2 gap-5">
              <Field
                label="Kategori"
                name="category"
                required
                errors={state.fieldErrors?.category}
              >
                <select
                  id="category"
                  name="category"
                  required
                  defaultValue={report?.category ?? "yearly"}
                  className={`${TEXT_INPUT} bg-white`}
                >
                  {reportCategory.map((c) => (
                    <option key={c} value={c}>
                      {REPORT_CATEGORY_LABEL[c]}
                    </option>
                  ))}
                </select>
              </Field>
              <Field
                label="Tahun"
                name="year"
                required
                errors={state.fieldErrors?.year}
                hint="Tahun yang laporan ini cakup, bukan tanggal upload."
              >
                <input
                  type="number"
                  id="year"
                  name="year"
                  required
                  min={2018}
                  max={currentYear + 1}
                  defaultValue={report?.year ?? currentYear}
                  placeholder={String(currentYear)}
                  className={TEXT_INPUT}
                />
              </Field>
            </div>
          </Section>

          <Section
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
                name="file"
                required
                errors={state.fieldErrors?.file}
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
