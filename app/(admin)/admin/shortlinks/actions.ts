"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { and, eq, ne } from "drizzle-orm";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth-helpers";
import { writeAudit } from "@/lib/audit";
import { db } from "@/lib/db";
import { shortlinks } from "@/lib/db/schema";
import { validateSlug, validateTarget } from "@/lib/shortlinks";

const baseSchema = z.object({
  slug: z.string().max(200),
  targetUrl: z.string().max(2000),
  note: z.string().trim().max(300).optional().or(z.literal("")),
  active: z
    .string()
    .optional()
    .transform((v) => v === "on" || v === "true"),
});

const updateSchema = baseSchema.and(z.object({ id: z.string().uuid() }));

export type ShortlinkFormState = {
  status: "idle" | "success" | "error";
  message?: string;
  fieldErrors?: Partial<Record<string, string[]>>;
};

function invalidate(slug?: string) {
  revalidatePath("/admin/shortlinks");
  // The redirect page reads the DB per request, but a previously-404'd slug
  // may sit in the router cache on the client that hit it.
  if (slug) revalidatePath(`/${slug}`);
}

function readForm(formData: FormData) {
  return {
    slug: formData.get("slug"),
    targetUrl: formData.get("targetUrl"),
    note: formData.get("note"),
    active: formData.get("active"),
  };
}

/**
 * Slug + target validation shared by create and update. Returns either the
 * normalized values or a form state carrying the field-level message.
 */
function checkSlugAndTarget(raw: { slug: string; targetUrl: string }):
  | { ok: true; slug: string; targetUrl: string }
  | { ok: false; state: ShortlinkFormState } {
  const slugCheck = validateSlug(raw.slug);
  if (!slugCheck.ok) {
    return {
      ok: false,
      state: {
        status: "error",
        message: "Periksa kembali isian formulir.",
        fieldErrors: { slug: [slugCheck.message] },
      },
    };
  }
  const targetCheck = validateTarget(raw.targetUrl, slugCheck.slug);
  if (!targetCheck.ok) {
    return {
      ok: false,
      state: {
        status: "error",
        message: "Periksa kembali isian formulir.",
        fieldErrors: { targetUrl: [targetCheck.message] },
      },
    };
  }
  return { ok: true, slug: slugCheck.slug, targetUrl: targetCheck.url };
}

const TAKEN: ShortlinkFormState = {
  status: "error",
  message: "Periksa kembali isian formulir.",
  fieldErrors: { slug: ["Slug ini sudah dipakai shortlink lain."] },
};

export async function createShortlink(
  _prev: ShortlinkFormState,
  formData: FormData,
): Promise<ShortlinkFormState> {
  const admin = await requireAdmin();
  const parsed = baseSchema.safeParse(readForm(formData));
  if (!parsed.success) {
    return {
      status: "error",
      message: "Periksa kembali isian formulir.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const checked = checkSlugAndTarget(parsed.data);
  if (!checked.ok) return checked.state;

  const existing = await db.query.shortlinks.findFirst({
    where: eq(shortlinks.slug, checked.slug),
    columns: { id: true },
  });
  if (existing) return TAKEN;

  let insertedId: string;
  try {
    const [row] = await db
      .insert(shortlinks)
      .values({
        slug: checked.slug,
        targetUrl: checked.targetUrl,
        note: parsed.data.note || null,
        active: parsed.data.active,
        createdBy: admin.userId,
      })
      .returning({ id: shortlinks.id });
    insertedId = row.id;
  } catch (err) {
    // The unique index is the real guard — two admins can pass the check
    // above concurrently and only one insert survives.
    if (isUniqueViolation(err)) return TAKEN;
    throw err;
  }

  await writeAudit({
    actorEmail: admin.email,
    actorId: admin.userId,
    action: "shortlink.create",
    resourceType: "shortlink",
    resourceId: insertedId,
    metadata: {
      slug: checked.slug,
      targetUrl: checked.targetUrl,
      active: parsed.data.active,
    },
  });

  invalidate(checked.slug);
  redirect(`/admin/shortlinks/${insertedId}/edit?created=1`);
}

export async function updateShortlink(
  _prev: ShortlinkFormState,
  formData: FormData,
): Promise<ShortlinkFormState> {
  const admin = await requireAdmin();
  const parsed = updateSchema.safeParse({
    ...readForm(formData),
    id: formData.get("id"),
  });
  if (!parsed.success) {
    return {
      status: "error",
      message: "Periksa kembali isian formulir.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const checked = checkSlugAndTarget(parsed.data);
  if (!checked.ok) return checked.state;

  const current = await db.query.shortlinks.findFirst({
    where: eq(shortlinks.id, parsed.data.id),
    columns: { slug: true },
  });
  if (!current) {
    return { status: "error", message: "Shortlink tidak ditemukan." };
  }

  const clash = await db.query.shortlinks.findFirst({
    where: and(eq(shortlinks.slug, checked.slug), ne(shortlinks.id, parsed.data.id)),
    columns: { id: true },
  });
  if (clash) return TAKEN;

  try {
    await db
      .update(shortlinks)
      .set({
        slug: checked.slug,
        targetUrl: checked.targetUrl,
        note: parsed.data.note || null,
        active: parsed.data.active,
        updatedAt: new Date(),
      })
      .where(eq(shortlinks.id, parsed.data.id));
  } catch (err) {
    if (isUniqueViolation(err)) return TAKEN;
    throw err;
  }

  await writeAudit({
    actorEmail: admin.email,
    actorId: admin.userId,
    action: "shortlink.update",
    resourceType: "shortlink",
    resourceId: parsed.data.id,
    metadata: {
      slug: checked.slug,
      targetUrl: checked.targetUrl,
      active: parsed.data.active,
      ...(current.slug !== checked.slug ? { previousSlug: current.slug } : {}),
    },
  });

  // Renaming frees the old path — revalidate both so neither stays cached.
  invalidate(checked.slug);
  if (current.slug !== checked.slug) invalidate(current.slug);

  return {
    status: "success",
    message:
      current.slug === checked.slug
        ? "Shortlink berhasil disimpan."
        : `Shortlink berhasil disimpan. Slug lama /${current.slug} tidak lagi aktif.`,
  };
}

export async function deleteShortlink(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const id = String(formData.get("id"));
  const existing = await db.query.shortlinks.findFirst({
    where: eq(shortlinks.id, id),
    columns: { id: true, slug: true, targetUrl: true },
  });
  if (!existing) {
    redirect("/admin/shortlinks?error=Shortlink+tidak+ditemukan");
  }
  await db.delete(shortlinks).where(eq(shortlinks.id, id));
  await writeAudit({
    actorEmail: admin.email,
    actorId: admin.userId,
    action: "shortlink.delete",
    resourceType: "shortlink",
    resourceId: id,
    metadata: { slug: existing.slug, targetUrl: existing.targetUrl },
  });
  invalidate(existing.slug);
  redirect("/admin/shortlinks?deleted=1");
}

/** Postgres unique-violation SQLSTATE. */
function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: unknown }).code === "23505"
  );
}
