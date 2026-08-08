"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { requireSuperAdmin } from "@/lib/auth-helpers";
import { writeAudit } from "@/lib/audit";
import { countSuperAdmins } from "@/lib/users";
import { db } from "@/lib/db";
import { users, adminRoles } from "@/lib/db/schema";

const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(5, "Email terlalu pendek")
  .max(200, "Email terlalu panjang")
  .email("Format email tidak valid");

const passwordSchema = z
  .string()
  .min(8, "Password minimal 8 karakter")
  .optional()
  .or(z.literal(""));

const baseSchema = z.object({
  name: z
    .string()
    .trim()
    .max(120, "Maksimal 120 karakter")
    .optional()
    .or(z.literal("")),
  role: z.enum(adminRoles),
  password: passwordSchema,
});

const createSchema = baseSchema.extend({ email: emailSchema });
const updateSchema = baseSchema.extend({ id: z.string().uuid() });

export type AdminFormState = {
  status: "idle" | "success" | "error";
  message?: string;
  fieldErrors?: Partial<Record<string, string[]>>;
};

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
    name: formData.get("name"),
    role: formData.get("role"),
    password: formData.get("password"),
  });
  if (!parsed.success) {
    return {
      status: "error",
      message: "Periksa kembali isian formulir.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }
  const data = parsed.data;

  const duplicate = await db.query.users.findFirst({
    where: eq(users.email, data.email),
    columns: { id: true },
  });
  if (duplicate) {
    return {
      status: "error",
      message: "Email ini sudah terdaftar.",
      fieldErrors: { email: ["Email sudah digunakan"] },
    };
  }

  const passwordHash =
    data.password && data.password.length > 0
      ? await bcrypt.hash(data.password, 10)
      : null;

  const [inserted] = await db
    .insert(users)
    .values({
      email: data.email,
      name: data.name || null,
      role: data.role,
      passwordHash,
    })
    .returning({ id: users.id });

  await writeAudit({
    actorEmail: admin.email,
    actorId: admin.userId,
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
    name: formData.get("name"),
    role: formData.get("role"),
    password: formData.get("password"),
  });
  if (!parsed.success) {
    return {
      status: "error",
      message: "Periksa kembali isian formulir.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }
  const data = parsed.data;

  const target = await db.query.users.findFirst({
    where: eq(users.id, data.id),
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

  const updates: {
    name: string | null;
    role: (typeof adminRoles)[number];
    updatedAt: Date;
    passwordHash?: string;
  } = {
    name: data.name || null,
    role: data.role,
    updatedAt: new Date(),
  };
  if (data.password && data.password.length > 0) {
    updates.passwordHash = await bcrypt.hash(data.password, 10);
  }

  await db.update(users).set(updates).where(eq(users.id, data.id));

  await writeAudit({
    actorEmail: admin.email,
    actorId: admin.userId,
    action: "admin.update",
    resourceType: "admin_user",
    resourceId: data.id,
    metadata: {
      email: target.email,
      roleFrom: target.role,
      roleTo: data.role,
      passwordChanged: Boolean(data.password && data.password.length > 0),
    },
  });

  invalidate();
  return { status: "success", message: "Perubahan berhasil disimpan." };
}

export async function deleteAdminUser(formData: FormData): Promise<void> {
  const admin = await requireSuperAdmin();
  const id = String(formData.get("id"));

  const target = await db.query.users.findFirst({
    where: eq(users.id, id),
    columns: { id: true, email: true, role: true },
  });
  if (!target) redirect("/admin/settings?error=Admin+tidak+ditemukan");

  if (target!.id === admin.userId) {
    redirect("/admin/settings?error=Tidak+dapat+menghapus+akun+sendiri");
  }

  if (target!.role === "super_admin") {
    const remaining = await countSuperAdmins(target!.id);
    if (remaining === 0) {
      redirect(
        "/admin/settings?error=Tidak+dapat+menghapus+super+admin+terakhir",
      );
    }
  }

  await db.delete(users).where(eq(users.id, id));

  await writeAudit({
    actorEmail: admin.email,
    actorId: admin.userId,
    action: "admin.delete",
    resourceType: "admin_user",
    resourceId: id,
    metadata: { email: target!.email, role: target!.role },
  });

  invalidate();
  redirect("/admin/settings?deleted=1");
}
