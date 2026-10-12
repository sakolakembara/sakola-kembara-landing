import { desc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { Hono } from "hono";
import { z } from "zod";
import { requireArea } from "../auth/guard";
import type { AppEnv } from "../context";
import { auditStatement } from "../db/audit";
import * as schema from "../db/schema";
import { announcementSeverity } from "../db/schema";
import { readJson } from "./json";

// Port of app/(admin)/admin/announcements/actions.ts. Same fields and the same
// validation messages; the legacy form posts "on" for the checkbox and strings
// for dates, this JSON API takes a boolean and ISO or datetime-local strings.

const optionalDate = z
  .string()
  .nullish()
  .transform((value) => (value ? new Date(value) : null))
  .refine((value) => value === null || !Number.isNaN(value.getTime()), {
    message: "Format tanggal tidak valid",
  });

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((value) => value || null);

const announcementInput = z
  .object({
    title: z.string().trim().min(3, "Judul minimal 3 karakter").max(200),
    body: z.string().trim().min(5, "Isi minimal 5 karakter").max(500),
    severity: z.enum(announcementSeverity),
    ctaLabel: optionalText(60),
    ctaUrl: optionalText(500),
    active: z.boolean().default(false),
    startsAt: optionalDate,
    endsAt: optionalDate,
  })
  .refine((v) => (v.ctaLabel === null) === (v.ctaUrl === null), {
    message: "Label dan URL CTA harus diisi keduanya",
    path: ["ctaLabel"],
  })
  .refine((v) => !v.startsAt || !v.endsAt || v.endsAt.getTime() >= v.startsAt.getTime(), {
    message: "Tanggal selesai harus setelah tanggal mulai",
    path: ["endsAt"],
  });

export const announcementRoutes = new Hono<AppEnv>();

// Announcements belong to the `komunikasi` area (docs/cloudflare/admin-ia.md).
// Reading needs any admin role except students; writing needs super_admin or
// an editor who was granted `komunikasi`. Viewers never write.
announcementRoutes.get("/", requireArea("komunikasi", "read"), async (c) => {
  const db = drizzle(c.env.DB, { schema });
  const rows = await db.select().from(schema.announcements).orderBy(desc(schema.announcements.createdAt));
  return c.json({ announcements: rows });
});

announcementRoutes.post("/", requireArea("komunikasi", "write"), async (c) => {
  const raw = await readJson(c);
  if (raw === undefined) return c.json({ error: "json_required" }, 415);
  const parsed = announcementInput.safeParse(raw);
  if (!parsed.success) {
    return c.json({ error: "invalid", fieldErrors: z.flattenError(parsed.error).fieldErrors }, 400);
  }
  const user = c.get("user");
  const db = drizzle(c.env.DB, { schema });
  const id = crypto.randomUUID();
  const data = parsed.data;

  const [inserted] = await db.batch([
    db.insert(schema.announcements).values({ id, ...data, createdBy: user.id }).returning(),
    auditStatement(db, user, {
      action: "announcement.create",
      resourceType: "announcement",
      resourceId: id,
      metadata: { title: data.title, severity: data.severity, active: data.active },
    }),
  ]);
  return c.json({ announcement: inserted[0] }, 201);
});

announcementRoutes.put("/:id", requireArea("komunikasi", "write"), async (c) => {
  const raw = await readJson(c);
  if (raw === undefined) return c.json({ error: "json_required" }, 415);
  const parsed = announcementInput.safeParse(raw);
  if (!parsed.success) {
    return c.json({ error: "invalid", fieldErrors: z.flattenError(parsed.error).fieldErrors }, 400);
  }
  const user = c.get("user");
  const db = drizzle(c.env.DB, { schema });
  const id = c.req.param("id");
  const data = parsed.data;

  const existing = await db.query.announcements.findFirst({
    where: eq(schema.announcements.id, id),
    columns: { id: true },
  });
  if (!existing) return c.json({ error: "not_found" }, 404);

  const [updated] = await db.batch([
    db
      .update(schema.announcements)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(schema.announcements.id, id))
      .returning(),
    auditStatement(db, user, {
      action: "announcement.update",
      resourceType: "announcement",
      resourceId: id,
      metadata: { title: data.title, severity: data.severity, active: data.active },
    }),
  ]);
  return c.json({ announcement: updated[0] });
});

announcementRoutes.delete("/:id", requireArea("komunikasi", "write"), async (c) => {
  const user = c.get("user");
  const db = drizzle(c.env.DB, { schema });
  const id = c.req.param("id");

  const existing = await db.query.announcements.findFirst({
    where: eq(schema.announcements.id, id),
    columns: { id: true, title: true },
  });
  if (!existing) return c.json({ error: "not_found" }, 404);

  await db.batch([
    db.delete(schema.announcements).where(eq(schema.announcements.id, id)),
    auditStatement(db, user, {
      action: "announcement.delete",
      resourceType: "announcement",
      resourceId: id,
      metadata: { title: existing.title },
    }),
  ]);
  return c.body(null, 204);
});
