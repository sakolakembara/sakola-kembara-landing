import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { announcements } from "@/lib/db/schema";
import { EditorForm } from "../../_editor-form";

export const metadata: Metadata = {
  title: "Edit Pengumuman",
};

interface PageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ created?: string }>;
}

export default async function EditAnnouncementPage({
  params,
  searchParams,
}: PageProps) {
  const { id } = await params;
  const { created } = await searchParams;
  const announcement = await db.query.announcements.findFirst({
    where: eq(announcements.id, id),
  });
  if (!announcement) notFound();

  return (
    <EditorForm
      mode="edit"
      announcement={announcement}
      successMessage={created ? "Pengumuman berhasil dibuat." : undefined}
    />
  );
}
