import type { Metadata } from "next";
import { auth } from "@/auth";
import { EditorForm } from "../_editor-form";

export const metadata: Metadata = {
  title: "Artikel Baru",
};

export default async function NewBlogPage() {
  const session = await auth();
  const defaultAuthor =
    session?.user?.email?.split("@")[0]?.replace(/[.\-_]/g, " ") ??
    "Sakola Kembara";

  return <EditorForm mode="create" defaultAuthor={defaultAuthor} />;
}
