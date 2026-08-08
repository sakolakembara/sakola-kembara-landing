import type { Metadata } from "next";
import { requireAdmin } from "@/lib/auth-helpers";
import { BatchEditorForm } from "../_editor-form";

export const metadata: Metadata = {
  title: "Batch Baru",
};

export default async function NewBatchPage() {
  await requireAdmin();
  return <BatchEditorForm mode="create" />;
}
