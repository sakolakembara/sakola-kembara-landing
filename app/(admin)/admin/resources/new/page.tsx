import type { Metadata } from "next";
import { EditorForm } from "../_editor-form";

export const metadata: Metadata = {
  title: "Berkas Baru",
};

export default function NewResourcePage() {
  return <EditorForm mode="create" />;
}
