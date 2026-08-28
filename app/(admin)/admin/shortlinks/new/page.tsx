import type { Metadata } from "next";
import { requireAdmin } from "@/lib/auth-helpers";
import { EditorForm } from "../_editor-form";

export const metadata: Metadata = {
  title: "Shortlink Baru",
};

export default async function NewShortlinkPage() {
  await requireAdmin();
  return <EditorForm mode="create" />;
}
