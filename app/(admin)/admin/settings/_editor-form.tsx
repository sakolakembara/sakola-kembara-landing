"use client";

import { useActionState } from "react";

import type { User } from "@/lib/db/schema";
import { adminRoles } from "@/lib/db/schema";
import {
  createAdminUser,
  updateAdminUser,
  type AdminFormState,
} from "./actions";
import { Field, Input } from "@/components/ui/field";
import { EditorHeader, EditorMessages, FormSection, SaveButton } from "../_editor";

const initialState: AdminFormState = { status: "idle" };

const ROLE_HINTS: Record<(typeof adminRoles)[number], string> = {
  super_admin: "Akses penuh, termasuk mengelola admin lain.",
  editor: "Dapat mengelola konten (blog, pengumuman, laporan, tim, dll).",
  viewer: "Hanya dapat membaca dashboard.",
};

const ROLE_LABEL: Record<(typeof adminRoles)[number], string> = {
  super_admin: "Super Admin",
  editor: "Editor",
  viewer: "Viewer",
};

interface EditorFormProps {
  mode: "create" | "edit";
  user?: User;
  successMessage?: string;
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

      <EditorHeader
        backHref="/admin/settings"
        label={mode === "create" ? "Admin Baru" : "Edit Admin"}
      >
        <SaveButton
          label={mode === "create" ? "Buat Admin" : "Simpan Perubahan"}
        />
      </EditorHeader>

      <div className="max-w-4xl px-6 md:px-10 pt-6 pb-12">
        <EditorMessages state={state} successMessage={successMessage} />

        <div className="bg-white rounded-2xl border border-gray-100 p-6 md:p-8 space-y-6">
          <FormSection
            title="Identitas"
            description="Email yang dipakai untuk login admin. Bisa dipakai untuk login Google atau email + password."
          >
            <Field
              label="Email"
              id="email"
              required={mode === "create"}
              error={state.fieldErrors?.email?.[0]}
              hint={
                mode === "edit"
                  ? "Email tidak dapat diubah setelah admin dibuat."
                  : "Gunakan email yang aktif untuk login."
              }
            >
              <Input
                type="email"
                id="email"
                name="email"
                required={mode === "create"}
                readOnly={mode === "edit"}
                defaultValue={user?.email ?? ""}
                placeholder="nama@contoh.com"
                className={`${mode === "edit" ? "bg-gray-50 cursor-not-allowed" : ""}`}
              />
            </Field>
            <Field
              label="Nama"
              id="name"
              error={state.fieldErrors?.name?.[0]}
              hint="Opsional. Muncul sebagai pengirim di log aktivitas."
            >
              <Input
                type="text"
                id="name"
                name="name"
                defaultValue={user?.name ?? ""}
                placeholder="Contoh: Ahmad Fadillah"
              />
            </Field>
            <Field
              label="Password"
              id="password"
              error={state.fieldErrors?.password?.[0]}
              hint={
                mode === "edit"
                  ? "Kosongkan untuk tidak mengubah. Admin yang login lewat Google tidak perlu password."
                  : "Opsional, hanya jika admin ingin login email + password. Admin Google bisa dikosongkan."
              }
            >
              <Input
                type="password"
                id="password"
                name="password"
                autoComplete="new-password"
                placeholder={
                  mode === "edit"
                    ? "Kosongkan untuk tidak mengubah"
                    : "Password admin (opsional, hanya jika admin ingin login email + password)"
                }
              />
            </Field>
          </FormSection>

          <FormSection
            title="Peran"
            description="Menentukan apa saja yang bisa diakses oleh admin ini."
          >
            <Field group
              label="Peran"
              id="role"
              required
              error={state.fieldErrors?.role?.[0]}
            >
              <div className="space-y-2">
                {adminRoles.map((role) => (
                  <label
                    key={role}
                    className="flex items-start gap-3 p-3 border-2 border-gray-200 rounded-xl cursor-pointer hover:border-primary-blue transition-colors has-[:checked]:border-primary-blue has-[:checked]:bg-primary-blue/5"
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
          </FormSection>
        </div>
      </div>
    </form>
  );
}

