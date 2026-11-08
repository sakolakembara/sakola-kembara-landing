import { and, eq, gte, lt, ne } from "drizzle-orm";
import { Hono, type Context } from "hono";
import { z } from "zod";
import { requireArea } from "../auth/guard";
import type { AppEnv } from "../context";
import { auditStatement } from "../db/audit";
import { getDb } from "../db/client";
import * as schema from "../db/schema";
import { donationKind, donationStatus } from "../db/schema/donations";
import { PROOF_KEY_PATTERN } from "../donations/proof";
import { fileResponse } from "../private-files/serve";
import { releaseStorage } from "../private-files/storage";
import { crudRoutes, notFound, parseBody, parseListQuery, withAudit, type Filter, type ListSpec } from "./crud";
import { enumFilter } from "./crud/pagination";

// Donasi (area `sistem`: the super admin only, Dzul 2026-11-08): the confirmations of the site's /donasi form
// (SAKEM-128, docs/cloudflare/donations.md). A row is made by the public form only; here it is read, marked checked,
// annotated, exported and deleted.
//
//   GET    /api/admin/donations              list, newest first; ?q= (name, WhatsApp) ?kind= ?status= ?month=YYYY-MM
//   GET    /api/admin/donations/export.csv   the same filters, every matching row (up to 5,000), as CSV for a spreadsheet
//   GET    /api/admin/donations/:id          one
//   GET    /api/admin/donations/:id/proof    the receipt, streamed from the private bucket (audited each time)
//   POST   /api/admin/donations/:id/check    mark checked (idempotent)
//   POST   /api/admin/donations/:id/uncheck  back to `new` (idempotent)
//   PUT    /api/admin/donations/:id/note     { note } the internal note
//   DELETE /api/admin/donations/:id          the row and its receipt
//
// A row holds personal data (a name, a WhatsApp number, an amount, a receipt): the list, the detail, the receipt and the
// CSV are the only places it leaves the database, and the audit rows carry ids, statuses and counts, never a field value.

const AREA = "sistem" as const;
const MAX_ID_LENGTH = 128;
export const EXPORT_MAX_ROWS = 5_000;
const t = schema.donations;

type DonationRow = typeof t.$inferSelect;

