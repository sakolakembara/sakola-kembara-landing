"use server";

import { mkdir, unlink, writeFile } from "fs/promises";
import path from "path";
import { redirect } from "next/navigation";
import { revalidatePath, revalidateTag } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { ALLOWED_DOMAIN, auth } from "@/auth";
import { writeAudit } from "@/lib/audit";
import { db } from "@/lib/db";
import { adminUsers, teamMembers } from "@/lib/db/schema";

const MAX_IMAGE_BYTES = 5_000_000; // 5 MB
const ALLOWED_IMAGE_EXTS = new Set(["jpg", "jpeg", "png", "webp", "avif"]);

function slugify(input: string): string {
  return (
    input
      .toLowerCase()
      .trim()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9\s-]/g, "")
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 50) || "member"
  );
}

const baseSchema = z.object({
  name: z.string().trim().min(2, "Nama minimal 2 karakter").max(120),
  role: z.string().trim().min(2, "Peran minimal 2 karakter").max(120),
  university: z.string().trim().max(200).optional().or(z.literal("")),
  image: z.string().trim().max(500).optional().or(z.literal("")),
  displayOrder: z.coerce
    .number({ invalid_type_error: "Wajib diisi" })
    .int()
    .min(0, "Tidak boleh negatif")
    .max(9999, "Maksimal 9999"),
});

const updateSchema = baseSchema.extend({ id: z.string().uuid() });

export type TeamFormState = {
  status: "idle" | "success" | "error";
  message?: string;
  fieldErrors?: Partial<Record<string, string[]>>;
};

async function requireAdmin(): Promise<{ email: string; actorId: string | null }> {
  const session = await auth();
  const email = session?.user?.email?.toLowerCase();
  if (!email || !email.endsWith(`@${ALLOWED_DOMAIN}`)) {
    redirect("/login");
  }
  const actor = await db.query.adminUsers.findFirst({
    where: eq(adminUsers.email, email),
    columns: { id: true },
  });
  return { email, actorId: actor?.id ?? null };
}

function invalidate() {
  revalidateTag("team", "max");
  revalidatePath("/tim");
  revalidatePath("/admin/team");
}

export async function createTeamMember(
  _prev: TeamFormState,
  formData: FormData,
): Promise<TeamFormState> {
  const admin = await requireAdmin();
  const parsed = baseSchema.safeParse({
    name: formData.get("name"),
    role: formData.get("role"),
    university: formData.get("university"),
    image: formData.get("image"),
    displayOrder: formData.get("displayOrder"),
  });
  if (!parsed.success) {
    return {
      status: "error",
      message: "Periksa kembali isian formulir.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }
  const data = parsed.data;

  const [inserted] = await db
    .insert(teamMembers)
    .values({
      name: data.name,
      role: data.role,
      university: data.university || null,
      image: data.image || null,
      displayOrder: data.displayOrder,
    })
    .returning({ id: teamMembers.id });

  await writeAudit({
    actorEmail: admin.email,
    actorId: admin.actorId,
    action: "team.create",
    resourceType: "team_member",
    resourceId: inserted.id,
    metadata: { name: data.name, role: data.role },
  });

  invalidate();
  redirect(`/admin/team/${inserted.id}/edit?created=1`);
}

export async function updateTeamMember(
  _prev: TeamFormState,
  formData: FormData,
): Promise<TeamFormState> {
  const admin = await requireAdmin();
  const parsed = updateSchema.safeParse({
    id: formData.get("id"),
    name: formData.get("name"),
    role: formData.get("role"),
    university: formData.get("university"),
    image: formData.get("image"),
    displayOrder: formData.get("displayOrder"),
  });
  if (!parsed.success) {
    return {
      status: "error",
      message: "Periksa kembali isian formulir.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }
  const data = parsed.data;

  await db
    .update(teamMembers)
    .set({
      name: data.name,
      role: data.role,
      university: data.university || null,
      image: data.image || null,
      displayOrder: data.displayOrder,
      updatedAt: new Date(),
    })
    .where(eq(teamMembers.id, data.id));

  await writeAudit({
    actorEmail: admin.email,
    actorId: admin.actorId,
    action: "team.update",
    resourceType: "team_member",
    resourceId: data.id,
    metadata: { name: data.name, role: data.role },
  });

  invalidate();
  return { status: "success", message: "Anggota tim berhasil disimpan." };
}

export async function deleteTeamMember(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const id = String(formData.get("id"));
  const existing = await db.query.teamMembers.findFirst({
    where: eq(teamMembers.id, id),
    columns: { id: true, name: true, image: true },
  });
  if (!existing) redirect("/admin/team?error=not-found");

  await db.delete(teamMembers).where(eq(teamMembers.id, id));

  // Best-effort photo cleanup. Stale file is cheap to ignore.
  if (existing.image && existing.image.startsWith("/images/team/")) {
    try {
      await unlink(path.join(process.cwd(), "public", existing.image));
    } catch (err) {
      console.error("[team] failed to delete photo:", existing.image, err);
    }
  }

  await writeAudit({
    actorEmail: admin.email,
    actorId: admin.actorId,
    action: "team.delete",
    resourceType: "team_member",
    resourceId: id,
    metadata: { name: existing.name },
  });

  invalidate();
  redirect("/admin/team?deleted=1");
}

export type UploadResult =
  | { ok: true; path: string }
  | { ok: false; error: string };

/** Upload a team-member photo. Writes to public/images/team/<slug>-<rand>.<ext>. */
export async function uploadTeamPhoto(
  formData: FormData,
): Promise<UploadResult> {
  const admin = await requireAdmin();

  const file = formData.get("file");
  if (!(file instanceof File)) return { ok: false, error: "Tidak ada file." };
  if (file.size === 0) return { ok: false, error: "File kosong." };
  if (!file.type.startsWith("image/")) {
    return { ok: false, error: "Hanya gambar yang diperbolehkan." };
  }
  if (file.size > MAX_IMAGE_BYTES) {
    return { ok: false, error: "Ukuran maksimal 5 MB." };
  }

  const extMatch = file.name.match(/\.([a-z0-9]+)$/i);
  const ext = extMatch?.[1].toLowerCase() ?? "";
  if (!ALLOWED_IMAGE_EXTS.has(ext)) {
    return {
      ok: false,
      error: `Tipe file tidak didukung. Gunakan: ${[...ALLOWED_IMAGE_EXTS].join(", ")}.`,
    };
  }

  const baseName = slugify(file.name.replace(/\.[^.]+$/, ""));
  const stamp = Math.random().toString(36).slice(2, 8);
  const filename = `${baseName}-${stamp}.${ext}`;
  const relPath = `/images/team/${filename}`;
  const absPath = path.join(process.cwd(), "public", relPath);

  const buffer = Buffer.from(await file.arrayBuffer());
  await mkdir(path.dirname(absPath), { recursive: true });
  await writeFile(absPath, buffer);

  await writeAudit({
    actorEmail: admin.email,
    actorId: admin.actorId,
    action: "team.upload_photo",
    resourceType: "team_photo",
    resourceId: filename,
    metadata: { path: relPath, size: file.size, type: file.type },
  });

  return { ok: true, path: relPath };
}
