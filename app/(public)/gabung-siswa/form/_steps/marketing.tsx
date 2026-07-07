"use client";

import Link from "next/link";
import { Instagram } from "lucide-react";
import type {
  FormValues,
  MarketingValues,
  StepId,
} from "@/lib/student-form-types";
import { Field, TEXT_INPUT, type FieldErrors } from "../_shared";
import { StepHeader } from "./identity";

type Props = {
  values: FormValues;
  updateStep: <K extends keyof FormValues>(step: K, patch: Partial<FormValues[K]>) => void;
  errors: Record<StepId, FieldErrors>;
  clearFieldError: (step: StepId, path: string) => void;
};

export function MarketingStep({
  values,
  updateStep,
  errors,
  clearFieldError,
}: Props) {
  const v = values.marketing;
  const e = errors.marketing;
  const bind =
    <K extends keyof MarketingValues>(key: K) =>
    (val: MarketingValues[K]) => {
      updateStep("marketing", { [key]: val } as Partial<MarketingValues>);
      clearFieldError("marketing", key as string);
    };

  return (
    <div className="space-y-6">
      <StepHeader
        title="Berkas Marketing"
        subtitle="Bantu kami menjangkau lebih banyak teman yang butuh bimbel gratis ini. Bagian ini juga jadi bentuk kontribusi kecil kamu untuk Sakola Kembara."
      />

      <Field
        label="Username Instagram (akun utama, tidak boleh diprivat)"
        htmlFor="instagramUsername"
        required
        hint="Tulis tanpa @ di depan. Kami akan verifikasi bukti follow, twibbon, dan story yang kamu upload di akun ini."
        error={e.instagramUsername}
      >
        <div className="relative">
          <Instagram
            size={16}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
            aria-hidden
          />
          <input
            id="instagramUsername"
            type="text"
            value={v.instagramUsername}
            onChange={(ev) => bind("instagramUsername")(ev.target.value)}
            className={`${TEXT_INPUT} pl-9`}
            placeholder="username_kamu"
            autoComplete="off"
            data-error={!!e.instagramUsername}
          />
        </div>
      </Field>

      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 text-sm text-blue-900 leading-relaxed">
        <p className="font-semibold mb-2">
          Kumpulkan bukti berikut di satu folder Google Drive:
        </p>
        <ul className="list-disc pl-4 space-y-1.5">
          <li>
            Screenshot bukti <b>follow</b> akun{" "}
            <a
              href="https://instagram.com/sakolakembara"
              target="_blank"
              rel="noopener noreferrer"
              className="underline font-semibold hover:text-blue-700"
            >
              @sakolakembara
            </a>
            .
          </li>
          <li>
            Screenshot bukti <b>share poster + broadcast</b> ke minimal 3 grup
            WhatsApp (jadikan 1 file kalau lebih dari satu foto).{" "}
            <Link
              href="/gabung-siswa/docs#berkas-marketing"
              target="_blank"
              className="underline font-semibold hover:text-blue-700"
            >
              Unduh poster di sini
            </Link>
            .
          </li>
          <li>
            Screenshot bukti <b>upload twibbon</b> di feed Instagram (wajib tag{" "}
            <b>@sakolakembara</b>).{" "}
            <Link
              href="/gabung-siswa/docs#berkas-marketing"
              target="_blank"
              className="underline font-semibold hover:text-blue-700"
            >
              Ambil twibbon di sini
            </Link>
            .
          </li>
          <li>
            Screenshot bukti <b>share poster di story</b> Instagram (wajib tag{" "}
            <b>@sakolakembara</b>).{" "}
            <Link
              href="/gabung-siswa/docs#berkas-marketing"
              target="_blank"
              className="underline font-semibold hover:text-blue-700"
            >
              Unduh poster story di sini
            </Link>
            .
          </li>
          <li>
            Caption Instagram dan template broadcast bisa disalin dari{" "}
            <Link
              href="/gabung-siswa/docs#berkas-marketing"
              target="_blank"
              className="underline font-semibold hover:text-blue-700"
            >
              Pusat Dokumen
            </Link>
            .
          </li>
        </ul>
      </div>

      <Field
        label="Link Folder Google Drive Berkas Marketing"
        htmlFor="marketingFolderUrl"
        required
        hint="Folder terpisah dari folder berkas pendaftaran. Pastikan akses 'Siapa saja yang memiliki link'."
        error={e.folderUrl}
      >
        <input
          id="marketingFolderUrl"
          type="url"
          value={v.folderUrl}
          onChange={(ev) => bind("folderUrl")(ev.target.value)}
          className={TEXT_INPUT}
          placeholder="https://drive.google.com/drive/folders/…"
          data-error={!!e.folderUrl}
        />
      </Field>
    </div>
  );
}
