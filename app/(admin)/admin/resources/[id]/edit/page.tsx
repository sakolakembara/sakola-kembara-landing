import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { siteResources } from "@/lib/db/schema";
import { EditorForm } from "../../_editor-form";

export const metadata: Metadata = {
  title: "Edit Berkas",
};

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function EditResourcePage({ params }: PageProps) {
  const { id } = await params;
  const resource = await db.query.siteResources.findFirst({
    where: eq(siteResources.id, id),
  });
  if (!resource) notFound();

  return <EditorForm mode="edit" resource={resource} />;
}
