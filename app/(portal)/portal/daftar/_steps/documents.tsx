"use client";

import Link from "next/link";
import { AlertCircle } from "lucide-react";
import type {
  DocumentsValues,
  FormValues,
  StepId,
} from "@/lib/student-form-types";
import { Field, Input } from "@/components/ui/field";
import { RadioGroup, type FieldErrors } from "../_shared";
import { StepHeader } from "./identity";

type Props = {
  values: FormValues;
  updateStep: <K extends keyof FormValues>(step: K, patch: Partial<FormValues[K]>) => void;
  errors: Record<StepId, FieldErrors>;
  clearFieldError: (step: StepId, path: string) => void;
};

type UrlKey =
  | "fatherIncomeUrl"
  | "motherIncomeUrl"
  | "otherEarner1IncomeUrl"
  | "otherEarner2IncomeUrl"
  | "debtProofUrl"
  | "electricityBillUrl"
  | "familyCardUrl"
  | "parentPermissionUrl"
  | "selfPhotoUrl"
  | "dtksUrl"
  | "houseImagesUrl"
  | "vehicleImagesUrl";

type DocSpec = {
  key: UrlKey;
  label: string;
  filename: string;
  required: boolean;
  note?: React.ReactNode;
};

const DOCS: DocSpec[] = [
  {
    key: "fatherIncomeUrl",
    label: "Surat Keterangan Penghasilan Ayah",
    filename: "NamaLengkap_Cabang_Surat Penghasilan Ayah",
    required: false,
    note: (
      <>
        Kosongkan jika tidak ada. Template surat bisa diunduh di{" "}
        <DocsLink hash="berkas-pendaftaran">Pusat Dokumen</DocsLink>.
      </>
    ),
  },
  {
    key: "motherIncomeUrl",
    label: "Surat Keterangan Penghasilan Ibu",
    filename: "NamaLengkap_Cabang_Surat Penghasilan Ibu",
    required: false,
    note: (
      <>
        Kosongkan jika tidak ada. Template surat bisa diunduh di{" "}
        <DocsLink hash="berkas-pendaftaran">Pusat Dokumen</DocsLink>.
      </>
    ),
  },
  {
    key: "otherEarner1IncomeUrl",
    label: "Surat Penghasilan Anggota Keluarga Lain (1)",
    filename: "NamaLengkap_Cabang_Surat Penghasilan Anggota Lain 1",
    required: false,
    note: "Isi jika ada anggota keluarga lain (selain Ayah/Ibu) yang bekerja.",
  },
  {
    key: "otherEarner2IncomeUrl",
    label: "Surat Penghasilan Anggota Keluarga Lain (2)",
    filename: "NamaLengkap_Cabang_Surat Penghasilan Anggota Lain 2",
    required: false,
    note: "Isi jika ada anggota keluarga lain kedua yang bekerja.",
  },
  {
    key: "debtProofUrl",
    label: "Bukti Hutang",
    filename: "NamaLengkap_Cabang_Bukti Hutang",
    required: false,
    note: "Wajib memuat total hutang dan lama cicilan. Bukan struk cicilan bulanan. Kosongkan jika tidak memiliki hutang.",
  },
  {
    key: "electricityBillUrl",
    label: "Tagihan/Token Listrik 3 Bulan Terakhir",
    filename: "NamaLengkap_Cabang_Listrik",
    required: true,
    note: (
      <>
        Jadikan 1 file PDF. Cara melihat pembelian token di PLN Mobile ada di{" "}
        <DocsLink hash="tutorial">tutorial ini</DocsLink>.
      </>
    ),
  },
  {
    key: "familyCardUrl",
    label: "Scan Kartu Keluarga",
    filename: "NamaLengkap_Cabang_KK",
    required: true,
  },
  {
    key: "parentPermissionUrl",
    label: "Surat Izin Orang Tua (bermaterai)",
    filename: "NamaLengkap_Cabang_Surat Izin Ortu",
    required: true,
    note: (
      <>
        Template surat bisa diunduh di{" "}
        <DocsLink hash="berkas-pendaftaran">Pusat Dokumen</DocsLink>.
      </>
    ),
  },
  {
    key: "selfPhotoUrl",
    label: "Foto Diri",
    filename: "NamaLengkap_Cabang_Foto Diri",
    required: true,
    note: "Wajah wajib terlihat jelas.",
  },
  {
    key: "houseImagesUrl",
    label: "Foto Rumah — depan, ruang tamu, kamar mandi",
    filename: "NamaLengkap_Cabang_Foto Rumah",
    required: true,
    note: "Jadikan 1 file PDF.",
  },
  {
    key: "vehicleImagesUrl",
    label: "Foto Kendaraan yang ada di rumah",
    filename: "NamaLengkap_Cabang_Foto Kendaraan",
    required: true,
    note: "Kalau lebih dari satu kendaraan, jadikan 1 file PDF. Kalau tidak memiliki kendaraan sama sekali, tetap upload surat pernyataan tidak memiliki kendaraan.",
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
        subtitle="Unggah setiap berkas ke Google Drive-mu, lalu tempel link masing-masing di kolom yang sesuai. Pastikan setiap link diatur ke 'Siapa saja yang memiliki link dapat melihat'. Setelah bagian ini, kamu akan mengumpulkan berkas marketing di bagian bawah."
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
              Setiap file diberi nama sesuai format yang tertera di kolomnya.
            </li>
            <li>
              Setiap link Google Drive harus bisa diakses siapa saja (bukan
              &quot;hanya orang tertentu&quot;).
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
              Dilarang memalsukan atau memanipulasi isi berkas — dapat menjadi
              alasan diskualifikasi.
            </li>
          </ul>
        </div>
      </div>

      <div className="space-y-5">
        {DOCS.map((doc) => (
          <DocLinkField
            key={doc.key}
            id={doc.key}
            label={doc.label}
            filename={doc.filename}
            required={doc.required}
            note={doc.note}
            value={v[doc.key]}
            onChange={(val) => bind(doc.key)(val)}
            error={e[doc.key]}
          />
        ))}
      </div>

      <Field group
        label="Apakah kamu terdaftar dalam DTKS?"
        required
        hint="DTKS = Data Terpadu Kesejahteraan Sosial. Jika Ya, wajib unggah SKTM DTKS di kolom di bawah."
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

      {v.dtksRegistered === "ya" && (
        <DocLinkField
          id="dtksUrl"
          label="Surat Keterangan Tidak Mampu (SKTM) terdaftar DTKS"
          filename="NamaLengkap_Cabang_DTKS"
          required
          note="SKTM tanpa keterangan DTKS tidak dianggap sah."
          value={v.dtksUrl}
          onChange={(val) => bind("dtksUrl")(val)}
          error={e.dtksUrl}
        />
      )}
    </div>
  );
}

function DocsLink({
  hash,
  children,
}: {
  hash: string;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={`/gabung-siswa/docs#${hash}`}
      target="_blank"
      className="underline font-semibold text-primary-blue hover:text-primary-blue-dark"
    >
      {children}
    </Link>
  );
}

function DocLinkField({
  id,
  label,
  filename,
  required,
  note,
  value,
  onChange,
  error,
}: {
  id: string;
  label: string;
  filename: string;
  required: boolean;
  note?: React.ReactNode;
  value: string;
  onChange: (val: string) => void;
  error?: string;
}) {
  return (
    <Field
      label={label}
      id={id}
      required={required}
      hint={
        <div className="space-y-1">
          <div>
            Format nama file:{" "}
            <span className="font-mono text-xs bg-gray-100 rounded px-1.5 py-0.5 text-gray-700">
              {filename}
            </span>
          </div>
          {note && <div className="text-gray-500">{note}</div>}
        </div>
      }
      error={error}
    >
      <Input
        id={id}
        type="url"
        value={value}
        onChange={(ev) => onChange(ev.target.value)}
        placeholder="https://drive.google.com/…"
        data-error={!!error}
      />
    </Field>
  );
}
