import { createEmailVerificationToken } from "better-auth/api";
import { and, asc, eq, inArray, ne, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import type { BatchItem } from "drizzle-orm/batch";
import { Hono } from "hono";
import type { Context } from "hono";
import { z } from "zod";
import { hashPassword } from "../auth/password";
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from "../auth/factory";
import { requireArea } from "../auth/guard";
import { grantableAreas, type GrantableArea } from "../auth/permissions";
import { adminRoles, type AdminRole } from "../auth/roles";
import type { AppEnv } from "../context";
import { auditStatement } from "../db/audit";
import * as schema from "../db/schema";
import { emailAvailable, sendEmail, type SendResult } from "../email/send";
import { adminInviteEmail, verificationEmail, ADMIN_INVITE_SECONDS } from "../email/templates";
import { emailKey } from "../security/client";
import { checkLimits, limitedResponse } from "../security/rate-limit";
import { readJson } from "./json";

// Pengaturan: who the admins are and what each may do (SAKEM-081). Everything
// here is the `sistem` area: super_admin only. The legacy page
// (app/(admin)/admin/settings) created, edited and DELETED admins with a
// password the super_admin typed. Differences, all deliberate:
//
//   - an admin is invited by email (a link to choose their own password, 7 days,
//     single use); a super_admin can still set a first password
//   - nobody is deleted: an account is deactivated (sessions revoked, cannot
//     sign in by any method) so the audit trail keeps pointing at a real row,
//     and it can be reactivated
//   - the last active super_admin can be neither demoted nor deactivated, and a
//     database trigger (migration 0006) holds that line even if two of them
//     try it at once
//   - nobody can deactivate themselves
//   - students are not touched here: an address that already has an account of
//     any role answers 409 email_taken
//
// Every mutation writes its audit row in the same db.batch as the change.

export const adminUserRoutes = new Hono<AppEnv>();

// Legacy messages (app/(admin)/admin/settings/actions.ts).
const emailField = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email("Format email tidak valid").min(5, "Email terlalu pendek").max(200, "Email terlalu panjang"));
const nameField = z.string().trim().max(120, "Maksimal 120 karakter");
const roleField = z.enum(adminRoles);

const createInput = z.object({
  email: emailField,
  name: nameField.optional(),
  role: roleField,
  /** Omit to invite by email. Set it and the admin can sign in with it once the verification email is confirmed. */
  password: z
    .string()
    .min(PASSWORD_MIN_LENGTH, `Password minimal ${PASSWORD_MIN_LENGTH} karakter`)
    .max(PASSWORD_MAX_LENGTH, `Password maksimal ${PASSWORD_MAX_LENGTH} karakter`)
    .optional(),
});

const updateInput = z
  .object({ role: roleField.optional(), name: nameField.min(1, "Nama wajib diisi").optional() })
  .refine((value) => value.role !== undefined || value.name !== undefined, { message: "Tidak ada yang diubah" });

const areasInput = z.object({
  areas: z.array(z.enum(grantableAreas)).max(grantableAreas.length),
});

type AccountStatus = "active" | "invited" | "deactivated";

interface AdminUserRow {
  id: string;
  name: string;
  email: string;
  role: AdminRole;
  emailVerified: boolean;
  deactivatedAt: Date | null;
  createdAt: Date;
  /** Has a way to sign in (a password or a linked Google account). No account = the invite was never accepted. */
  hasAccount: boolean;
  areas: GrantableArea[];
}

/** invited = created by invite and not accepted yet; deactivated wins over everything. */
function statusOf(row: Pick<AdminUserRow, "deactivatedAt" | "hasAccount">): AccountStatus {
  if (row.deactivatedAt) return "deactivated";
  return row.hasAccount ? "active" : "invited";
}

