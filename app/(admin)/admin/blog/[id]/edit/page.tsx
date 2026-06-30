import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { auth } from "@/auth";
import { getBlogArticleBySlug } from "@/lib/blog";
import { EditorForm } from "../../_editor-form";

export const metadata: Metadata = {
  title: "Edit Artikel",
};

interface PageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ created?: string }>;
}

export default async function EditBlogPage({ params, searchParams }: PageProps) {
  const { id } = await params;
  const { created } = await searchParams;
  const article = await getBlogArticleBySlug(id);
  if (!article) notFound();

  const session = await auth();
  const defaultAuthor =
    session?.user?.email?.split("@")[0]?.replace(/[.\-_]/g, " ") ??
    "Sakola Kembara";

  return (
    <div className="max-w-6xl">
      <Link
        href="/admin/blog"
        className="inline-flex items-center gap-2 text-sm text-gray-500 hover:text-gray-900 mb-4"
      >
        <ArrowLeft size={14} /> Kembali ke daftar
      </Link>
      <header className="mb-6">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">
          Edit artikel
        </p>
        <h1 className="font-[var(--font-display)] text-3xl text-gray-900">
          {article.title}
        </h1>
      </header>
      <EditorForm
        mode="edit"
        article={article}
        defaultAuthor={defaultAuthor}
        successMessage={created ? "Artikel berhasil dibuat." : undefined}
      />
    </div>
  );
}
