import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { ALLOWED_DOMAIN, auth } from "@/auth";
import { db } from "@/lib/db";
import { adminUsers } from "@/lib/db/schema";
import { EditorForm } from "../_editor-form";

export const metadata: Metadata = {
  title: "Admin Baru",
};

export default async function NewAdminPage() {
  // Defense-in-depth: actions also re-check, but block the UI early so
  // non-super admins never see the form.
  const session = await auth();
  const email = session?.user?.email?.toLowerCase();
  if (!email || !email.endsWith(`@${ALLOWED_DOMAIN}`)) redirect("/login");
  const actor = await db.query.adminUsers.findFirst({
    where: eq(adminUsers.email, email),
    columns: { role: true },
  });
  if (actor?.role !== "super_admin") {
    redirect(
      "/admin/settings?error=Hanya+super+admin+yang+dapat+menambah+admin",
    );
  }

  return <EditorForm mode="create" />;
}
