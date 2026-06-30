import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
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

  return (
    <div className="max-w-4xl">
      <Link
        href="/admin/blog"
        className="inline-flex items-center gap-2 text-sm text-gray-500 hover:text-gray-900 mb-4"
      >
        <ArrowLeft size={14} /> Kembali ke daftar
      </Link>
      <header className="mb-6">
        <h1 className="font-[var(--font-display)] text-3xl text-gray-900 mb-1">
          Tulis Artikel Baru
        </h1>
        <p className="text-gray-600">
          Markdown disimpan ke <span className="font-mono">content/blog/</span>
          dan langsung tayang setelah disimpan.
        </p>
      </header>
      <EditorForm mode="create" defaultAuthor={defaultAuthor} />
    </div>
  );
}
