import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/auth-helpers";
import { getShortlinkById } from "@/lib/shortlinks";
import { EditorForm } from "../../_editor-form";

export const metadata: Metadata = {
  title: "Edit Shortlink",
};

interface PageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ created?: string }>;
}

export default async function EditShortlinkPage({ params, searchParams }: PageProps) {
  await requireAdmin();
  const { id } = await params;
  const { created } = await searchParams;
  const shortlink = await getShortlinkById(id);
  if (!shortlink) notFound();

  return (
    <EditorForm
      mode="edit"
      shortlink={shortlink}
      successMessage={created ? "Shortlink berhasil dibuat." : undefined}
    />
  );
}