function present(row: DonationRow) {
  return {
    id: row.id,
    kind: row.kind,
    name: row.name,
    whatsapp: row.whatsapp,
    amount: row.amount,
    startMonth: row.startMonth,
    remindDay: row.remindDay,
    source: row.source,
    status: row.status,
    note: row.note,
    proof: row.proofKey ? { contentType: row.proofType, size: row.proofSize, uploadedAt: row.proofAt?.toISOString() ?? null } : null,
    checkedAt: row.checkedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function presentInList(row: DonationRow) {
  return {
    id: row.id,
    kind: row.kind,
    name: row.name,
    amount: row.amount,
    remindDay: row.remindDay,
    status: row.status,
    hasProof: row.proofKey !== null,
    createdAt: row.createdAt.toISOString(),
  };
}

/** WIB is UTC+7 with no daylight saving: a month in Jakarta is a fixed millisecond range. */
const WIB_OFFSET_MS = 7 * 60 * 60 * 1000;

/** `?month=2026-11`: rows that came in during that month, Jakarta time. */
export const monthFilter: Filter = (raw) => {
  const match = /^([0-9]{4})-([0-9]{2})$/.exec(raw);
  if (!match) return { ok: false };
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (year < 2020 || year > 2100 || month < 1 || month > 12) return { ok: false };
  const from = Date.UTC(year, month - 1, 1) - WIB_OFFSET_MS;
  const to = Date.UTC(year, month, 1) - WIB_OFFSET_MS;
  return { ok: true, where: and(gte(t.createdAt, new Date(from)), lt(t.createdAt, new Date(to)))! };
};

export const DONATION_LIST: Omit<ListSpec, "id"> = {
  search: [t.name, t.whatsapp],
  filters: { kind: enumFilter(t.kind, donationKind), status: enumFilter(t.status, donationStatus), month: monthFilter },
  sorts: { createdAt: t.createdAt, amount: t.amount },
  defaultSort: "-createdAt",
};

// ---------------------------------------------------------------- CSV

const KIND_LABEL = { once: "Sekali", monthly: "Bulanan" } as const;
const STATUS_LABEL = { awaiting_transfer: "Belum transfer", new: "Baru", checked: "Dicek" } as const;
const SOURCE_LABEL = { instagram: "Instagram", twitter: "Twitter/X", whatsapp: "WhatsApp", friend: "Teman", website: "Situs web", other: "Lainnya" } as const;

/** One CSV cell: quoted, quotes doubled, and a leading = + - @ (a spreadsheet formula) defused with an apostrophe. */
export function csvCell(value: string | number | null | undefined): string {
  const text = value === null || value === undefined ? "" : String(value);
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return `"${safe.replaceAll('"', '""')}"`;
}

/** "2026-11-08 14:20" in WIB. */
export function wibDateTime(date: Date): string {
  return new Date(date.getTime() + WIB_OFFSET_MS).toISOString().slice(0, 16).replace("T", " ");
}

export const CSV_HEADER = ["Masuk (WIB)", "Nama", "WhatsApp", "Jenis", "Nominal", "Mulai", "Tanggal pengingat", "Tahu dari", "Status", "Bukti transfer", "Catatan"];

export function csvOf(rows: readonly DonationRow[]): string {
  const lines = [CSV_HEADER.map(csvCell).join(",")];
  for (const row of rows) {
    lines.push(
      [
        wibDateTime(row.createdAt),
        row.name,
        row.whatsapp,
        KIND_LABEL[row.kind],
        row.amount,
        row.startMonth,
        row.remindDay,
        row.source ? SOURCE_LABEL[row.source] : "",
        STATUS_LABEL[row.status],
        row.proofKey ? "Ada" : "",
        row.note,
      ]
        .map(csvCell)
        .join(","),
    );
  }
  // A byte order mark so Excel reads the file as UTF-8; CRLF as RFC 4180 says.
  return `﻿${lines.join("\r\n")}\r\n`;
}

// ---------------------------------------------------------------- routes

const noteSchema = z.object({ note: z.string().max(2000, "Maksimal 2.000 karakter.") });

function idOf(c: Context<AppEnv>): string | null {
  const id = c.req.param("id") ?? "";
  return id.length === 0 || id.length > MAX_ID_LENGTH ? null : id;
}

async function rowById(c: Context<AppEnv>, id: string): Promise<DonationRow | undefined> {
  return (await getDb(c.env.DB).select().from(t).where(eq(t.id, id)).limit(1))[0];
}

export function createDonationRoutes() {
  const app = new Hono<AppEnv>();

  // Before `/:id`, which would take "export.csv" for an id.
  app.get("/export.csv", requireArea(AREA, "read"), async (c) => {
    const parsed = parseListQuery(c, { ...DONATION_LIST, id: t.id } as ListSpec);
    if (!parsed.ok) return parsed.response;
    const db = getDb(c.env.DB);
    const rows = await db.select().from(t).where(parsed.query.where).orderBy(...parsed.query.order).limit(EXPORT_MAX_ROWS);
    // Audited before the bytes leave (a count, never a row): no audit row, no file.
    try {
      await auditStatement(db, c.get("user"), { action: "donation.export", resourceType: "donation", resourceId: "export", metadata: { count: rows.length } });
    } catch {
      console.error("[donations] the audit row of an export could not be written; nothing was exported");
      return c.json({ error: "audit_unavailable", message: "Ekspor belum dapat dilakukan. Silakan coba lagi." }, 503);
    }
    const day = wibDateTime(new Date()).slice(0, 10);
    return new Response(csvOf(rows), {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="donasi-${day}.csv"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  });

  // The list and `GET /:id` are the kit's. A row cannot be created or edited as a whole here; delete is below (it also removes the receipt).
  app.route(
    "/",
    crudRoutes({
      area: AREA,
      table: t,
      // Only the list and `GET /:id` are on, which write no audit row; the kit wants a name all the same.
      audit: { name: "contact_message", type: "donation" },
      schema: z.object({}),
      toRow: () => ({}),
      present,
      list: { ...DONATION_LIST, present: presentInList },
      routes: { create: false, update: false, delete: false },
    }),
  );

  app.get("/:id/proof", requireArea(AREA, "read"), async (c) => {
    const id = idOf(c);
    if (!id) return notFound(c);
    const row = await rowById(c, id);
    if (!row?.proofKey || !row.proofType || !PROOF_KEY_PATTERN.test(row.proofKey)) return notFound(c);
    const object = await c.env.PRIVATE_FILES.get(row.proofKey);
    if (!object) return notFound(c);
    try {
      await auditStatement(getDb(c.env.DB), c.get("user"), { action: "donation_proof.view", resourceType: "donation", resourceId: id });
    } catch {
      console.error("[donations] the audit row of a receipt open could not be written; the receipt was not served");
      await object.body.cancel().catch(() => undefined);
      return c.json({ error: "audit_unavailable", message: "Bukti transfer belum dapat dibuka. Silakan coba lagi." }, 503);
    }
    return fileResponse({ id: row.id, slot: "bukti-transfer", contentType: row.proofType }, object);
  });

  function mark(to: "check" | "uncheck") {
    return async (c: Context<AppEnv>) => {
      const id = idOf(c);
      if (!id) return notFound(c);
      const db = getDb(c.env.DB);
      const now = new Date();
      const [rows] = await withAudit(db, c.get("user"), { action: `donation.${to}`, resourceType: "donation", resourceId: id }, [
        db
          .update(t)
          .set(to === "check" ? { status: "checked", checkedAt: now, updatedAt: now } : { status: "new", checkedAt: null, updatedAt: now })
          .where(and(eq(t.id, id), to === "check" ? ne(t.status, "checked") : eq(t.status, "checked")))
          .returning(),
      ]);
      const row = (rows as DonationRow[])[0] ?? (await rowById(c, id));
      return row ? c.json({ item: present(row) }) : notFound(c);
    };
  }
  app.post("/:id/check", requireArea(AREA, "write"), mark("check"));
  app.post("/:id/uncheck", requireArea(AREA, "write"), mark("uncheck"));

  app.put("/:id/note", requireArea(AREA, "write"), async (c) => {
    const id = idOf(c);
    if (!id) return notFound(c);
    const body = await parseBody(c, noteSchema);
    if (!body.ok) return body.response;
    const note = body.data.note.trim() || null;
    const db = getDb(c.env.DB);
    const [rows] = await withAudit(db, c.get("user"), { action: "donation.note", resourceType: "donation", resourceId: id }, [
      db.update(t).set({ note, updatedAt: new Date() }).where(eq(t.id, id)).returning(),
    ]);
    const row = (rows as DonationRow[])[0];
    return row ? c.json({ item: present(row) }) : notFound(c);
  });

  app.delete("/:id", requireArea(AREA, "write"), async (c) => {
    const id = idOf(c);
    if (!id) return notFound(c);
    const row = await rowById(c, id);
    if (!row) return notFound(c);
    const db = getDb(c.env.DB);
    await withAudit(db, c.get("user"), { action: "donation.delete", resourceType: "donation", resourceId: id }, [db.delete(t).where(eq(t.id, id))]);
    if (row.proofKey && PROOF_KEY_PATTERN.test(row.proofKey)) {
      await releaseStorage(c.env, row.proofSize ?? 0, Date.now());
      await c.env.PRIVATE_FILES.delete(row.proofKey).catch(() => undefined);
    }
    return c.body(null, 204);
  });

  return app;
}

export const donationRoutes = createDonationRoutes();
