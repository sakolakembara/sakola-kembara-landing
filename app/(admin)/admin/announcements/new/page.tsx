import type { Metadata } from "next";
import { EditorForm } from "../_editor-form";

export const metadata: Metadata = {
  title: "Pengumuman Baru",
};

export default function NewAnnouncementPage() {
  return <EditorForm mode="create" />;
}
