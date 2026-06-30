"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { ALLOWED_DOMAIN, auth } from "@/auth";
import { writeAudit } from "@/lib/audit";
import { countSuperAdmins } from "@/lib/admin-users";
import { db } from "@/lib/db";
import { adminUsers, adminUserRole } from "@/lib/db/schema";

const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(5, "Email terlalu pendek")
  .max(200, "Email terlalu panjang")
  .email("Format email tidak valid")
  .refine((v) => v.endsWith(`@${ALLOWED_DOMAIN}`), {
    message: `Email harus berakhiran @${ALLOWED_DOMAIN}`,
  });

const baseSchema = z.object({
  displayName: z
    .string()
    .trim()
    .max(120, "Maksimal 120 karakter")
    .optional()
    .or(z.literal("")),
  role: z.enum(adminUserRole),
});

const createSchema = baseSchema.extend({ email: emailSchema });
const updateSchema = baseSchema.extend({ id: z.string().uuid() });

export type AdminFormState = {
  status: "idle" | "success" | "error";
  message?: string;
  fieldErrors?: Partial<Record<string, string[]>>;
};

async function requireAdmin(): Promise<{
  email: string;
  actorId: string | null;
  role: (typeof adminUserRole)[number] | null;
}> {
  const session = await auth();
  const email = session?.user?.email?.toLowerCase();
  if (!email || !email.endsWith(`@${ALLOWED_DOMAIN}`)) {
    redirect("/login");
  }
  const actor = await db.query.adminUsers.findFirst({
    where: eq(adminUsers.email, email),
    columns: { id: true, role: true },
  });
  return { email, actorId: actor?.id ?? null, role: actor?.role ?? null };
}

async function requireSuperAdmin() {
  const admin = await requireAdmin();
  if (admin.role !== "super_admin") {
    redirect("/admin/settings?error=Hanya+super+admin+yang+dapat+mengubah+pengaturan");
  }
  return admin;
}

function invalidate() {
  revalidatePath("/admin/settings");
}

export async function createAdminUser(
  _prev: AdminFormState,
  formData: FormData,
): Promise<AdminFormState> {
  const admin = await requireSuperAdmin();
  const parsed = createSchema.safeParse({
    email: formData.get("email"),
    displayName: formData.get("displayName"),
    role: formData.get("role"),
  });
  if (!parsed.success) {
    return {
      status: "error",
      message: "Periksa kembali isian formulir.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }
  const data = parsed.data;

  const duplicate = await db.query.adminUsers.findFirst({
    where: eq(adminUsers.email, data.email),
    columns: { id: true },
  });
  if (duplicate) {
    return {
      status: "error",
      message: "Email ini sudah terdaftar sebagai admin.",
      fieldErrors: { email: ["Email sudah digunakan"] },
    };
  }

  const [inserted] = await db
    .insert(adminUsers)
    .values({
      email: data.email,
      displayName: data.displayName || null,
      role: data.role,
    })
    .returning({ id: adminUsers.id });

  await writeAudit({
    actorEmail: admin.email,
    actorId: admin.actorId,
    action: "admin.create",
    resourceType: "admin_user",
    resourceId: inserted.id,
    metadata: { email: data.email, role: data.role },
  });

  invalidate();
  redirect(`/admin/settings/${inserted.id}/edit?created=1`);
}

export async function updateAdminUser(
  _prev: AdminFormState,
  formData: FormData,
): Promise<AdminFormState> {
  const admin = await requireSuperAdmin();
  const parsed = updateSchema.safeParse({
    id: formData.get("id"),
    displayName: formData.get("displayName"),
    role: formData.get("role"),
  });
  if (!parsed.success) {
    return {
      status: "error",
      message: "Periksa kembali isian formulir.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }
  const data = parsed.data;

  const target = await db.query.adminUsers.findFirst({
    where: eq(adminUsers.id, data.id),
    columns: { id: true, email: true, role: true },
  });
  if (!target) {
    return { status: "error", message: "Admin tidak ditemukan." };
  }

  // Block demoting the last super_admin — would lock everyone out of /admin/settings.
  if (target.role === "super_admin" && data.role !== "super_admin") {
    const remaining = await countSuperAdmins(target.id);
    if (remaining === 0) {
      return {
        status: "error",
        message:
          "Tidak dapat menurunkan peran super admin terakhir. Tambah super admin lain terlebih dahulu.",
        fieldErrors: { role: ["Minimal satu super admin harus tersedia"] },
      };
    }
  }

  await db
    .update(adminUsers)
    .set({
      displayName: data.displayName || null,
      role: data.role,
      updatedAt: new Date(),
    })
    .where(eq(adminUsers.id, data.id));

  await writeAudit({
    actorEmail: admin.email,
    actorId: admin.actorId,
    action: "admin.update",
    resourceType: "admin_user",
    resourceId: data.id,
    metadata: {
      email: target.email,
      roleFrom: target.role,
      roleTo: data.role,
    },
  });

  invalidate();
  return { status: "success", message: "Perubahan berhasil disimpan." };
}

export async function deleteAdminUser(formData: FormData): Promise<void> {
  const admin = await requireSuperAdmin();
  const id = String(formData.get("id"));

  const target = await db.query.adminUsers.findFirst({
    where: eq(adminUsers.id, id),
    columns: { id: true, email: true, role: true },
  });
  if (!target) redirect("/admin/settings?error=Admin+tidak+ditemukan");

  if (target.id === admin.actorId) {
    redirect("/admin/settings?error=Tidak+dapat+menghapus+akun+sendiri");
  }

  if (target.role === "super_admin") {
    const remaining = await countSuperAdmins(target.id);
    if (remaining === 0) {
      redirect(
        "/admin/settings?error=Tidak+dapat+menghapus+super+admin+terakhir",
      );
    }
  }

  await db.delete(adminUsers).where(eq(adminUsers.id, id));

  await writeAudit({
    actorEmail: admin.email,
    actorId: admin.actorId,
    action: "admin.delete",
    resourceType: "admin_user",
    resourceId: id,
    metadata: { email: target.email, role: target.role },
  });

  invalidate();
  redirect("/admin/settings?deleted=1");
}