function present(row: AdminUserRow) {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role,
    areas: row.role === "editor" ? row.areas : [],
    status: statusOf(row),
    emailVerified: row.emailVerified,
    deactivatedAt: row.deactivatedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

async function loadAdmins(c: Context<AppEnv>, only?: string): Promise<AdminUserRow[]> {
  const db = drizzle(c.env.DB, { schema });
  const rows = await db
    .select({
      id: schema.users.id,
      name: schema.users.name,
      email: schema.users.email,
      role: schema.users.role,
      emailVerified: schema.users.emailVerified,
      deactivatedAt: schema.users.deactivatedAt,
      createdAt: schema.users.createdAt,
      hasAccount: sql<number>`exists (select 1 from ${schema.accounts} where ${schema.accounts.userId} = ${schema.users.id})`,
      area: schema.adminAreaGrants.area,
    })
    .from(schema.users)
    .leftJoin(schema.adminAreaGrants, eq(schema.adminAreaGrants.userId, schema.users.id))
    .where(only ? and(inArray(schema.users.role, adminRoles), eq(schema.users.id, only)) : inArray(schema.users.role, adminRoles))
    .orderBy(asc(schema.users.email));

  const byId = new Map<string, AdminUserRow>();
  for (const { area, hasAccount, role, ...row } of rows) {
    const entry = byId.get(row.id) ?? { ...row, role: role as AdminRole, hasAccount: Boolean(hasAccount), areas: [] };
    // Grants only mean something for editors; another role's stray rows are not shown as rights.
    if (area && role === "editor") entry.areas.push(area);
    byId.set(row.id, entry);
  }
  for (const entry of byId.values()) entry.areas.sort((a, b) => grantableAreas.indexOf(a) - grantableAreas.indexOf(b));
  return [...byId.values()];
}

/** True when `error`, or anything it wraps, mentions `text` (D1 errors arrive wrapped by Drizzle). */
function mentions(error: unknown, text: string): boolean {
  for (let current: unknown = error, depth = 0; current && depth < 5; depth++) {
    if (current instanceof Error && current.message.includes(text)) return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

/** Another active super_admin exists besides `userId`. The trigger is the guarantee; this is the friendly answer first. */
async function hasOtherSuperAdmin(c: Context<AppEnv>, userId: string): Promise<boolean> {
  const db = drizzle(c.env.DB, { schema });
  const row = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(and(eq(schema.users.role, "super_admin"), sql`${schema.users.deactivatedAt} is null`, ne(schema.users.id, userId)))
    .limit(1)
    .get();
  return row !== undefined;
}

function randomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * A link that lets `userId` choose a password, valid for 7 days, usable once.
 * It is a Better Auth reset token (same table, same hashing, same
 * `/reset-password` endpoint, so redeeming it also revokes sessions and marks
 * the address verified) created here only to give it the longer life an
 * invitation needs. Any earlier link for this user is deleted first.
 */
async function createInviteLink(c: Context<AppEnv>, userId: string): Promise<string> {
  const auth = c.get("auth")();
  const context = await auth.$context;
  await c.env.DB.prepare("DELETE FROM verification WHERE value = ?").bind(userId).run();
  const token = randomToken();
  await context.internalAdapter.createVerificationValue({
    identifier: `reset-password:${token}`,
    value: userId,
    expiresAt: new Date(Date.now() + ADMIN_INVITE_SECONDS * 1000),
  });
  return `${context.baseURL}/reset-password/${token}?callbackURL=${encodeURIComponent("/reset-password?invite=1")}`;
}

/** What the API says when the email did not go out. The account exists; "resend invite" retries. */
function emailFailure(c: Context<AppEnv>, result: Extract<SendResult, { ok: false }>, user: unknown) {
  if (result.reason === "provider_rate_limited") {
    return c.json({ error: "email_rate_limited", message: "Batas pengiriman email sudah tercapai. Coba kirim ulang undangan nanti.", user }, 502);
  }
  return c.json({ error: "email_failed", reason: result.reason, message: "Email belum terkirim. Akun sudah dibuat; kirim ulang undangannya nanti.", user }, 502);
}

const notFound = (c: Context<AppEnv>) => c.json({ error: "not_found" }, 404);

/** Admin accounts (viewer, editor, super_admin) with the areas granted to each and their state. */
adminUserRoutes.get("/", requireArea("sistem", "read"), async (c) => {
  return c.json({ users: (await loadAdmins(c)).map(present) });
});

/**
 * Creates an admin. Without `password` it is an invitation: the account exists
 * (unverified, no password) and an email carries a 7-day link to choose one.
 * With `password` the account can sign in once its verification email is
 * confirmed (a typo in the address must not hand out an admin account, so
 * nothing is verified on the super_admin's word).
 *
 * The email is sent in the request, not after it, because this caller is a
 * signed-in super_admin (nothing to enumerate) and must be told when it failed:
 * 502, with the created user, never a plain success.
 */
adminUserRoutes.post("/", requireArea("sistem", "write"), async (c) => {
  const raw = await readJson(c);
  if (raw === undefined) return c.json({ error: "json_required" }, 415);
  const parsed = createInput.safeParse(raw);
  if (!parsed.success) return c.json({ error: "invalid", fieldErrors: z.flattenError(parsed.error).fieldErrors }, 400);
  const { email, role, password } = parsed.data;
  const name = parsed.data.name || email.split("@")[0]!;

  if (!emailAvailable(c.env)) {
    return c.json({ error: "email_unavailable", message: "Layanan email sedang tidak tersedia. Silakan coba lagi nanti." }, 503);
  }
  const limited = await checkLimits(c.env, [{ name: "mailTarget", key: await emailKey(email) }]);
  if (!limited.allowed) return limitedResponse(limited);

  const actor = c.get("user");
  const db = drizzle(c.env.DB, { schema });
  const id = crypto.randomUUID();
  const statements: BatchItem<"sqlite">[] = [db.insert(schema.users).values({ id, name, email, role, emailVerified: false })];
  if (password) {
    statements.push(db.insert(schema.accounts).values({ id: crypto.randomUUID(), accountId: id, providerId: "credential", userId: id, password: await hashPassword(password) }));
  }
  statements.push(
    auditStatement(db, actor, {
      action: "admin.create",
      resourceType: "admin_user",
      resourceId: id,
      // The address and role, never the password.
      metadata: { email, role, mode: password ? "password" : "invite" },
    }),
  );
  try {
    await db.batch(statements as [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]]);
  } catch (error) {
    if (mentions(error, "UNIQUE constraint failed: users.email")) {
      return c.json({ error: "email_taken", message: "Email ini sudah terdaftar.", fieldErrors: { email: ["Email sudah digunakan"] } }, 409);
    }
    throw error;
  }

  const created = (await loadAdmins(c, id))[0]!;
  const message = password
    ? verificationEmail(email, await verificationLink(c, email))
    : adminInviteEmail(email, await createInviteLink(c, id), { role, inviterName: actor.name });
  const sent = await sendEmail(c.env, message);
  if (!sent.ok) return emailFailure(c, sent, present(created));
  return c.json({ user: present(created), email: { sent: true, kind: password ? "verification" : "invite" } }, 201);
});

/** A fresh email-verification link for an address, the same one sign-in would send. */
async function verificationLink(c: Context<AppEnv>, email: string): Promise<string> {
  const context = await c.get("auth")().$context;
  const token = await createEmailVerificationToken(context.secret, email, undefined, 24 * 60 * 60);
  return `${context.baseURL}/verify-email?token=${token}&callbackURL=${encodeURIComponent("/login?verified=1")}`;
}

/**
 * Changes an admin's role and/or name. Moving away from `editor` removes that
 * user's area grants in the same transaction (grants mean nothing for other
 * roles, and an old grant must not come back by surprise if they are made an
 * editor again). The last active super_admin cannot be demoted.
 */
adminUserRoutes.patch("/:id", requireArea("sistem", "write"), async (c) => {
  const raw = await readJson(c);
  if (raw === undefined) return c.json({ error: "json_required" }, 415);
  const parsed = updateInput.safeParse(raw);
  if (!parsed.success) return c.json({ error: "invalid", fieldErrors: z.flattenError(parsed.error).fieldErrors }, 400);

  const actor = c.get("user");
  const db = drizzle(c.env.DB, { schema });
  const id = c.req.param("id");
  const target = (await loadAdmins(c, id))[0];
  if (!target) return notFound(c);

  const newRole = parsed.data.role ?? target.role;
  const newName = parsed.data.name ?? target.name;
  const roleChanges = newRole !== target.role;
  const nameChanges = newName !== target.name;
  if (!roleChanges && !nameChanges) return c.json({ user: present(target) });

  if (roleChanges && target.role === "super_admin" && !target.deactivatedAt && !(await hasOtherSuperAdmin(c, id))) {
    return c.json({ error: "last_super_admin", message: "Tidak dapat menurunkan peran super admin terakhir. Tambah super admin lain terlebih dahulu." }, 409);
  }

  const statements: BatchItem<"sqlite">[] = [db.update(schema.users).set({ role: newRole, name: newName }).where(eq(schema.users.id, id))];
  const grantsRemoved = roleChanges && target.role === "editor" ? target.areas : [];
  if (grantsRemoved.length > 0) statements.push(db.delete(schema.adminAreaGrants).where(eq(schema.adminAreaGrants.userId, id)));
  statements.push(
    auditStatement(db, actor, {
      action: "admin.update",
      resourceType: "admin_user",
      resourceId: id,
      metadata: {
        email: target.email,
        ...(roleChanges ? { roleFrom: target.role, roleTo: newRole } : {}),
        ...(nameChanges ? { nameChanged: true } : {}),
        ...(grantsRemoved.length > 0 ? { areasRemoved: grantsRemoved } : {}),
      },
    }),
  );
  try {
    await db.batch(statements as [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]]);
  } catch (error) {
    if (mentions(error, "last_super_admin")) {
      return c.json({ error: "last_super_admin", message: "Tidak dapat menurunkan peran super admin terakhir. Tambah super admin lain terlebih dahulu." }, 409);
    }
    throw error;
  }
  return c.json({ user: present((await loadAdmins(c, id))[0]!) });
});

/**
 * Deactivates an account: it cannot sign in by any method, every session is
 * deleted now, and outstanding reset or invite links are deleted. Idempotent
 * (a second call changes nothing and writes no audit row). Not on yourself, and
 * not on the last active super_admin.
 */
adminUserRoutes.post("/:id/deactivate", requireArea("sistem", "write"), async (c) => {
  const actor = c.get("user");
  const db = drizzle(c.env.DB, { schema });
  const id = c.req.param("id");
  const target = (await loadAdmins(c, id))[0];
  if (!target) return notFound(c);
  if (target.deactivatedAt) return c.json({ user: present(target) });
  if (id === actor.id) {
    return c.json({ error: "cannot_deactivate_self", message: "Tidak dapat menonaktifkan akun sendiri." }, 409);
  }
  if (target.role === "super_admin" && !(await hasOtherSuperAdmin(c, id))) {
    return c.json({ error: "last_super_admin", message: "Tidak dapat menonaktifkan super admin terakhir. Tambah super admin lain terlebih dahulu." }, 409);
  }
  try {
    await db.batch([
      db.update(schema.users).set({ deactivatedAt: new Date() }).where(eq(schema.users.id, id)),
      db.delete(schema.sessions).where(eq(schema.sessions.userId, id)),
      db.delete(schema.verifications).where(eq(schema.verifications.value, id)),
      auditStatement(db, actor, { action: "admin.deactivate", resourceType: "admin_user", resourceId: id, metadata: { email: target.email, role: target.role } }),
    ]);
  } catch (error) {
    if (mentions(error, "last_super_admin")) {
      return c.json({ error: "last_super_admin", message: "Tidak dapat menonaktifkan super admin terakhir. Tambah super admin lain terlebih dahulu." }, 409);
    }
    throw error;
  }
  return c.json({ user: present((await loadAdmins(c, id))[0]!) });
});

/** Lets a deactivated account sign in again. Sessions are not restored; they sign in anew. Idempotent. */
adminUserRoutes.post("/:id/reactivate", requireArea("sistem", "write"), async (c) => {
  const actor = c.get("user");
  const db = drizzle(c.env.DB, { schema });
  const id = c.req.param("id");
  const target = (await loadAdmins(c, id))[0];
  if (!target) return notFound(c);
  if (!target.deactivatedAt) return c.json({ user: present(target) });
  await db.batch([
    db.update(schema.users).set({ deactivatedAt: null }).where(eq(schema.users.id, id)),
    auditStatement(db, actor, { action: "admin.reactivate", resourceType: "admin_user", resourceId: id, metadata: { email: target.email, role: target.role } }),
  ]);
  return c.json({ user: present((await loadAdmins(c, id))[0]!) });
});

/**
 * Sends a pending invitation again, with a new link (the old one stops working).
 * Only while the invite is pending: an admin who already has a way to sign in
 * uses "forgot password", and a deactivated one is reactivated first.
 */
adminUserRoutes.post("/:id/resend-invite", requireArea("sistem", "write"), async (c) => {
  const actor = c.get("user");
  const db = drizzle(c.env.DB, { schema });
  const id = c.req.param("id");
  const target = (await loadAdmins(c, id))[0];
  if (!target) return notFound(c);
  if (statusOf(target) !== "invited") {
    return c.json({ error: "not_pending_invite", message: "Undangan hanya bisa dikirim ulang untuk admin yang belum menerimanya." }, 409);
  }
  if (!emailAvailable(c.env)) {
    return c.json({ error: "email_unavailable", message: "Layanan email sedang tidak tersedia. Silakan coba lagi nanti." }, 503);
  }
  const limited = await checkLimits(c.env, [{ name: "mailTarget", key: await emailKey(target.email) }]);
  if (!limited.allowed) return limitedResponse(limited);

  const url = await createInviteLink(c, id);
  await db.batch([auditStatement(db, actor, { action: "admin.invite_resend", resourceType: "admin_user", resourceId: id, metadata: { email: target.email, role: target.role } })]);
  const sent = await sendEmail(c.env, adminInviteEmail(target.email, url, { role: target.role, inviterName: actor.name }));
  if (!sent.ok) return emailFailure(c, sent, present(target));
  return c.json({ user: present(target), email: { sent: true, kind: "invite" } });
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
