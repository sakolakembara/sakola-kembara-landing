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

type MarketingUrlKey =
  | "instagramFollowProofUrl"
  | "broadcastProofUrl"
  | "twibbonUploadUrl"
  | "storyUploadUrl";

type ProofSpec = {
  key: MarketingUrlKey;
  label: string;
  note: React.ReactNode;
};

const PROOFS: ProofSpec[] = [
  {
    key: "instagramFollowProofUrl",
    label: "Bukti Follow Instagram @sakolakembara",
    note: (
      <>
        Screenshot bukti follow akun{" "}
        <a
          href="https://instagram.com/sakolakembara"
          target="_blank"
          rel="noopener noreferrer"
          className="underline font-semibold text-primary-blue hover:text-primary-blue-dark"
        >
          @sakolakembara
        </a>
        , unggah ke Drive-mu, lalu tempel link-nya di sini.
      </>
    ),
  },
  {
    key: "broadcastProofUrl",
    label: "Bukti Share Poster + Broadcast ke 3 Grup WhatsApp",
    note: (
      <>
        Jadikan 1 file kalau lebih dari satu screenshot. Poster + template
        broadcast bisa diambil dari{" "}
        <Link
          href="/gabung-siswa/docs#berkas-marketing"
          target="_blank"
          className="underline font-semibold text-primary-blue hover:text-primary-blue-dark"
        >
          Pusat Dokumen
        </Link>
        .
      </>
    ),
  },
  {
    key: "twibbonUploadUrl",
    label: "Bukti Upload Twibbon di Feed Instagram",
    note: (
      <>
        Wajib tag <b>@sakolakembara</b>. Twibbon + caption bisa diambil dari{" "}
        <Link
          href="/gabung-siswa/docs#berkas-marketing"
          target="_blank"
          className="underline font-semibold text-primary-blue hover:text-primary-blue-dark"
        >
          Pusat Dokumen
        </Link>
        .
      </>
    ),
  },
  {
    key: "storyUploadUrl",
    label: "Bukti Share Poster di Story Instagram",
    note: (
      <>
        Wajib tag <b>@sakolakembara</b>. Poster story bisa diambil dari{" "}
        <Link
          href="/gabung-siswa/docs#berkas-marketing"
          target="_blank"
          className="underline font-semibold text-primary-blue hover:text-primary-blue-dark"
        >
          Pusat Dokumen
        </Link>
        .
      </>
    ),
  },
];

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

      <div className="space-y-5">
        {PROOFS.map((proof) => (
          <Field
            key={proof.key}
            label={proof.label}
            htmlFor={proof.key}
            required
            hint={proof.note}
            error={e[proof.key]}
          >
            <input
              id={proof.key}
              type="url"
              value={v[proof.key]}
              onChange={(ev) => bind(proof.key)(ev.target.value)}
              className={TEXT_INPUT}
              placeholder="https://drive.google.com/…"
              data-error={!!e[proof.key]}
            />
          </Field>
        ))}
      </div>
    </div>
  );
}
