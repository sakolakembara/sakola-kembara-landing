import type { Metadata } from "next";
import { EditorForm } from "../_editor-form";

export const metadata: Metadata = {
  title: "Upload Laporan",
};

export default function NewReportPage() {
  return <EditorForm mode="create" />;
}
