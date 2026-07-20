import type { Metadata } from "next";
import { EditorForm } from "../_editor-form";

export const metadata: Metadata = {
  title: "Anggota Baru",
};

export default function NewTeamMemberPage() {
  return <EditorForm mode="create" />;
}
