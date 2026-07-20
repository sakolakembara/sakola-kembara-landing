import type { Metadata } from "next";
import { notFound } from "next/navigation";
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
    <EditorForm
      mode="edit"
      article={article}
      defaultAuthor={defaultAuthor}
      successMessage={created ? "Artikel berhasil dibuat." : undefined}
    />
  );
}
