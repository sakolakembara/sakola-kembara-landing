"use client";

import Link from "next/link";
import { AlertCircle, FileText } from "lucide-react";
import type {
  DocumentsValues,
  FormValues,
  StepId,
} from "@/lib/student-form-types";
import {
  Field,
  RadioGroup,
  TEXT_INPUT,
  type FieldErrors,
} from "../_shared";
import { StepHeader } from "./identity";

type Props = {
  values: FormValues;
  updateStep: <K extends keyof FormValues>(step: K, patch: Partial<FormValues[K]>) => void;
  errors: Record<StepId, FieldErrors>;
  clearFieldError: (step: StepId, path: string) => void;
};

const REQUIRED_FILES: { label: string; filename: string; note?: string }[] = [
  {
    label: "Surat Keterangan Penghasilan Ayah",
    filename: "NamaLengkap_Cabang_Surat Penghasilan Ayah",
    note: "Kosongkan jika tidak ada.",
  },
  {
    label: "Surat Keterangan Penghasilan Ibu",
    filename: "NamaLengkap_Cabang_Surat Penghasilan Ibu",
    note: "Kosongkan jika tidak ada.",
  },
  {
    label: "Surat Penghasilan Anggota Keluarga Lain (jika ada)",
    filename: "NamaLengkap_Cabang_Surat Penghasilan Anggota Lain 1/2",
  },
  {
    label: "Bukti Hutang (jika ada)",
    filename: "NamaLengkap_Cabang_Bukti Hutang",
    note: "Harus memuat total hutang dan lama cicilan. Bukan struk cicilan bulanan.",
  },
  {
    label: "Tagihan/Token Listrik 3 Bulan Terakhir (1 file PDF)",
    filename: "NamaLengkap_Cabang_Listrik",
  },
  {
    label: "Scan Kartu Keluarga",
    filename: "NamaLengkap_Cabang_KK",
  },
  {
    label: "Surat Izin Orang Tua (bermaterai)",
    filename: "NamaLengkap_Cabang_Surat Izin Ortu",
  },
  {
    label: "Foto Diri (wajah terlihat jelas)",
    filename: "NamaLengkap_Cabang_Foto Diri",
  },
  {
    label: "SKTM Terdaftar DTKS (opsional)",
    filename: "NamaLengkap_Cabang_DTKS",
    note: "SKTM tanpa keterangan DTKS tidak dianggap sah.",
  },
  {
    label: "Foto Rumah — depan, ruang tamu, kamar mandi (1 PDF)",
    filename: "NamaLengkap_Cabang_Foto Rumah",
  },
  {
    label: "Foto Kendaraan yang ada di rumah (1 PDF)",
    filename: "NamaLengkap_Cabang_Foto Kendaraan",
  },
];

export function DocumentsStep({
  values,
  updateStep,
  errors,
  clearFieldError,
}: Props) {
  const v = values.documents;
  const e = errors.documents;
  const bind =
    <K extends keyof DocumentsValues>(key: K) =>
    (val: DocumentsValues[K]) => {
      updateStep("documents", { [key]: val } as Partial<DocumentsValues>);
      clearFieldError("documents", key as string);
    };

  return (
    <div className="space-y-6">
      <StepHeader
        title="Berkas Pendaftaran"
        subtitle="Kumpulkan semua berkas berikut ke satu folder Google Drive, lalu bagikan link folder tersebut di sini. Pastikan setiap file diberi nama sesuai format yang tertera."
      />

      <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 flex gap-3">
        <AlertCircle
          size={18}
          className="text-amber-600 shrink-0 mt-0.5"
          aria-hidden
        />
        <div className="text-sm text-amber-900 leading-relaxed">
          <p className="font-semibold mb-1">Sebelum lanjut:</p>
          <ul className="list-disc pl-4 space-y-1">
            <li>
              Buat satu folder Google Drive baru dan upload semua berkas di
              bawah ke sana.
            </li>
            <li>
              Pastikan akses folder <b>&quot;Siapa saja yang memiliki link
              dapat melihat&quot;</b>.
            </li>
            <li>
              Template surat izin, surat penghasilan, dan SKTM bisa{" "}
              <Link
                href="/gabung-siswa/docs#berkas-pendaftaran"
                target="_blank"
                className="underline font-semibold hover:text-amber-700"
              >
                diunduh di sini
              </Link>
              .
            </li>
            <li>
              Cara melihat pembelian token listrik di aplikasi PLN Mobile
              dijelaskan di{" "}
              <Link
                href="/gabung-siswa/docs#tutorial"
                target="_blank"
                className="underline font-semibold hover:text-amber-700"
              >
                tutorial ini
              </Link>
              .
            </li>
            <li>
              Dilarang memalsukan atau memanipulasi isi berkas — dapat menjadi
              alasan diskualifikasi.
            </li>
          </ul>
        </div>
      </div>

      <div className="border border-gray-200 rounded-xl overflow-hidden">
        <div className="px-4 py-3 bg-gray-50 border-b border-gray-200 flex items-center gap-2">
          <FileText size={16} className="text-gray-500" />
          <h3 className="text-sm font-bold text-gray-800 uppercase tracking-wide">
            Checklist Isi Folder
          </h3>
        </div>
        <ul className="divide-y divide-gray-100">
          {REQUIRED_FILES.map((file) => (
            <li key={file.label} className="px-4 py-3 text-sm">
              <div className="font-semibold text-gray-900">{file.label}</div>
              <div className="text-xs text-gray-500 mt-1 font-mono">
                {file.filename}
              </div>
              {file.note && (
                <div className="text-xs text-gray-500 mt-1 italic">
                  {file.note}
                </div>
              )}
            </li>
          ))}
        </ul>
      </div>

      <Field
        label="Link Folder Google Drive Berkas Pendaftaran"
        htmlFor="folderUrl"
        required
        hint="Contoh: https://drive.google.com/drive/folders/xxxxxxx"
        error={e.folderUrl}
      >
        <input
          id="folderUrl"
          type="url"
          value={v.folderUrl}
          onChange={(ev) => bind("folderUrl")(ev.target.value)}
          className={TEXT_INPUT}
          placeholder="https://drive.google.com/drive/folders/…"
          data-error={!!e.folderUrl}
        />
      </Field>

      <Field
        label="Apakah kamu terdaftar dalam DTKS?"
        required
        hint="DTKS = Data Terpadu Kesejahteraan Sosial. Jika ya, unggah SKTM DTKS di folder di atas."
        error={e.dtksRegistered}
      >
        <div data-error={!!e.dtksRegistered}>
          <RadioGroup
            name="dtksRegistered"
            value={v.dtksRegistered}
            onChange={bind("dtksRegistered")}
            options={[
              { value: "ya", label: "Ya, terdaftar" },
              { value: "tidak", label: "Tidak terdaftar" },
            ]}
          />
        </div>
      </Field>
    </div>
  );
}
