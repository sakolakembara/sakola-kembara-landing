import { and, asc, eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import type { BatchItem } from "drizzle-orm/batch";
import { Hono } from "hono";
import { z } from "zod";
import { requireArea } from "../auth/guard";
import { grantableAreas, type GrantableArea } from "../auth/permissions";
import { adminRoles } from "../auth/roles";
import type { AppEnv } from "../context";
import { auditStatement } from "../db/audit";
import * as schema from "../db/schema";
import { readJson } from "./json";

// Just enough of Pengaturan to grant and revoke an editor's areas, which is
// what the permission model needs to be testable and usable (SAKEM-081). The
// rest of user management (create, change role, delete, invite) is a later
// ticket. Everything here is the `sistem` area: super_admin only.

export const adminUserRoutes = new Hono<AppEnv>();

const areasInput = z.object({
  areas: z.array(z.enum(grantableAreas)).max(grantableAreas.length),
});

/** Admin accounts (viewer, editor, super_admin) with the areas granted to each. */
adminUserRoutes.get("/", requireArea("sistem", "read"), async (c) => {
  const db = drizzle(c.env.DB, { schema });
  const rows = await db
    .select({
      id: schema.users.id,
      name: schema.users.name,
      email: schema.users.email,
      role: schema.users.role,
      area: schema.adminAreaGrants.area,
    })
    .from(schema.users)
    .leftJoin(schema.adminAreaGrants, eq(schema.adminAreaGrants.userId, schema.users.id))
    .where(inArray(schema.users.role, adminRoles))
    .orderBy(asc(schema.users.email));

  const byId = new Map<string, { id: string; name: string; email: string; role: string; areas: GrantableArea[] }>();
  for (const row of rows) {
    const entry = byId.get(row.id) ?? { id: row.id, name: row.name, email: row.email, role: row.role, areas: [] };
    // Grants only mean something for editors; another role's stray rows are not shown as rights.
    if (row.area && row.role === "editor") entry.areas.push(row.area);
    byId.set(row.id, entry);
  }
  for (const entry of byId.values()) entry.areas.sort((a, b) => grantableAreas.indexOf(a) - grantableAreas.indexOf(b));
  return c.json({ users: [...byId.values()] });
});

/**
 * Sets the complete list of areas an editor may change. Idempotent: it adds
 * what is missing, removes what is no longer listed, keeps who granted the
 * rest, and writes one audit row only when something changed (the change and
 * its audit row commit together). `sistem` cannot be granted. Only an editor
 * can hold grants: a viewer is read-only by definition and a super_admin
 * needs none.
 */
adminUserRoutes.put("/:id/areas", requireArea("sistem", "write"), async (c) => {
  const raw = await readJson(c);
  if (raw === undefined) return c.json({ error: "json_required" }, 415);
  const parsed = areasInput.safeParse(raw);
  if (!parsed.success) {
    return c.json({ error: "invalid", fieldErrors: z.flattenError(parsed.error).fieldErrors }, 400);
  }

  const actor = c.get("user");
  const db = drizzle(c.env.DB, { schema });
  const targetId = c.req.param("id");

  const target = await db.query.users.findFirst({
    where: eq(schema.users.id, targetId),
    columns: { id: true, role: true },
  });
  if (!target) return c.json({ error: "not_found" }, 404);
  if (target.role !== "editor") return c.json({ error: "not_editor" }, 409);

  const wanted = grantableAreas.filter((area) => parsed.data.areas.includes(area));
  const before = (
    await db.select({ area: schema.adminAreaGrants.area }).from(schema.adminAreaGrants).where(eq(schema.adminAreaGrants.userId, targetId))
  )
    .map((row) => row.area)
    .sort((a, b) => grantableAreas.indexOf(a) - grantableAreas.indexOf(b));

  const added = wanted.filter((area) => !before.includes(area));
  const removed = before.filter((area) => !wanted.includes(area));

  if (added.length > 0 || removed.length > 0) {
    const statements: BatchItem<"sqlite">[] = [];
    if (removed.length > 0) {
      statements.push(
        db.delete(schema.adminAreaGrants).where(and(eq(schema.adminAreaGrants.userId, targetId), inArray(schema.adminAreaGrants.area, removed))),
      );
    }
    if (added.length > 0) {
      statements.push(db.insert(schema.adminAreaGrants).values(added.map((area) => ({ userId: targetId, area, grantedBy: actor.id }))));
    }
    statements.push(
      auditStatement(db, actor, {
        action: "admin.update",
        resourceType: "admin_user",
        resourceId: targetId,
        metadata: { field: "areas", before, after: wanted },
      }),
    );
    await db.batch(statements as [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]]);
  }

  return c.json({ user: { id: target.id, role: target.role, areas: wanted } });
});
