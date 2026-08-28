"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import Link from "next/link";
import { ArrowLeft, Save } from "lucide-react";
import { SITE_URL } from "@/lib/seo";
import type { Shortlink } from "@/lib/db/schema";
import {
  createShortlink,
  updateShortlink,
  type ShortlinkFormState,
} from "./actions";

const initialState: ShortlinkFormState = { status: "idle" };

const TEXT_INPUT =
  "w-full px-4 py-2.5 border-2 border-gray-200 rounded-lg focus:border-primary-blue focus:outline-none";

const DISPLAY_HOST = SITE_URL.replace(/^https?:\/\//, "");

interface EditorFormProps {
  mode: "create" | "edit";
  shortlink?: Shortlink;
  successMessage?: string;
}

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

export function EditorForm({ mode, shortlink, successMessage }: EditorFormProps) {
  const action = mode === "create" ? createShortlink : updateShortlink;
  const [state, formAction] = useActionState(action, initialState);
  // Mirrored so the preview line updates as the admin types. Normalization
  // here is cosmetic only — the server re-validates on submit.
  const [slug, setSlug] = useState(shortlink?.slug ?? "");

  const previewSlug = slug.trim().toLowerCase() || "slug-anda";

  return (
    <form action={formAction}>
      {shortlink && <input type="hidden" name="id" value={shortlink.id} />}

      <header className="sticky top-0 z-20 px-6 md:px-10 py-3 bg-white/95 backdrop-blur border-b border-gray-200">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3 flex-wrap min-w-0">
            <Link
              href="/admin/shortlinks"
              className="inline-flex items-center gap-1 text-sm text-gray-600 hover:text-gray-900 transition-colors"
            >
              <ArrowLeft size={14} /> Kembali
            </Link>
            <span className="text-gray-300 select-none">·</span>
            <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap">
              {mode === "create" ? "Shortlink Baru" : "Edit Shortlink"}
            </span>
          </div>
          <SubmitButton
            label={mode === "create" ? "Buat Shortlink" : "Simpan Perubahan"}
          />
        </div>
      </header>

      <div className="max-w-3xl px-6 md:px-10 pt-6 pb-12">
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
        {successMessage && state.status === "idle" && (
          <div className="mb-5 bg-green-50 border border-green-200 rounded-lg px-4 py-3 text-sm text-green-700">
            {successMessage}
          </div>
        )}

        <div className="bg-white rounded-2xl border border-gray-100 p-6 md:p-8 space-y-6">
          <Section
            title="Alamat pendek"
            description="Bagian setelah nama domain. Inilah yang dibagikan ke publik."
          >
            <Field label="Slug" name="slug" required errors={state.fieldErrors?.slug}>
              {/* The host is shown as a non-editable prefix so it is obvious
                  the field holds only the path segment. */}
              <div className="flex items-stretch rounded-lg border-2 border-gray-200 focus-within:border-primary-blue overflow-hidden">
                <span className="flex items-center px-3 bg-gray-50 border-r-2 border-gray-200 text-sm text-gray-500 whitespace-nowrap select-none">
                  {DISPLAY_HOST}/
                </span>
                <input
                  type="text"
                  id="slug"
                  name="slug"
                  required
                  value={slug}
                  onChange={(e) => setSlug(e.target.value)}
                  placeholder="daftar-2026"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  className="flex-1 min-w-0 px-3 py-2.5 focus:outline-none"
                />
              </div>
            </Field>
            <p className="text-xs text-gray-500 -mt-2">
              Huruf kecil, angka, dan tanda hubung. Akan terbuka di{" "}
              <span className="font-mono text-gray-700 break-all">
                {SITE_URL}/{previewSlug}
              </span>
            </p>
          </Section>

          <Section
            title="Tujuan"
            description="Ke mana pengunjung diarahkan saat membuka alamat di atas."
          >
            <Field
              label="URL tujuan"
              name="targetUrl"
              required
              errors={state.fieldErrors?.targetUrl}
              hint="URL lengkap (https://...) atau jalur di situs ini (/gabung-siswa)."
            >
              <input
                type="text"
                id="targetUrl"
                name="targetUrl"
                required
                defaultValue={shortlink?.targetUrl ?? ""}
                placeholder="https://forms.gle/..."
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                className={TEXT_INPUT}
              />
            </Field>
            <Field
              label="Catatan"
              name="note"
              errors={state.fieldErrors?.note}
              hint="Hanya terlihat di admin. Contoh: dipakai di bio Instagram."
            >
              <input
                type="text"
                id="note"
                name="note"
                defaultValue={shortlink?.note ?? ""}
                placeholder="Dibagikan lewat broadcast WhatsApp angkatan 2026"
                className={TEXT_INPUT}
              />
            </Field>
          </Section>

          <Section title="Status">
            <label className="flex items-center gap-3 px-4 py-2.5 bg-white border-2 border-gray-200 rounded-lg cursor-pointer hover:border-gray-300 transition-colors">
              <input
                type="checkbox"
                name="active"
                defaultChecked={shortlink?.active ?? true}
                className="w-4 h-4 accent-primary-blue"
              />
              <span className="text-sm text-gray-700">
                <span className="font-medium text-gray-900">Aktifkan.</span>{" "}
                Saat dinonaktifkan, alamat pendek menampilkan halaman 404 —
                tapi slug tetap dipesan sehingga tidak bisa dipakai ulang.
              </span>
            </label>
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
        {description && <p className="text-xs text-gray-500 mt-1">{description}</p>}
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
      <label htmlFor={name} className="block text-sm font-medium text-gray-700 mb-2">
        {label}
        {required && <span className="text-red-500 ml-0.5">*</span>}
      </label>
      {children}
      {hint && !errors?.length && <p className="text-xs text-gray-500 mt-1">{hint}</p>}
      {errors?.[0] && <p className="text-xs text-red-600 mt-1">{errors[0]}</p>}
    </div>
  );
}
