import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireSuperAdmin } from "@/lib/auth-helpers";
import { getUserById } from "@/lib/users";
import { EditorForm } from "../../_editor-form";

export const metadata: Metadata = {
  title: "Edit Admin",
};

interface PageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ created?: string }>;
}

export default async function EditAdminPage({
  params,
  searchParams,
}: PageProps) {
  const { id } = await params;
  const { created } = await searchParams;

  await requireSuperAdmin();

  const user = await getUserById(id);
  if (!user) notFound();

  return (
    <EditorForm
      mode="edit"
      user={user}
      successMessage={created ? "Admin berhasil dibuat." : undefined}
    />
  );
}
