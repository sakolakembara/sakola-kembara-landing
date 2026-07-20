import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { teamMembers } from "@/lib/db/schema";
import { EditorForm } from "../../_editor-form";

export const metadata: Metadata = {
  title: "Edit Anggota",
};

interface PageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ created?: string }>;
}

export default async function EditTeamMemberPage({ params, searchParams }: PageProps) {
  const { id } = await params;
  const { created } = await searchParams;
  const member = await db.query.teamMembers.findFirst({
    where: eq(teamMembers.id, id),
  });
  if (!member) notFound();

  return (
    <EditorForm
      mode="edit"
      member={member}
      successMessage={created ? "Anggota berhasil dibuat." : undefined}
    />
  );
}
