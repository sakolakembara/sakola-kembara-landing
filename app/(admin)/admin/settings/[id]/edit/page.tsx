import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { ALLOWED_DOMAIN, auth } from "@/auth";
import { db } from "@/lib/db";
import { adminUsers } from "@/lib/db/schema";
import { getAdminUserById } from "@/lib/admin-users";
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

  const session = await auth();
  const email = session?.user?.email?.toLowerCase();
  if (!email || !email.endsWith(`@${ALLOWED_DOMAIN}`)) redirect("/login");
  const actor = await db.query.adminUsers.findFirst({
    where: eq(adminUsers.email, email),
    columns: { role: true },
  });
  if (actor?.role !== "super_admin") {
    redirect(
      "/admin/settings?error=Hanya+super+admin+yang+dapat+mengubah+admin",
    );
  }

  const user = await getAdminUserById(id);
  if (!user) notFound();

  return (
    <EditorForm
      mode="edit"
      user={user}
      successMessage={created ? "Admin berhasil dibuat." : undefined}
    />
  );
}
