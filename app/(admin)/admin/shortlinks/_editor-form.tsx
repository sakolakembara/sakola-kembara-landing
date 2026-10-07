"use client";

import { useActionState, useState } from "react";

import { SITE_URL } from "@/lib/seo";
import type { Shortlink } from "@/lib/db/schema";
import {
  createShortlink,
  updateShortlink,
  type ShortlinkFormState,
} from "./actions";
import { Field, Input } from "@/components/ui/field";
import { EditorHeader, EditorMessages, FormSection, SaveButton } from "../_editor";

const initialState: ShortlinkFormState = { status: "idle" };

const DISPLAY_HOST = SITE_URL.replace(/^https?:\/\//, "");

interface EditorFormProps {
  mode: "create" | "edit";
  shortlink?: Shortlink;
  successMessage?: string;
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

      <EditorHeader
        backHref="/admin/shortlinks"
        label={mode === "create" ? "Shortlink Baru" : "Edit Shortlink"}
      >
        <SaveButton
          label={mode === "create" ? "Buat Shortlink" : "Simpan Perubahan"}
        />
      </EditorHeader>

      <div className="max-w-3xl px-6 md:px-10 pt-6 pb-12">
        <EditorMessages state={state} successMessage={successMessage} />

        <div className="bg-white rounded-2xl border border-gray-100 p-6 md:p-8 space-y-6">
          <FormSection
            title="Alamat pendek"
            description="Bagian setelah nama domain. Inilah yang dibagikan ke publik."
          >
            <Field label="Slug" id="slug" required error={state.fieldErrors?.slug?.[0]}>
              {/* The host is shown as a non-editable prefix so it is obvious
                  the field holds only the path segment. */}
              <div className="flex items-stretch rounded-xl border-2 border-gray-200 focus-within:border-primary-blue overflow-hidden">
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
                  className="flex-1 min-w-0 px-3 py-3 focus:outline-none"
                />
              </div>
            </Field>
            <p className="text-xs text-gray-500 -mt-2">
              Huruf kecil, angka, dan tanda hubung. Akan terbuka di{" "}
              <span className="font-mono text-gray-700 break-all">
                {SITE_URL}/{previewSlug}
              </span>
            </p>
          </FormSection>

          <FormSection
            title="Tujuan"
            description="Ke mana pengunjung diarahkan saat membuka alamat di atas."
          >
            <Field
              label="URL tujuan"
              id="targetUrl"
              required
              error={state.fieldErrors?.targetUrl?.[0]}
              hint="URL lengkap (https://...) atau jalur di situs ini (/gabung-siswa)."
            >
              <Input
                type="text"
                id="targetUrl"
                name="targetUrl"
                required
                defaultValue={shortlink?.targetUrl ?? ""}
                placeholder="https://forms.gle/..."
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
              />
            </Field>
            <Field
              label="Catatan"
              id="note"
              error={state.fieldErrors?.note?.[0]}
              hint="Hanya terlihat di admin. Contoh: dipakai di bio Instagram."
            >
              <Input
                type="text"
                id="note"
                name="note"
                defaultValue={shortlink?.note ?? ""}
                placeholder="Dibagikan lewat broadcast WhatsApp angkatan 2026"
              />
            </Field>
          </FormSection>

          <FormSection title="Status">
            <label className="flex items-center gap-3 px-4 py-2.5 bg-white border-2 border-gray-200 rounded-xl cursor-pointer hover:border-gray-300 transition-colors">
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
          </FormSection>
        </div>
      </div>
    </form>
  );
}

