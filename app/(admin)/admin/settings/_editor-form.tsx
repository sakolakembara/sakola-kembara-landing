"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import Link from "next/link";
import { ArrowLeft, Save } from "lucide-react";
import type { AdminUser } from "@/lib/db/schema";
import { adminUserRole } from "@/lib/db/schema";
import {
  createAdminUser,
  updateAdminUser,
  type AdminFormState,
} from "./actions";

const initialState: AdminFormState = { status: "idle" };

const TEXT_INPUT =
  "w-full px-4 py-2.5 border-2 border-gray-200 rounded-lg focus:border-primary-blue focus:outline-none";

const ROLE_HINTS: Record<(typeof adminUserRole)[number], string> = {
  super_admin: "Akses penuh, termasuk mengelola admin lain.",
  editor: "Dapat mengelola konten (blog, pengumuman, laporan, tim, dll).",
  viewer: "Hanya dapat membaca dashboard.",
};

const ROLE_LABEL: Record<(typeof adminUserRole)[number], string> = {
  super_admin: "Super Admin",
  editor: "Editor",
  viewer: "Viewer",
};

interface EditorFormProps {
  mode: "create" | "edit";
  user?: AdminUser;
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

export function EditorForm({
  mode,
  user,
  successMessage,
}: EditorFormProps) {
  const action = mode === "create" ? createAdminUser : updateAdminUser;
  const [state, formAction] = useActionState(action, initialState);

  return (
    <form action={formAction}>
      {user && <input type="hidden" name="id" value={user.id} />}

      <header className="sticky top-0 z-20 px-6 md:px-10 py-3 bg-white/95 backdrop-blur border-b border-gray-200">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3 flex-wrap min-w-0">
            <Link
              href="/admin/settings"
              className="inline-flex items-center gap-1 text-sm text-gray-600 hover:text-gray-900 transition-colors"
            >
              <ArrowLeft size={14} /> Kembali
            </Link>
            <span className="text-gray-300 select-none">·</span>
            <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap">
              {mode === "create" ? "Admin Baru" : "Edit Admin"}
            </span>
          </div>
          <SubmitButton
            label={mode === "create" ? "Buat Admin" : "Simpan Perubahan"}
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
            title="Identitas"
            description="Email Microsoft (Entra ID) yang dipakai untuk login admin."
          >
            <Field
              label="Email"
              name="email"
              required={mode === "create"}
              errors={state.fieldErrors?.email}
              hint={
                mode === "edit"
                  ? "Email tidak dapat diubah setelah admin dibuat."
                  : "Harus menggunakan domain @sakolakembara.org."
              }
            >
              <input
                type="email"
                id="email"
                name="email"
                required={mode === "create"}
                readOnly={mode === "edit"}
                defaultValue={user?.email ?? ""}
                placeholder="nama@sakolakembara.org"
                className={`${TEXT_INPUT} ${mode === "edit" ? "bg-gray-50 cursor-not-allowed" : ""}`}
              />
            </Field>
            <Field
              label="Nama Tampilan"
              name="displayName"
              errors={state.fieldErrors?.displayName}
              hint="Opsional. Muncul sebagai pengirim di log aktivitas."
            >
              <input
                type="text"
                id="displayName"
                name="displayName"
                defaultValue={user?.displayName ?? ""}
                placeholder="Contoh: Ahmad Fadillah"
                className={TEXT_INPUT}
              />
            </Field>
          </Section>

          <Section
            title="Peran"
            description="Menentukan apa saja yang bisa diakses oleh admin ini."
          >
            <Field
              label="Peran"
              name="role"
              required
              errors={state.fieldErrors?.role}
            >
              <div className="space-y-2">
                {adminUserRole.map((role) => (
                  <label
                    key={role}
                    className="flex items-start gap-3 p-3 border-2 border-gray-200 rounded-lg cursor-pointer hover:border-primary-blue transition-colors has-[:checked]:border-primary-blue has-[:checked]:bg-primary-blue/5"
                  >
                    <input
                      type="radio"
                      name="role"
                      value={role}
                      required
                      defaultChecked={
                        user ? user.role === role : role === "editor"
                      }
                      className="mt-1 accent-primary-blue"
                    />
                    <span className="flex-1 min-w-0">
                      <span className="block text-sm font-semibold text-gray-900">
                        {ROLE_LABEL[role]}
                      </span>
                      <span className="block text-xs text-gray-500 mt-0.5">
                        {ROLE_HINTS[role]}
                      </span>
                    </span>
                  </label>
                ))}
              </div>
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
