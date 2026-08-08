import type { Metadata } from "next";
import { requireSuperAdmin } from "@/lib/auth-helpers";
import { EditorForm } from "../_editor-form";

export const metadata: Metadata = {
  title: "Admin Baru",
};

export default async function NewAdminPage() {
  // Defense-in-depth: actions also re-check, but block the UI early so
  // non-super admins never see the form.
  await requireSuperAdmin();
  return <EditorForm mode="create" />;
}
