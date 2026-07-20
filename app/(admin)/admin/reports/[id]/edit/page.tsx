import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { reports } from "@/lib/db/schema";
import { EditorForm } from "../../_editor-form";

export const metadata: Metadata = {
  title: "Edit Laporan",
};

interface PageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ created?: string }>;
}

export default async function EditReportPage({ params, searchParams }: PageProps) {
  const { id } = await params;
  const { created } = await searchParams;
  const report = await db.query.reports.findFirst({
    where: eq(reports.id, id),
  });
  if (!report) notFound();

  return (
    <EditorForm
      mode="edit"
      report={report}
      successMessage={created ? "Laporan berhasil diupload." : undefined}
    />
  );
}
