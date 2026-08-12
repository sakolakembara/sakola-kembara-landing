"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireSuperAdmin } from "@/lib/auth-helpers";
import { writeAudit } from "@/lib/audit";
import { adminRoles } from "@/lib/db/schema";
import {
  createAdmin,
  deleteAdmin,
  PASSWORD_MIN_LENGTH,
  updateAdmin,
} from "@/lib/admin-users-service";

const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(5, "Email terlalu pendek")
  .max(200, "Email terlalu panjang")
  .email("Format email tidak valid");

const passwordSchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH, `Password minimal ${PASSWORD_MIN_LENGTH} karakter`)
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

  const result = await createAdmin({
    email: parsed.data.email,
    name: parsed.data.name || null,
    role: parsed.data.role,
    password: parsed.data.password || null,
  });

  if (!result.ok) {
    return {
      status: "error",
      message: "Email ini sudah terdaftar.",
      fieldErrors: { email: ["Email sudah digunakan"] },
    };
  }

  await writeAudit({
    actorEmail: admin.email,
    actorId: admin.userId,
    action: "admin.create",
    resourceType: "admin_user",
    resourceId: result.id,
    metadata: { email: parsed.data.email, role: parsed.data.role },
  });

  invalidate();
  redirect(`/admin/settings/${result.id}/edit?created=1`);
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

  const result = await updateAdmin({
    id: parsed.data.id,
    name: parsed.data.name || null,
    role: parsed.data.role,
    password: parsed.data.password || null,
  });

  if (!result.ok) {
    if (result.reason === "not_found") {
      return { status: "error", message: "Admin tidak ditemukan." };
    }
    return {
      status: "error",
      message:
        "Tidak dapat menurunkan peran super admin terakhir. Tambah super admin lain terlebih dahulu.",
      fieldErrors: { role: ["Minimal satu super admin harus tersedia"] },
    };
  }

  await writeAudit({
    actorEmail: admin.email,
    actorId: admin.userId,
    action: "admin.update",
    resourceType: "admin_user",
    resourceId: parsed.data.id,
    metadata: {
      email: result.email,
      roleFrom: result.previousRole,
      roleTo: parsed.data.role,
      passwordChanged: result.passwordChanged,
    },
  });

  invalidate();
  return { status: "success", message: "Perubahan berhasil disimpan." };
}

export async function deleteAdminUser(formData: FormData): Promise<void> {
  const admin = await requireSuperAdmin();
  const id = String(formData.get("id"));

  const result = await deleteAdmin(id, admin.userId);
  if (!result.ok) {
    const message =
      result.reason === "not_found"
        ? "Admin+tidak+ditemukan"
        : result.reason === "self"
          ? "Tidak+dapat+menghapus+akun+sendiri"
          : "Tidak+dapat+menghapus+super+admin+terakhir";
    redirect(`/admin/settings?error=${message}`);
  }

  await writeAudit({
    actorEmail: admin.email,
    actorId: admin.userId,
    action: "admin.delete",
    resourceType: "admin_user",
    resourceId: id,
    metadata: { email: result.email, role: result.role },
  });

  invalidate();
  redirect("/admin/settings?deleted=1");
}
